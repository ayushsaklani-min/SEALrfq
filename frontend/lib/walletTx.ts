import { ensureShieldProgramAccess } from './shieldWallet';

type TxRequest = {
    program: string;
    function: string;
    inputs: string[];
    fee?: string | number;
    network?: 'testnet' | 'mainnet' | 'canary' | string;
};
const DEFAULT_NETWORK = process.env.NEXT_PUBLIC_ALEO_NETWORK || 'testnet';

type ShieldLike = {
    executeTransaction?: (options: any) => Promise<{ transactionId?: string } | any>;
    transactionStatus?: (transactionId: string) => Promise<{ status?: string; error?: string } | any>;
};

function getShield(): ShieldLike | null {
    const w = window as any;
    return (w.shield || null) as ShieldLike | null;
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWithShield(tx: TxRequest): Promise<{
    txHash: string;
    status: 'submitted' | 'confirmed' | 'rejected';
    error?: string;
}> {
    const shield = getShield();
    if (!shield?.executeTransaction) {
        throw new Error('Shield wallet executeTransaction API not available');
    }
    try {
        await ensureShieldProgramAccess(tx.program);
    } catch {
        // Continue and let execute attempts surface concrete wallet errors.
    }

    const feeNum =
        typeof tx.fee === 'number'
            ? tx.fee
            : typeof tx.fee === 'string'
              ? Number(tx.fee)
              : 1_000_000;

    const fee = Number.isFinite(feeNum) ? feeNum : 1_000_000;
    const network = tx.network || DEFAULT_NETWORK;
    const common = {
        program: tx.program,
        inputs: tx.inputs,
        fee,
        network,
    };
    const payloads: any[] = [
        {
            ...common,
            function: tx.function,
            privateFee: false,
        },
        {
            ...common,
            transition: tx.function,
            privateFee: false,
        },
        {
            ...common,
            functionName: tx.function,
            privateFee: false,
        },
        {
            ...common,
            programId: tx.program,
            transition: tx.function,
        },
        {
            ...common,
            programId: tx.program,
            function: tx.function,
        },
    ];

    let result: any = null;
    let lastError: any = null;
    const attemptErrors: string[] = [];
    const runAttempts = async () => {
        for (const payload of payloads) {
            try {
                result = await shield.executeTransaction(payload);
                if (result) break;
            } catch (error) {
                lastError = error;
                const name =
                    payload.transition ||
                    payload.function ||
                    payload.functionName ||
                    'unknown';
                const message = error instanceof Error ? error.message : String(error);
                attemptErrors.push(`${name}: ${message}`);
            }
        }
    };

    await runAttempts();

    if (!result) {
        try {
            await ensureShieldProgramAccess(tx.program);
        } catch {
            // ignore and preserve execute errors for reporting
        }
        await runAttempts();
    }
    if (!result) {
        const message = lastError instanceof Error ? lastError.message : 'Wallet execution failed';
        const detail = attemptErrors.length > 0 ? ` | Attempts: ${attemptErrors.join(' || ')}` : '';
        throw new Error(`${message}${detail}`);
    }

    const txHash =
        result?.transactionId ||
        result?.txId ||
        result?.id ||
        result?.transaction?.id ||
        result?.transaction?.transactionId ||
        result?.hash;
    if (!txHash || typeof txHash !== 'string') {
        throw new Error('Shield did not return a transaction id');
    }

    if (!shield.transactionStatus) {
        return { txHash, status: 'submitted' };
    }

    for (let i = 0; i < 20; i += 1) {
        await sleep(3000);
        try {
            const statusResult = await shield.transactionStatus(txHash);
            const status = String(statusResult?.status || '').toLowerCase();
            if (status === 'accepted' || status === 'confirmed') {
                return { txHash, status: 'confirmed' };
            }
            if (status === 'rejected' || status === 'failed') {
                return {
                    txHash,
                    status: 'rejected',
                    error: statusResult?.error || 'Transaction rejected by wallet/network',
                };
            }
        } catch {
            // Continue polling
        }
    }

    return { txHash, status: 'submitted' };
}

export async function executeAndReportTx(
    idempotencyKey: string,
    tx: TxRequest
): Promise<void> {
    try {
        const executed = await executeWithShield(tx);

        await fetch(`/api/tx/${idempotencyKey}/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
            },
            body: JSON.stringify({
                txHash: executed.txHash,
                status: executed.status,
                error: executed.error,
                rawResponse: executed,
            }),
        });
    } catch (error: any) {
        const message = error?.message || 'Wallet rejected transaction';
        await fetch(`/api/tx/${idempotencyKey}/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
            },
            body: JSON.stringify({
                txHash: `wallet_rejected_${Date.now()}`,
                status: 'rejected',
                error: message,
                rawResponse: { error: message },
            }),
        });
        throw error;
    }
}
