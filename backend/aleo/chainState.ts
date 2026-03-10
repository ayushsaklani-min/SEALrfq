/**
 * AleoChainState — concrete implementation of the ChainState interface
 * used by the ReconciliationJob.
 *
 * Queries the Aleo RPC endpoint to determine on-chain transaction status
 * and whether a canonical action was already executed.
 */

import type { ChainState } from '../tx/reconciliation';

const ENDPOINT  = process.env.ALEO_RPC_URL  || 'https://api.explorer.provable.com/v1';
const NETWORK   = process.env.ALEO_NETWORK  || 'testnet';
const PROGRAM   = process.env.ALEO_PROGRAM_ID || 'sealrfq_v9.aleo';
const TIMEOUT_MS = Number(process.env.ALEO_RPC_TIMEOUT_MS || '10000');

async function rpcFetch(path: string): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(`${ENDPOINT}/${NETWORK}/${path}`, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function extractPlaintext(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value?.plaintext === 'string') return value.plaintext;
    if (typeof value?.value === 'string') return value.value;
    if (typeof value?.data === 'string') return value.data;
    return null;
}

export async function getProgramMappingValue(mapping: string, key: string): Promise<any | null> {
    return rpcFetch(`program/${PROGRAM}/mapping/${mapping}/${encodeURIComponent(key)}`);
}

export async function getWinnerAcceptedState(rfqId: string): Promise<boolean | null> {
    const value = await getProgramMappingValue('rfq_winner_accepted', rfqId);
    if (value === null || value === undefined) {
        return null;
    }

    const plaintext = extractPlaintext(value)?.trim().toLowerCase();
    if (!plaintext) {
        return null;
    }
    if (plaintext === 'true' || plaintext === 'true.public' || plaintext === 'true.private') {
        return true;
    }
    if (plaintext === 'false' || plaintext === 'false.public' || plaintext === 'false.private') {
        return false;
    }
    if (plaintext.includes('true')) return true;
    if (plaintext.includes('false')) return false;
    return null;
}

export class AleoChainState implements ChainState {
    async getTxStatus(txHash: string): Promise<{
        status: 'pending' | 'confirmed' | 'rejected' | 'not_found';
        blockHeight?: number;
        blockHash?: string;
        error?: string;
    }> {
        // Try confirmed transaction endpoint first.
        const confirmed = await rpcFetch(`transaction/${txHash}`);
        if (confirmed) {
            const blockHeight = confirmed?.block_height ?? confirmed?.height ?? undefined;
            const blockHash   = confirmed?.block_hash ?? undefined;
            return { status: 'confirmed', blockHeight, blockHash };
        }

        // Check mempool for pending.
        const mempool = await rpcFetch(`memoryPool/transactions`);
        if (Array.isArray(mempool) && mempool.some((t: any) => t.id === txHash || t.transaction_id === txHash)) {
            return { status: 'pending' };
        }

        // Check rejected/aborted endpoint.
        const aborted = await rpcFetch(`transaction/aborted/${txHash}`);
        if (aborted) {
            return { status: 'rejected', error: aborted?.error ?? 'Transaction was aborted' };
        }

        return { status: 'not_found' };
    }

    async wasActionExecuted(canonicalTxKey: string): Promise<{
        executed: boolean;
        txHash?: string;
        blockHeight?: number;
    }> {
        // canonical key format: "transition_name:rfqId" or "transition_name:wallet:rfqId:bidId"
        const parts = canonicalTxKey.split(':');
        const transition = parts[0];
        // The last part is typically the rfqId or bidId — use it to search program mappings.
        const subjectId = parts[parts.length - 1];

        // Query on-chain program mapping to see if this RFQ/bid exists.
        // For create_rfq, check rfq_status mapping.
        // For submit_bid_commit, check bid_commitment mapping.
        // For others, we'd need transition-specific logic.
        const mappingKey = getMappingKeyForTransition(transition, subjectId);
        if (!mappingKey) {
            return { executed: false };
        }

        const { mapping, key } = mappingKey;
        const result = await getProgramMappingValue(mapping, key);
        if (result !== null && result !== undefined) {
            // Mapping value exists → action was executed. We don't have the txHash here.
            return { executed: true };
        }

        return { executed: false };
    }
}

function getMappingKeyForTransition(
    transition: string,
    subjectId: string,
): { mapping: string; key: string } | null {
    switch (transition) {
        case 'create_rfq':
            return { mapping: 'rfq_status', key: subjectId };
        case 'submit_bid_commit':
            return { mapping: 'bid_commitments', key: subjectId };
        case 'fund_escrow':
            return { mapping: 'escrow_amounts', key: subjectId };
        case 'select_winner':
            return { mapping: 'rfq_winner', key: subjectId };
        default:
            return null;
    }
}
