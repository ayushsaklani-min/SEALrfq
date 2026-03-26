import { authenticatedFetch } from './authFetch';
import { ensureShieldProgramAccess } from './shieldWallet';
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield';
import { Network } from '@provablehq/aleo-types';

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
    requestTransaction?: (options: any) => Promise<{ transactionId?: string } | any>;
    requestRecords?: (programId: string, onlyUnspent?: boolean) => Promise<any[]>;
    transactionStatus?: (transactionId: string) => Promise<{ status?: string; error?: string } | any>;
};

function getShield(): ShieldLike | null {
    const w = window as any;
    const candidates = [w.shield, w.shieldWallet, w.ShieldWallet, w.aleoWallet, w.aleo, w.leoWallet, w.puzzle];
    for (const candidate of candidates) {
        if (candidate?.executeTransaction || candidate?.requestTransaction) return candidate as ShieldLike;
    }
    return null;
}

function getMicrocredits(record: any): number {
    try {
        if (record?.data?.microcredits) {
            return parseInt(String(record.data.microcredits).replace('u64', '').replace(/_/g, ''));
        }
        if (record?.plaintext) {
            const m = String(record.plaintext).match(/microcredits:\s*([\d_]+)u64/);
            if (m?.[1]) return parseInt(m[1].replace(/_/g, ''));
        }
        return 0;
    } catch {
        return 0;
    }
}

/**
 * Fetches an unspent credits.aleo record from Shield wallet and returns its plaintext.
 * The plaintext is what Shield wallet accepts as a transaction input for credits.record.
 */
export async function requestCreditsRecord(requiredMicrocredits: number): Promise<string> {
    const shield = getShield() as any;
    if (!shield) throw new Error('Shield wallet not found');

    // requestRecords is the standard method on the Shield wallet adapter
    const requestFn = shield.requestRecords || shield.getRecords || shield.records;
    if (!requestFn) {
        throw new Error('Shield wallet does not support requestRecords. Update your Shield wallet extension.');
    }

    let records: any[] = [];
    try {
        records = await requestFn.call(shield, 'credits.aleo', false);
    } catch (e: any) {
        throw new Error(`Failed to fetch records from Shield wallet: ${e?.message || e}`);
    }

    console.log('[requestCreditsRecord] raw records from Shield:', JSON.stringify(records, null, 2));

    if (!Array.isArray(records) || records.length === 0) {
        throw new Error('No credits records found in Shield wallet. Make sure you have private credits (use transfer_public_to_private first).');
    }

    // Build plaintext string from a record, trying all known field layouts
    function buildPlaintext(r: any): string | null {
        // Prefer ready-made plaintext
        if (r.plaintext && typeof r.plaintext === 'string' && r.plaintext.includes('microcredits')) {
            return r.plaintext.trim();
        }
        // Construct from data fields
        const owner = r.owner || r.data?.owner;
        const nonce = r.nonce || r._nonce || r.data?._nonce || r.commitment;
        const microcredits = getMicrocredits(r);
        if (owner && nonce && microcredits > 0) {
            const ownerStr = String(owner).includes('.private') ? owner : `${owner}.private`;
            const nonceStr = String(nonce).includes('.public') ? nonce : `${nonce}.public`;
            return `{ owner: ${ownerStr}, microcredits: ${microcredits}u64.private, _nonce: ${nonceStr} }`;
        }
        return null;
    }

    // Pass 1: find an unspent record with enough balance
    for (const r of records) {
        if (r.spent) continue;
        const balance = getMicrocredits(r);
        // If we can't parse balance, still try to use the record (let Shield validate)
        if (balance > 0 && balance < requiredMicrocredits) continue;

        const pt = buildPlaintext(r);
        if (pt) {
            console.log('[requestCreditsRecord] using record plaintext:', pt.slice(0, 80));
            return pt;
        }
    }

    // Pass 2: if balance parsing failed for all records, just use the first unspent record
    // Shield wallet may have a different record structure — let it validate on execution
    for (const r of records) {
        if (r.spent) continue;
        const pt = buildPlaintext(r);
        if (pt) {
            console.log('[requestCreditsRecord] fallback record (balance unknown):', pt.slice(0, 80));
            return pt;
        }
        // Last resort: return ciphertext and hope Shield can handle it
        const ciphertext = r.recordCiphertext || r.ciphertext;
        if (ciphertext && typeof ciphertext === 'string') {
            console.log('[requestCreditsRecord] falling back to ciphertext');
            return ciphertext;
        }
    }

    const totalBalance = records
        .filter((r) => !r.spent)
        .reduce((sum, r) => sum + getMicrocredits(r), 0);

    throw new Error(
        `No usable credits record found. ${totalBalance > 0 ? `Total unspent balance: ${totalBalance} microcredits.` : 'All records appear spent or unreadable.'} Check the browser console for raw record data.`
    );
}

