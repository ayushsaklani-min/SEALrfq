'use client';

const ALEO_RPC = process.env.NEXT_PUBLIC_ALEO_RPC_URL || 'https://api.explorer.provable.com/v1';
const ALEO_NETWORK = process.env.NEXT_PUBLIC_ALEO_NETWORK || 'testnet';

async function fetchAleo(path: string): Promise<any | null> {
    try {
        const response = await fetch(`${ALEO_RPC}/${ALEO_NETWORK}/${path}`, { cache: 'no-store' });
        if (!response.ok) return null;

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('json')) {
            return await response.json();
        }

        return await response.text();
    } catch {
        return null;
    }
}

export async function fetchCurrentBlockHeight(): Promise<number | null> {
    const urls = [
        `${ALEO_RPC}/${ALEO_NETWORK}/latest/height`,
        `${ALEO_RPC}/${ALEO_NETWORK}/block/latest`,
    ];

    for (const url of urls) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) continue;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('json')) {
                const payload = await response.json();
                const height = Number(payload?.height ?? payload);
                if (Number.isFinite(height) && height > 0) {
                    return height;
                }
                continue;
            }

            const height = Number((await response.text()).trim());
            if (Number.isFinite(height) && height > 0) {
                return height;
            }
        } catch {
            // Try the next endpoint.
        }
    }

    return null;
}

export async function fetchProgramMappingValue(
    programId: string,
    mapping: string,
    key: string,
): Promise<any | null> {
    return fetchAleo(`program/${programId}/mapping/${mapping}/${encodeURIComponent(key)}`);
}

export async function fetchAleoTransaction(txId: string): Promise<any | null> {
    return fetchAleo(`transaction/${encodeURIComponent(txId)}`);
}

export async function fetchAleoAbortedTransaction(txId: string): Promise<any | null> {
    return fetchAleo(`transaction/aborted/${encodeURIComponent(txId)}`);
}

export async function waitForAleoTransaction(
    txId: string,
    options?: {
        attempts?: number;
        delayMs?: number;
    },
): Promise<any> {
    const attempts = options?.attempts ?? 40;
    const delayMs = options?.delayMs ?? 3000;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const transaction = await fetchAleoTransaction(txId);
        if (transaction) return transaction;

        const aborted = await fetchAleoAbortedTransaction(txId);
        if (aborted) {
            const error =
                (typeof aborted?.error === 'string' && aborted.error) ||
                (typeof aborted?.message === 'string' && aborted.message) ||
                'Transaction was aborted by the network.';
            throw new Error(error);
        }

        if (attempt < attempts - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
    }

    throw new Error('Transaction was submitted, but its outputs were not yet available from the Aleo RPC.');
}

export function findRecordCiphertextOutput(
    transaction: any,
    filter?: {
        program?: string;
        functionName?: string;
    },
): string | null {
    const transitions = Array.isArray(transaction?.execution?.transitions)
        ? transaction.execution.transitions
        : Array.isArray(transaction?.transaction?.execution?.transitions)
          ? transaction.transaction.execution.transitions
          : [];

    for (const transition of transitions) {
        if (filter?.program && transition?.program !== filter.program) continue;
        if (filter?.functionName && transition?.function !== filter.functionName) continue;

        const outputs = Array.isArray(transition?.outputs) ? transition.outputs : [];
        for (const output of outputs) {
            if (typeof output?.value !== 'string') continue;
            const value = output.value.trim();
            if (/^record1[0-9a-z]+$/i.test(value)) {
                return value;
            }
        }
    }

    return null;
}
