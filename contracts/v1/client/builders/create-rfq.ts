/**
 * create_rfq Transaction Builder
 * 
 * Builds and validates create_rfq transition.
 */

import type {
    CreateRFQParams,
    Field,
    u32,
    u64,
} from '../types';
import type {
    TransactionResult,
    AleoTransaction,
    PreparedResult,
} from '../result-types';
import {
    createRFQSchema,
    validateSchema,
    type ValidationResult,
} from '../validation';
import { ERROR_CODES } from '../types';

// ============================================================================
// create_rfq Builder
// ============================================================================

export class CreateRFQBuilder {
    private readonly PROGRAM = 'sealrfq_v1.aleo';
    private readonly FUNCTION = 'create_rfq';

    /**
     * Validate parameters against contract constraints
     * 
     * Mirrors contract validation:
     * - rfq_id != 0
     * - bidding_deadline > current_block
     * - reveal_deadline > bidding_deadline
     * - min_bid > 0 && min_bid < MAX_BID_AMOUNT
     */
    validate(params: CreateRFQParams): ValidationResult {
        return validateSchema(
            createRFQSchema,
            params,
            ERROR_CODES.INVALID_RFQ_ID
        );
    }

    /**
     * Build transaction (deterministic serialization)
     * 
     * Returns prepared transaction ready for signing.
     */
    build(params: CreateRFQParams): PreparedResult {
        // Validate first
        const validation = this.validate(params);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.error}`);
        }

        // Deterministic input serialization (exactly as contract expects)
        const inputs = [
            params.rfq_id,                          // Field
            params.bidding_deadline.toString(),     // u32
            params.reveal_deadline.toString(),      // u32
            params.min_bid.toString() + 'u64',      // u64
            params.current_block.toString(),        // u32
        ];

        const transaction: AleoTransaction = {
            program: this.PROGRAM,
            function: this.FUNCTION,
            inputs,
            fee: 1000000n,  // 0.001 credits (estimate)
        };

        return {
            status: 'prepared',
            transaction,
            estimatedGas: 1000000n,
        };
    }

    /**
     * Estimate gas for this transition
     */
    estimateGas(): bigint {
        // Simple transitions: ~0.001 credits
        return 1000000n;
    }
}
