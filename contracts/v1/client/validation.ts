/**
 * Validation Schemas for Transaction Builders
 * 
 * Mirrors contract constraints exactly from INTERFACE_LOCK.md
 */

import { z } from 'zod';
import { MAX_BID_AMOUNT, ERROR_CODES } from './types';

// ============================================================================
// Zod Schemas (Runtime Validation)
// ============================================================================

/** Field type validation (non-zero hex string) */
export const fieldSchema = z.string()
    .regex(/^[0-9]+field$/, 'Field must be numeric with "field" suffix')
    .refine(val => val !== '0field', { message: 'Field cannot be zero' });

/** Address validation (Aleo bech32m) */
export const addressSchema = z.string()
    .regex(/^aleo1[a-z0-9]{58}$/, 'Invalid Aleo address format');

/** u8 validation (0-255) */
export const u8Schema = z.number()
    .int()
    .min(0)
    .max(255);

/** u32 validation (0-4294967295) */
export const u32Schema = z.number()
    .int()
    .min(0)
    .max(4294967295);

/** u64 validation (BigInt, 0 to 2^64-1) */
export const u64Schema = z.bigint()
    .min(0n)
    .max(18446744073709551615n);

// ============================================================================
// Transition-Specific Validation Schemas
// ============================================================================

/**
 * create_rfq validation
 * 
 * Constraints:
 * - rfq_id != 0
 * - bidding_deadline > current_block
 * - reveal_deadline > bidding_deadline
 * - min_bid > 0 && min_bid < MAX_BID_AMOUNT
 */
export const createRFQSchema = z.object({
    rfq_id: fieldSchema,
    bidding_deadline: u32Schema,
    reveal_deadline: u32Schema,
    min_bid: u64Schema.refine(val => val > 0n, {
        message: 'min_bid must be > 0',
    }).refine(val => val < MAX_BID_AMOUNT, {
        message: `min_bid must be < ${MAX_BID_AMOUNT}`,
    }),
    current_block: u32Schema,
}).refine(data => data.bidding_deadline > data.current_block, {
    message: 'bidding_deadline must be > current_block',
    path: ['bidding_deadline'],
}).refine(data => data.reveal_deadline > data.bidding_deadline, {
    message: 'reveal_deadline must be > bidding_deadline',
    path: ['reveal_deadline'],
});

/**
 * submit_bid_commit validation
 * 
 * Constraints:
 * - bid_amount >= min_bid (must check against RFQ state)
 * - bid_amount < MAX_BID_AMOUNT
 * - stake >= (bid_amount * 10) / 100  (10% minimum)
 * - current_block < bidding_deadline (must check against RFQ state)
 * - user_nonce == stored_nonce + 1 (must check against chain state)
 */
export const submitBidCommitSchema = z.object({
    rfq_id: fieldSchema,
    bid_amount: u64Schema.refine(val => val > 0n && val < MAX_BID_AMOUNT, {
        message: `bid_amount must be > 0 and < ${MAX_BID_AMOUNT}`,
    }),
    nonce: fieldSchema,
    stake: u64Schema,
    bid_id: fieldSchema,
    current_block: u32Schema,
    user_nonce: u64Schema,
}).refine(data => data.stake >= (data.bid_amount * 10n) / 100n, {
    message: 'stake must be >= 10% of bid_amount',
    path: ['stake'],
});

/**
 * close_bidding validation
 * 
 * Constraints:
 * - current_block >= bidding_deadline (must check against RFQ state)
 * - caller == rfq_creator (must check against RFQ state)
 */
export const closeBiddingSchema = z.object({
    rfq_id: fieldSchema,
    current_block: u32Schema,
});

/**
 * reveal_bid validation
 * 
 * Constraints:
 * - current_block < reveal_deadline (must check against RFQ state)
 * - BHP256(bid_amount) == stored_commitment (checked in contract)
 * - bid_amount < MAX_BID_AMOUNT
 * - user_nonce == stored_nonce + 1 (must check against chain state)
 */
