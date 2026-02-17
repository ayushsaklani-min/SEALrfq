/**
 * Transaction Builders Index
 * 
 * Remaining 8 builders for transitions 3-10.
 */

import type { Address } from '../types';
import type { PreparedResult, AleoTransaction } from '../result-types';
import type { ValidationResult } from '../validation';
import * as schemas from '../validation';
import { ERROR_CODES } from '../types';

// ============================================================================
// 3. close_bidding
// ============================================================================

export class CloseBiddingBuilder {
    private readonly PROGRAM = 'sealrfq_v1.aleo';
    private readonly FUNCTION = 'close_bidding';

    validate(params: import('../types').CloseBiddingParams): ValidationResult {
        return schemas.validateSchema(schemas.closeBiddingSchema, params, ERROR_CODES.WRONG_STATUS);
    }

    build(params: import('../types').CloseBiddingParams): PreparedResult {
        const validation = this.validate(params);
        if (!validation.valid) throw new Error(validation.error);

        const inputs = [params.rfq_id, params.current_block.toString()];
        return {
            status: 'prepared',
            transaction: { program: this.PROGRAM, function: this.FUNCTION, inputs, fee: 1000000n },
            estimatedGas: 1000000n,
        };
    }
}

// ============================================================================
// 4. reveal_bid
// ============================================================================

export class RevealBidBuilder {
    private readonly PROGRAM = 'sealrfq_v1.aleo';
    private readonly FUNCTION = 'reveal_bid';

    constructor(private nonceManager: import('../managers').NonceManager) { }

    async validate(params: import('../types').RevealBidParams, actor: Address): Promise<ValidationResult> {
        const schemaResult = schemas.validateSchema(schemas.revealBidSchema, params, ERROR_CODES.INVALID_MIN_BID);
        if (!schemaResult.valid) return schemaResult;

        const nonceValidation = await this.nonceManager.validate(actor, 'reveal', params.user_nonce);
        if (!nonceValidation.valid) {
            return {
                valid: false,
                error: `Invalid nonce: expected ${nonceValidation.expected}`,
                code: ERROR_CODES.REPLAY_ATTACK,
                path: ['user_nonce'],
            };
        }
        return { valid: true };
    }

    async build(params: import('../types').RevealBidParams, actor: Address): Promise<PreparedResult> {
        const validation = await this.validate(params, actor);
        if (!validation.valid) throw new Error(validation.error);

        const inputs = [
            params.rfq_id,
            params.bid_id,
            params.bid_amount.toString() + 'u64', // PRIVATE
            params.nonce, // PRIVATE
            params.current_block.toString(),
            params.user_nonce.toString() + 'u64',
        ];

        const privateInputs = new Map<number, string>();
        privateInputs.set(2, params.bid_amount.toString() + 'u64');
        privateInputs.set(3, params.nonce);

        return {
            status: 'prepared',
            transaction: { program: this.PROGRAM, function: this.FUNCTION, inputs, privateInputs, fee: 2000000n },
            estimatedGas: 2000000n,
        };
    }
}

// ============================================================================
// 5. select_winner
// ============================================================================

export class SelectWinnerBuilder {
    private readonly PROGRAM = 'sealrfq_v1.aleo';
    private readonly FUNCTION = 'select_winner';

    validate(params: import('../types').SelectWinnerParams): ValidationResult {
        return schemas.validateSchema(schemas.selectWinnerSchema, params, ERROR_CODES.WRONG_STATUS);
    }

    build(params: import('../types').SelectWinnerParams): PreparedResult {
        const validation = this.validate(params);
        if (!validation.valid) throw new Error(validation.error);

        const inputs = [params.rfq_id, params.winning_bid_id, params.current_block.toString()];
        return {
            status: 'prepared',
            transaction: { program: this.PROGRAM, function: this.FUNCTION, inputs, fee: 1500000n },
            estimatedGas: 1500000n,
        };
    }
}

// ============================================================================
// 6. slash_non_revealer
// ============================================================================

export class SlashNonRevealerBuilder {
    private readonly PROGRAM = 'sealrfq_v1.aleo';
    private readonly FUNCTION = 'slash_non_revealer';

    validate(params: import('../types').SlashNonRevealerParams): ValidationResult {
        return schemas.validateSchema(schemas.slashNonRevealerSchema, params, ERROR_CODES.DEADLINE_VIOLATION);
    }

    build(params: import('../types').SlashNonRevealerParams): PreparedResult {
        const validation = this.validate(params);
        if (!validation.valid) throw new Error(validation.error);

        const inputs = [params.rfq_id, params.bid_id, params.current_block.toString()];
        return {
            status: 'prepared',
            transaction: { program: this.PROGRAM, function: this.FUNCTION, inputs, fee: 1000000n },
            estimatedGas: 1000000n,
        };
    }
}

// ============================================================================
// 7. refund_stake
// ============================================================================

