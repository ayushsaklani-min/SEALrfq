/**
 * submit_bid_commit Transaction Builder
 * 
 * Builds and validates submit_bid_commit transition with replay protection.
 */

import type {
    SubmitBidCommitParams,
    Address,
} from '../types';
import type {
    PreparedResult,
    AleoTransaction,
} from '../result-types';
import {
    submitBidCommitSchema,
    validateSchema,
    type ValidationResult,
} from '../validation';
import type { NonceManager, PrivateInputManager } from '../managers';
import { ERROR_CODES } from '../types';

// ============================================================================
// submit_bid_commit Builder
// ============================================================================

export class SubmitBidCommitBuilder {
    private readonly PROGRAM = 'sealrfq_v1.aleo';
    private readonly FUNCTION = 'submit_bid_commit';

    constructor(
        private nonceManager: NonceManager,
        private privateInputManager: PrivateInputManager
    ) { }

    /**
     * Validate parameters against contract constraints
     * 
     * Mirrors contract validation:
     * - bid_amount > 0 && bid_amount < MAX_BID_AMOUNT
     * - bid_amount >= min_bid (checked against RFQ state)
     * - stake >= (bid_amount * 10) / 100
     * - current_block < bidding_deadline (checked against RFQ state)
     * - user_nonce == stored_nonce + 1
     */
    async validate(
        params: SubmitBidCommitParams,
        actor: Address
    ): Promise<ValidationResult> {
        // Schema validation
        const schemaResult = validateSchema(
            submitBidCommitSchema,
            params,
            ERROR_CODES.INVALID_MIN_BID
        );
        if (!schemaResult.valid) return schemaResult;

        // Nonce validation (replay protection)
        const nonceValidation = await this.nonceManager.validate(
            actor,
            'commit',
            params.user_nonce
        );
        if (!nonceValidation.valid) {
            return {
                valid: false,
                error: `Invalid nonce: expected ${nonceValidation.expected}, got ${params.user_nonce}`,
                code: ERROR_CODES.REPLAY_ATTACK,
                path: ['user_nonce'],
            };
        }

        return { valid: true };
    }

    /**
     * Build transaction with private inputs
     * 
     * bid_amount and nonce are PRIVATE (not visible on chain)
     */
    async build(
        params: SubmitBidCommitParams,
        actor: Address
    ): Promise<PreparedResult> {
        // Validate
        const validation = await this.validate(params, actor);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.error}`);
        }

        // Store private inputs for later reveal
        await this.privateInputManager.storePrivateInputs(params.bid_id, {
            bid_amount: params.bid_amount,
            nonce: params.nonce,
            bid_id: params.bid_id,
        });

        // Generate commitment
        const commitment = this.privateInputManager.generateCommitment(
            params.bid_amount,
            params.nonce
        );

        // Deterministic input serialization
        // Note: indices 0-1 are PRIVATE (bid_amount, nonce)
        const inputs = [
            params.rfq_id,                          // public Field
            params.bid_amount.toString() + 'u64',   // PRIVATE u64 (index 0)
            params.nonce,                           // PRIVATE Field (index 1)
            params.stake.toString() + 'u64',        // public u64
            params.bid_id,                          // public Field
            params.current_block.toString(),        // public u32
            params.user_nonce.toString() + 'u64',   // public u64
        ];

        // Mark private inputs
        const privateInputs = new Map<number, string>();
        privateInputs.set(1, params.bid_amount.toString() + 'u64'); // bid_amount
        privateInputs.set(2, params.nonce);                         // nonce

        const transaction: AleoTransaction = {
            program: this.PROGRAM,
            function: this.FUNCTION,
            inputs,
            privateInputs,
            fee: 2000000n,  // 0.002 credits (more complex, has finalize)
        };

        return {
            status: 'prepared',
            transaction,
            estimatedGas: 2000000n,
        };
    }

    estimateGas(): bigint {
        return 2000000n;
    }
}