export const revealBidSchema = z.object({
    rfq_id: fieldSchema,
    bid_id: fieldSchema,
    bid_amount: u64Schema.refine(val => val > 0n && val < MAX_BID_AMOUNT, {
        message: `bid_amount must be > 0 and < ${MAX_BID_AMOUNT}`,
    }),
    nonce: fieldSchema,
    current_block: u32Schema,
    user_nonce: u64Schema,
});

/**
 * select_winner validation
 * 
 * Constraints:
 * - current_block >= reveal_deadline (must check against RFQ state)
 * - winning_bid_id must be revealed (must check against chain state)
 * - caller == rfq_creator (must check against RFQ state)
 */
export const selectWinnerSchema = z.object({
    rfq_id: fieldSchema,
    winning_bid_id: fieldSchema,
    current_block: u32Schema,
});

/**
 * slash_non_revealer validation
 * 
 * Constraints:
 * - current_block > reveal_deadline (must check against RFQ state)
 * - bid_commitments[bid_id] exists (must check against chain state)
 * - revealed_bids[bid_id] NOT exists (must check against chain state)
 */
export const slashNonRevealerSchema = z.object({
    rfq_id: fieldSchema,
    bid_id: fieldSchema,
    current_block: u32Schema,
});

/**
 * refund_stake validation
 * 
 * Constraints:
 * - bid_id != winning_bid_id (must check against RFQ state)
 * - revealed_bids[bid_id] exists (must check against chain state)
 */
export const refundStakeSchema = z.object({
    rfq_id: fieldSchema,
    bid_id: fieldSchema,
});

/**
 * fund_escrow validation
 * 
 * Constraints:
 * - amount >= winning_bid_amount (must check against RFQ state)
 * - caller == rfq_creator (must check against RFQ state)
 * - amount < MAX_BID_AMOUNT
 */
export const fundEscrowSchema = z.object({
    rfq_id: fieldSchema,
    amount: u64Schema.refine(val => val > 0n && val < MAX_BID_AMOUNT, {
        message: `amount must be > 0 and < ${MAX_BID_AMOUNT}`,
    }),
    current_block: u32Schema,
});

/**
 * release_partial_payment validation
 * 
 * Constraints:
 * - percentage > 0 && percentage <= 100
 * - total_released + amount <= escrow_total (must check against chain state)
 * - caller == rfq_creator (must check against RFQ state)
 * - user_nonce == stored_nonce + 1 (must check against chain state)
 */
export const releasePartialPaymentSchema = z.object({
    rfq_id: fieldSchema,
    percentage: u8Schema.refine(val => val > 0 && val <= 100, {
        message: 'percentage must be > 0 and <= 100',
    }),
    recipient: addressSchema,
    current_block: u32Schema,
    user_nonce: u64Schema,
});

/**
 * release_final_payment validation
 * 
 * Constraints:
 * - escrow_amounts[rfq_id] > 0 (must check against chain state)
 * - final_payment_released[rfq_id] == false (must check against chain state)
 * - caller == rfq_creator (must check against RFQ state)
 * - user_nonce == stored_nonce + 1 (must check against chain state)
 */
export const releaseFinalPaymentSchema = z.object({
    rfq_id: fieldSchema,
    recipient: addressSchema,
    current_block: u32Schema,
    user_nonce: u64Schema,
});

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationSuccess {
    valid: true;
}

export interface ValidationError {
    valid: false;
    error: string;
    code: number;
    path?: string[];
}

export type ValidationResult = ValidationSuccess | ValidationError;

// ============================================================================
// Validation Helper
// ============================================================================

export function validateSchema<T>(
    schema: z.ZodSchema<T>,
    data: unknown,
    errorCode: number = ERROR_CODES.INVALID_RFQ_ID
): ValidationResult {
    const result = schema.safeParse(data);

    if (result.success) {
        return { valid: true };
    }

    const firstError = result.error.errors[0];
    return {
        valid: false,
        error: firstError.message,
        code: errorCode,
        path: firstError.path.map(p => String(p)),
    };
}
