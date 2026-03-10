import { authenticatedFetch } from './authFetch';
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
    const candidates = [w.shield, w.shieldWallet, w.ShieldWallet, w.aleoWallet, w.aleo, w.leoWallet, w.puzzle];
    for (const candidate of candidates) {
        if (candidate?.executeTransaction) return candidate as ShieldLike;
    }
    return null;
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function submitTrackedResult(idempotencyKey: string, payload: {
    txHash: string;
    status: 'submitted' | 'confirmed' | 'rejected';
    error?: string;
    rawResponse?: any;
}): Promise<void> {
    const response = await authenticatedFetch(`/api/tx/${idempotencyKey}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (response.ok) {
        return;
    }

    let message = `Failed to submit transaction update (${response.status})`;
    try {
        const body = await response.json();
        message = body?.error?.message || message;
    } catch {
        // Keep fallback message.
    }

    throw new Error(message);
}

export async function executeWithShield(tx: TxRequest): Promise<{
    txHash: string;
    status: 'submitted' | 'confirmed' | 'rejected';
    error?: string;
}> {
    if ((tx.network || '').toLowerCase() === 'demo') {
        return {
            txHash: `demo_${Date.now()}`,
            status: 'confirmed',
        };
    }

    const shield = getShield();
    if (!shield?.executeTransaction) {
        throw new Error('Shield wallet executeTransaction API not available');
    }

    try {
        await ensureShieldProgramAccess(tx.program);
    } catch {
        // Continue and let execute attempts surface a concrete wallet error.
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
    let lastError: unknown = null;

    // Detect user cancellation or fatal wallet errors — stop immediately, don't retry
    function isUserCancellation(msg: string): boolean {
        const lower = msg.toLowerCase();
        return lower.includes('cancel') || lower.includes('reject') || lower.includes('denied') || lower.includes('user');
    }

    function isNoResponse(msg: string): boolean {
        const lower = msg.toLowerCase();
        return lower.includes('no response') || lower.includes('timeout') || lower.includes('not available');
    }

    const runAttempts = async (): Promise<'ok' | 'cancelled' | 'no_response' | 'failed'> => {
        for (const payload of payloads) {
            try {
                result = await shield.executeTransaction?.(payload);
                if (result) return 'ok';
            } catch (error) {
                lastError = error;
                const message = error instanceof Error ? error.message : String(error);

                // User cancelled — stop immediately, no point retrying other formats
                if (isUserCancellation(message)) return 'cancelled';

                // Wallet not responding — stop, don't spam attempts
                if (isNoResponse(message)) return 'no_response';
            }
        }
        return 'failed';
    };

    let outcome = await runAttempts();

    // Only retry with fresh program access if the issue was payload format, not cancellation
    if (outcome === 'failed' && !result) {
        try {
            await ensureShieldProgramAccess(tx.program);
        } catch {
            // Preserve the execute errors for reporting.
        }
        outcome = await runAttempts();
    }

    if (!result) {
        const rawMessage = lastError instanceof Error ? lastError.message : '';

        // User-friendly error messages
        if (outcome === 'cancelled') {
            throw new Error('Transaction cancelled. You can try again when ready.');
        }
        if (outcome === 'no_response') {
            throw new Error(
                'Shield wallet is not responding. Make sure the extension is unlocked and try again.'
            );
        }

        // For payload/format errors, give a clear message
        throw new Error(
            rawMessage.includes('Invalid transaction')
                ? 'Shield wallet could not process this transaction. The wallet may need to be updated, or the program may not be deployed on the current network.'
                : rawMessage || 'Wallet execution failed. Make sure Shield wallet is unlocked and connected.'
        );
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
            // Continue polling.
        }
    }

    return { txHash, status: 'submitted' };
}

export async function executeAndReportTx(
    idempotencyKey: string,
    tx: TxRequest
): Promise<void> {
    let executed: Awaited<ReturnType<typeof executeWithShield>>;

    try {
        executed = await executeWithShield(tx);
    } catch (error: any) {
        const message = error?.message || 'Wallet rejected transaction';
        try {
            await submitTrackedResult(idempotencyKey, {
                txHash: `wallet_rejected_${Date.now()}`,
                status: 'rejected',
                error: message,
                rawResponse: { error: message },
            });
        } catch {
            // Preserve the original wallet error.
        }
        throw error;
    }

    await submitTrackedResult(idempotencyKey, {
        txHash: executed.txHash,
        status: executed.status,
        error: executed.error,
        rawResponse: executed,
    });
}

/**
 * Wallet-first transaction flow:
 * 1. Call backend to validate & get tx request (no business record created)
 * 2. Execute wallet transaction via Shield
 * 3. Report result to tracking system
 * 4. Call backend again with txHash to create the business record
 */
export async function walletFirstTx(
    url: string,
    prepareBody: object,
    confirmBodyBuilder: (prepareData: any, txHash: string) => object,
): Promise<{ data: any; idempotencyKey: string; txHash: string }> {
    // 1. Prepare: validate and get tx request
    const prepareRes = await authenticatedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepareBody),
    });
    const prepareJson = await prepareRes.json();
    if (!prepareRes.ok) {
        throw new Error(prepareJson.error?.message || 'Request failed');
    }

    const { idempotencyKey, request: txRequest } = prepareJson.data.tx;

    // 2. Execute wallet transaction
    let result: Awaited<ReturnType<typeof executeWithShield>>;
    try {
        result = await executeWithShield(txRequest);
    } catch (walletError: any) {
        // Wallet threw (user cancelled, extension error, etc.)
        // Report rejection to tracking, then re-throw
        try {
            await submitTrackedResult(idempotencyKey, {
                txHash: `wallet_rejected_${Date.now()}`,
                status: 'rejected',
                error: walletError?.message || 'Wallet rejected transaction',
                rawResponse: { error: walletError?.message },
            });
        } catch {
            // Preserve the original wallet error
        }
        throw walletError;
    }

    // 3. Report to tracking system
    await submitTrackedResult(idempotencyKey, {
        txHash: result.txHash,
        status: result.status,
        error: result.error,
        rawResponse: result,
    });

    // If wallet executed but tx was rejected/failed, don't create business record
    if (result.status === 'rejected') {
        throw new Error(result.error || 'Transaction was rejected by the network');
    }

    // 4. Confirm: create business record
    const confirmRes = await authenticatedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmBodyBuilder(prepareJson.data, result.txHash)),
    });
    const confirmJson = await confirmRes.json();
    if (!confirmRes.ok) {
        throw new Error(confirmJson.error?.message || 'Confirmation failed');
    }

    return {
        data: { ...prepareJson.data, ...confirmJson.data },
        idempotencyKey,
        txHash: result.txHash,
    };
}
