/**
 * Nonce Manager for Replay Protection
 * 
 * Tracks per-actor nonces for commit, reveal, and payment actions.
 * Ensures strict monotonic increment (expected == stored + 1).
 */

import type { Address, u64, Field } from './types';

// ============================================================================
// Nonce Action Types
// ============================================================================

export type NonceAction = 'commit' | 'reveal' | 'payment';

// ============================================================================
// Nonce Storage Interface
// ============================================================================

export interface NonceStorage {
    /** Get current nonce for actor+action */
    getNonce(actor: Address, action: NonceAction): Promise<u64>;

    /** Set nonce for actor+action */
    setNonce(actor: Address, action: NonceAction, nonce: u64): Promise<void>;

    /** Increment nonce for actor+action */
    incrementNonce(actor: Address, action: NonceAction): Promise<u64>;
}

// ============================================================================
// In-Memory Nonce Storage (for testing)
// ============================================================================

export class InMemoryNonceStorage implements NonceStorage {
    private nonces: Map<string, u64> = new Map();

    private getKey(actor: Address, action: NonceAction): string {
        return `${actor}:${action}`;
    }

    async getNonce(actor: Address, action: NonceAction): Promise<u64> {
        const key = this.getKey(actor, action);
        return this.nonces.get(key) ?? 0n;
    }

    async setNonce(actor: Address, action: NonceAction, nonce: u64): Promise<void> {
        const key = this.getKey(actor, action);
        this.nonces.set(key, nonce);
    }

    async incrementNonce(actor: Address, action: NonceAction): Promise<u64> {
        const current = await this.getNonce(actor, action);
        const next = current + 1n;
        await this.setNonce(actor, action, next);
        return next;
    }
}

// ============================================================================
// Nonce Manager
// ============================================================================

export class NonceManager {
    constructor(private storage: NonceStorage) { }

    /**
     * Get next nonce for actor+action (current + 1)
     * 
     * This is the nonce that should be used in the next transaction.
     */
    async getNextNonce(actor: Address, action: NonceAction): Promise<u64> {
        const current = await this.storage.getNonce(actor, action);
        return current + 1n;
    }

    /**
     * Get current nonce for actor+action
     */
    async getCurrentNonce(actor: Address, action: NonceAction): Promise<u64> {
        return await this.storage.getNonce(actor, action);
    }

    /**
     * Increment nonce after successful transaction confirmation
     * 
     * IMPORTANT: Only call this after tx is CONFIRMED, not just submitted.
     */
    async increment(actor: Address, action: NonceAction): Promise<void> {
        await this.storage.incrementNonce(actor, action);
    }

    /**
     * Validate that user-provided nonce matches expected value
     * 
     * Contract enforces: user_nonce == stored_nonce + 1
     */
    async validate(
        actor: Address,
        action: NonceAction,
        userNonce: u64
    ): Promise<{ valid: boolean; expected: u64 }> {
        const expected = await this.getNextNonce(actor, action);
        return {
            valid: userNonce === expected,
            expected,
        };
    }

    /**
     * Sync nonces from  chain state (fetch from contract mappings)
     * 
     * Call this periodically or after detecting nonce mismatch.
     */
    async syncFromChain(
        actor: Address,
        chainNonces: { commit: u64; reveal: u64; payment: u64 }
    ): Promise<void> {
        await this.storage.setNonce(actor, 'commit', chainNonces.commit);
        await this.storage.setNonce(actor, 'reveal', chainNonces.reveal);
        await this.storage.setNonce(actor, 'payment', chainNonces.payment);
    }
}

// ============================================================================
// Private Input Manager (for bid_amount and nonce)
// ============================================================================

export interface PrivateInputs {
    bid_amount: u64;
    nonce: Field;
    bid_id: Field;
}

export interface PrivateInputStorage {
    /** Store private inputs for later retrieval */
    store(bid_id: Field, inputs: PrivateInputs): Promise<void>;

    /** Retrieve private inputs */
    get(bid_id: Field): Promise<PrivateInputs | null>;

    /** Delete private inputs (after reveal) */
    delete(bid_id: Field): Promise<void>;
}

export class PrivateInputManager {
    constructor(private storage: PrivateInputStorage) { }

    /**
     * Store private inputs securely for later reveal
     * 
     * In production: encrypt with user's key before storage
     */
    async storePrivateInputs(bid_id: Field, inputs: PrivateInputs): Promise<void> {
        await this.storage.store(bid_id, inputs);
    }

    /**
     * Retrieve private inputs for reveal
     */
    async getPrivateInputs(bid_id: Field): Promise<PrivateInputs | null> {
        return await this.storage.get(bid_id);
    }

    /**
     * Delete private inputs after successful reveal
     */
    async deletePrivateInputs(bid_id: Field): Promise<void> {
        await this.storage.delete(bid_id);
    }

    /**
     * Generate commitment hash (BHP256)
     * 
     * Note: This should use actual BHP256 implementation from Leo SDK
     */
    generateCommitment(bid_amount: u64, nonce: Field): Field {
        // Placeholder - actual implementation should use @aleohq/sdk BHP256
        // const hash = BHP256.hash_to_field(bid_amount);
        return `${bid_amount}_${nonce}_commitment` as Field;
    }
}
