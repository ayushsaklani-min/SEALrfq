/**
 * Transaction Executor
 * 
 * Executes prepared transactions with retry logic for transient failures.
 */

import type { Address } from './types';
import type {
    TransactionResult,
    PreparedResult,
    SubmittedResult,
    ConfirmedResult,
    RejectedResult,
    AleoTransaction,
} from './result-types';
import { isRetryableError, extractErrorCode } from './result-types';
import type { NonceManager } from './managers';

// ============================================================================
// Aleo Network Interface (Abstract)
// ============================================================================

export interface AleoNetwork {
    /** Submit transaction to network */
    submit(tx: AleoTransaction): Promise<string>; // returns txId

    /** Get transaction status */
    getStatus(txId: string): Promise<'pending' | 'confirmed' | 'rejected'>;

    /** Get transaction error (if rejected) */
    getError(txId: string): Promise<string | null>;

    /** Get current block height */
    getCurrentBlock(): Promise<number>;
}

// ============================================================================
// Execution Options
// ============================================================================

export interface ExecutionOptions {
    /** Maximum retry attempts for transient failures */
    maxRetries?: number;

    /** Delay between retries (ms) */
    retryDelay?: number;

    /** Timeout for tx confirmation (ms) */
    confirmationTimeout?: number;

    /** Poll interval for status checks (ms) */
    pollInterval?: number;
}

const DEFAULT_OPTIONS: Required<ExecutionOptions> = {
    maxRetries: 3,
    retryDelay: 2000,
    confirmationTimeout: 300000, // 5 minutes
    pollInterval: 5000,           // 5 seconds
};

// ============================================================================
// Transaction Executor
// ============================================================================

export class TransactionExecutor {
    constructor(
        private network: AleoNetwork,
        private nonceManager: NonceManager
    ) { }

    /**
     * Execute prepared transaction with retry logic
     * 
     * Returns typed result: submitted | confirmed | rejected
     */
    async execute(
        prepared: PreparedResult,
        actor: Address,
        options: ExecutionOptions = {}
    ): Promise<TransactionResult> {
        const opts = { ...DEFAULT_OPTIONS, ...options };

        let lastError: string | undefined;

        for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
            try {
                // Submit transaction
                const submitted = await this.submit(prepared.transaction);

                // Wait for confirmation
                const result = await this.waitForConfirmation(
                    submitted.txId,
                    opts.confirmationTimeout,
                    opts.pollInterval
                );

                // If confirmed, increment nonces
                if (result.status === 'confirmed') {
                    await this.incrementNoncesIfNeeded(prepared.transaction, actor);
                }

                return result;

            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);

                // Check if retryable
                if (!isRetryableError(lastError)) {
                    // Logical rejection - do NOT retry
                    return {
                        status: 'rejected',
                        error: lastError,
                        errorCode: extractErrorCode(lastError),
                        isRetryable: false,
                    };
                }

                // Transient error - retry if attempts remaining
                if (attempt < opts.maxRetries) {
                    await this.sleep(opts.retryDelay);
                    continue;
                }
            }
        }

        // All retries failed
        return {
            status: 'rejected',
            error: lastError ?? 'Unknown error',
            errorCode: 0,
            isRetryable: true,
        };
    }

    /**
     * Submit transaction to network
     */
    private async submit(tx: AleoTransaction): Promise<SubmittedResult> {
        const txId = await this.network.submit(tx);

        return {
            status: 'submitted',
            txId,
            submittedAt: new Date(),
        };
    }

    /**
     * Wait for transaction confirmation with polling
     */
    private async waitForConfirmation(
        txId: string,
        timeout: number,
        pollInterval: number
    ): Promise<ConfirmedResult | RejectedResult> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const status = await this.network.getStatus(txId);

            if (status === 'confirmed') {
                const blockHeight = await this.network.getCurrentBlock();
                return {
                    status: 'confirmed',
                    txId,
                    blockHeight,
                    confirmedAt: new Date(),
                };
            }

            if (status === 'rejected') {
                const error = await this.network.getError(txId) ?? 'Transaction rejected';
                return {
                    status: 'rejected',
                    txId,
                    error,
                    errorCode: extractErrorCode(error),
                    isRetryable: false,
                };
            }

            // Still pending, wait and poll again
            await this.sleep(pollInterval);
        }

        // Timeout
        return {
            status: 'rejected',
            txId,
            error: 'Confirmation timeout',
            errorCode: 0,
            isRetryable: true,
        };
    }

    /**
     * Increment nonces for transitions that use replay protection
     */
    private async incrementNoncesIfNeeded(
        tx: AleoTransaction,
        actor: Address
    ): Promise<void> {
        // Transitions with replay protection:
        // - submit_bid_commit (commit nonce)
        // - reveal_bid (reveal nonce)
        // - release_partial_payment (payment nonce)
        // - release_final_payment (payment nonce)

        if (tx.function === 'submit_bid_commit') {
            await this.nonceManager.increment(actor, 'commit');
        } else if (tx.function === 'reveal_bid') {
            await this.nonceManager.increment(actor, 'reveal');
        } else if (tx.function === 'release_partial_payment' || tx.function === 'release_final_payment') {
            await this.nonceManager.increment(actor, 'payment');
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
