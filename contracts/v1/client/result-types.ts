/**
 * Transaction Result Types
 * 
 * Typed results for transaction lifecycle: prepared | submitted | confirmed | rejected
 */

import type { Field } from './types';

// ============================================================================
// Transaction Status
// ============================================================================

export type TransactionStatus = 'prepared' | 'submitted' | 'confirmed' | 'rejected';

// ============================================================================
// Result Types
// ============================================================================

/**
 * Transaction prepared successfully (validated, ready to sign/submit)
 */
export interface PreparedResult {
    status: 'prepared';
    transaction: AleoTransaction;
    estimatedGas: bigint;
}

/**
 * Transaction submitted to network
 */
export interface SubmittedResult {
    status: 'submitted';
    txId: string;
    submittedAt: Date;
}

/**
 * Transaction confirmed on chain
 */
export interface ConfirmedResult {
    status: 'confirmed';
    txId: string;
    blockHeight: number;
    confirmedAt: Date;
}

/**
 * Transaction rejected (logical or network error)
 */
export interface RejectedResult {
    status: 'rejected';
    txId?: string;
    error: string;
    errorCode: number;
    isRetryable: boolean;  // true for network errors, false for logical errors
}

/**
 * Union type for all transaction results
 */
export type TransactionResult =
    | PreparedResult
    | SubmittedResult
    | ConfirmedResult
    | RejectedResult;

// ============================================================================
// Aleo Transaction Type (Simplified)
// ============================================================================

export interface AleoTransaction {
    /** Program name (e.g., "sealrfq_v1.aleo") */
    program: string;

    /** Function name (e.g., "create_rfq") */
    function: string;

    /** Serialized inputs */
    inputs: string[];

    /** Private inputs (not revealed on chain) */
    privateInputs?: Map<number, string>;  // index -> value

    /** Fee (in credits) */
    fee: bigint;

    /** Fee record (if using private fee) */
    feeRecord?: string;
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Determine if error is retryable (network/transient) or not (logical rejection)
 */
export function isRetryableError(error: string): boolean {
    const retryablePatterns = [
        'network timeout',
        'connection refused',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'service unavailable',
        '503',
        'rate limit',
        '429',
        'insufficient gas',  // Can retry with higher gas
        'nonce too low',     // Can retry with updated nonce
    ];

    const errorLower = error.toLowerCase();
    return retryablePatterns.some(pattern => errorLower.includes(pattern.toLowerCase()));
}

/**
 * Extract error code from contract rejection
 */
export function extractErrorCode(error: string): number {
    const match = error.match(/error code:?\s*(\d+)/i);
    return match ? parseInt(match[1], 10) : 0;
}