const PROGRAMS = [
    process.env.NEXT_PUBLIC_ALEO_PROGRAM_ID || 'sealrfq_v18.aleo',
    'credits.aleo',
    'test_usdcx_stablecoin.aleo',
    'test_usad_stablecoin.aleo',
];

let _shieldAdapter: InstanceType<typeof ShieldWalletAdapter> | null = null;

/**
 * Get (or create) a connected ShieldWalletAdapter instance.
 * Uses the same adapter used in NullPay: connect with AutoDecrypt + programs list.
 */
async function getConnectedAdapter(): Promise<InstanceType<typeof ShieldWalletAdapter>> {
    if (!_shieldAdapter) {
        _shieldAdapter = new ShieldWalletAdapter({ appName: 'SealRFQ' });
    }
    // Always reconnect to ensure _publicKey is set — Shield doesn't show a popup if already approved
    await (_shieldAdapter as any).connect(Network.TESTNET, 'AutoDecrypt', PROGRAMS);
    return _shieldAdapter;
}

/**
 * Execute a transaction via the Provable ShieldWalletAdapter.
 * This is the NullPay pattern: proper private record handling through the official adapter.
 */
export async function executeWithAdapter(options: {
    program: string;
    function: string;
    inputs: string[];
    fee: number;
}): Promise<{ transactionId: string }> {
    const adapter = await getConnectedAdapter();
    const result = await adapter.executeTransaction({
        program: options.program,
        function: options.function,
        inputs: options.inputs,
        fee: options.fee,
        privateFee: false,
    });
    return result as { transactionId: string };
}

/**
 * Fetch credits records from Shield via the official adapter (with proper decryption).
 */
export async function requestRecordsViaAdapter(programId: string): Promise<any[]> {
    const adapter = await getConnectedAdapter();
    return (adapter as any).requestRecords(programId, true) ?? [];
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
    if (!shield?.executeTransaction && !shield?.requestTransaction) {
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
    // requestTransaction payloads — some Puzzle/Shield versions expose this method which
    // properly handles private record inputs by letting the wallet auto-select from its cache.
    const requestPayloads: any[] = [
        {
            address: (window as any).shield?.publicKey || (window as any).leoWallet?.publicKey || '',
            chainId: network,
            transitions: [{ program: common.program, functionName: tx.function, inputs: common.inputs }],
            fee: common.fee,
            feePrivate: false,
        },
        {
            transitions: [{ program: common.program, functionName: tx.function, inputs: common.inputs }],
            fee: common.fee,
        },
        {
            transitions: [{ programId: common.program, functionName: tx.function, inputs: common.inputs }],
            fee: common.fee,
            feePrivate: false,
        },
    ];

    const executePayloads: any[] = [
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
        // Try requestTransaction first — it properly handles private record inputs via wallet UI
        if (shield.requestTransaction) {
            for (const payload of requestPayloads) {
                try {
                    result = await shield.requestTransaction(payload);
                    if (result) return 'ok';
                } catch (error) {
                    lastError = error;
                    const message = error instanceof Error ? error.message : String(error);
                    if (isUserCancellation(message)) return 'cancelled';
                    if (isNoResponse(message)) return 'no_response';
                }
            }
        }
        // Fall back to executeTransaction
        for (const payload of executePayloads) {
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

function apiErrorMessage(payload: any, fallback: string): string {
    if (payload?.error?.code === 'AUTH_ERROR') {
        return 'This action needs a different workspace role. Switch to Buyer or Seller, then retry.';
    }
    return payload?.error?.message || fallback;
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
    txRequestMutator?: (txRequest: TxRequest) => TxRequest,
): Promise<{ data: any; idempotencyKey: string; txHash: string }> {
    // 1. Prepare: validate and get tx request
    const prepareRes = await authenticatedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepareBody),
    });
    const prepareJson = await prepareRes.json();
    if (!prepareRes.ok) {
        throw new Error(apiErrorMessage(prepareJson, 'Request failed'));
    }

    const { idempotencyKey, request: rawTxRequest } = prepareJson.data.tx;
    const txRequest: TxRequest = txRequestMutator ? txRequestMutator(rawTxRequest) : rawTxRequest;

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
        // Some flows can hit a post-confirmation race where on-chain state already advanced.
        // Keep UI flow moving and let periodic refresh reconcile state.
        if (confirmJson?.error?.code === 'INVALID_STATE' && result.status === 'confirmed') {
            return {
                data: {
                    ...prepareJson.data,
                    txHash: result.txHash,
                    confirmDeferred: true,
                    confirmError: confirmJson?.error?.message || null,
                    confirmCode: 'INVALID_STATE',
                },
                idempotencyKey,
                txHash: result.txHash,
            };
        }
        throw new Error(apiErrorMessage(confirmJson, 'Confirmation failed'));
    }

    return {
        data: { ...prepareJson.data, ...confirmJson.data },
        idempotencyKey,
        txHash: result.txHash,
    };
}