export class RefundStakeBuilder {
    private readonly PROGRAM = 'sealrfq_v1.aleo';
    private readonly FUNCTION = 'refund_stake';

    validate(params: import('../types').RefundStakeParams): ValidationResult {
        return schemas.validateSchema(schemas.refundStakeSchema, params, ERROR_CODES.WRONG_STATUS);
    }

    build(params: import('../types').RefundStakeParams): PreparedResult {
        const validation = this.validate(params);
        if (!validation.valid) throw new Error(validation.error);

        const inputs = [params.rfq_id, params.bid_id];
        return {
            status: 'prepared',
            transaction: { program: this.PROGRAM, function: this.FUNCTION, inputs, fee: 1000000n },
            estimatedGas: 1000000n,
        };
    }
}

// ============================================================================
// 8. fund_escrow
// ============================================================================

export class FundEscrowBuilder {
    private readonly PROGRAM = 'sealrfq_v1.aleo';
    private readonly FUNCTION = 'fund_escrow';

    validate(params: import('../types').FundEscrowParams): ValidationResult {
        return schemas.validateSchema(schemas.fundEscrowSchema, params, ERROR_CODES.ESCROW_VIOLATION);
    }

    build(params: import('../types').FundEscrowParams): PreparedResult {
        const validation = this.validate(params);
        if (!validation.valid) throw new Error(validation.error);

        const inputs = [params.rfq_id, params.amount.toString() + 'u64', params.current_block.toString()];
        return {
            status: 'prepared',
            transaction: { program: this.PROGRAM, function: this.FUNCTION, inputs, fee: 1500000n },
            estimatedGas: 1500000n,
        };
    }
}

// ============================================================================
// 9. release_partial_payment
// ============================================================================

export class ReleasePartialPaymentBuilder {
    private readonly PROGRAM = 'sealrfq_v1.aleo';
    private readonly FUNCTION = 'release_partial_payment';

    constructor(private nonceManager: import('../managers').NonceManager) { }

    async validate(params: import('../types').ReleasePartialPaymentParams, actor: Address): Promise<ValidationResult> {
        const schemaResult = schemas.validateSchema(schemas.releasePartialPaymentSchema, params, ERROR_CODES.ESCROW_VIOLATION);
        if (!schemaResult.valid) return schemaResult;

        const nonceValidation = await this.nonceManager.validate(actor, 'payment', params.user_nonce);
        if (!nonceValidation.valid) {
            return {
                valid: false,
                error: `Invalid nonce: expected ${nonceValidation.expected}`,
                code: ERROR_CODES.REPLAY_ATTACK,
                path: ['user_nonce'],
            };
        }
        return { valid: true };
    }

    async build(params: import('../types').ReleasePartialPaymentParams, actor: Address): Promise<PreparedResult> {
        const validation = await this.validate(params, actor);
        if (!validation.valid) throw new Error(validation.error);

        const inputs = [
            params.rfq_id,
            params.percentage.toString(),
            params.recipient,
            params.current_block.toString(),
            params.user_nonce.toString() + 'u64',
        ];

        return {
            status: 'prepared',
            transaction: { program: this.PROGRAM, function: this.FUNCTION, inputs, fee: 1500000n },
            estimatedGas: 1500000n,
        };
    }
}

// ============================================================================
// 10. release_final_payment
// ============================================================================

export class ReleaseFinalPaymentBuilder {
    private readonly PROGRAM = 'sealrfq_v1.aleo';
    private readonly FUNCTION = 'release_final_payment';

    constructor(private nonceManager: import('../managers').NonceManager) { }

    async validate(params: import('../types').ReleaseFinalPaymentParams, actor: Address): Promise<ValidationResult> {
        const schemaResult = schemas.validateSchema(schemas.releaseFinalPaymentSchema, params, ERROR_CODES.ESCROW_VIOLATION);
        if (!schemaResult.valid) return schemaResult;

        const nonceValidation = await this.nonceManager.validate(actor, 'payment', params.user_nonce);
        if (!nonceValidation.valid) {
            return {
                valid: false,
                error: `Invalid nonce: expected ${nonceValidation.expected}`,
                code: ERROR_CODES.REPLAY_ATTACK,
                path: ['user_nonce'],
            };
        }
        return { valid: true };
    }

    async build(params: import('../types').ReleaseFinalPaymentParams, actor: Address): Promise<PreparedResult> {
        const validation = await this.validate(params, actor);
        if (!validation.valid) throw new Error(validation.error);

        const inputs = [
            params.rfq_id,
            params.recipient,
            params.current_block.toString(),
            params.user_nonce.toString() + 'u64',
        ];

        return {
            status: 'prepared',
            transaction: { program: this.PROGRAM, function: this.FUNCTION, inputs, fee: 1500000n },
            estimatedGas: 1500000n,
        };
    }
}
