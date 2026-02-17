/**
 * Transaction Reconciliation Job
 * 
 * REQUIREMENT 5: Heal mismatches between tx table and chain/indexer state
 * 
 * Reconciles:
 * - Transactions marked SUBMITTED but actually confirmed on chain
 * - Transactions marked SUBMITTED but rejected on chain
 * - Transactions in PREPARED state that were actually submitted
 */

import { PrismaClient } from '@prisma/client';
import { TxStatus } from '../db/enums';
import { TransactionTracker } from './tracker';

// ============================================================================
// Chain/Indexer Interface
// ============================================================================

export interface ChainState {
    /** Get transaction status from chain */
    getTxStatus(txHash: string): Promise<{
        status: 'pending' | 'confirmed' | 'rejected' | 'not_found';
        blockHeight?: number;
        blockHash?: string;
        error?: string;
    }>;

    /** Check if canonical action was executed (by searching events) */
    wasActionExecuted(canonicalTxKey: string): Promise<{
        executed: boolean;
        txHash?: string;
        blockHeight?: number;
    }>;
}

// ============================================================================
// Reconciliation Job
// ============================================================================

export class ReconciliationJob {
    constructor(
        private prisma: PrismaClient,
        private tracker: TransactionTracker,
        private chainState: ChainState
    ) { }

    /**
     * Run full reconciliation
     */
    async reconcile(): Promise<ReconciliationReport> {
        const report: ReconciliationReport = {
            startedAt: new Date(),
            checked: 0,
            healed: 0,
            failed: 0,
            details: [],
        };

        // 1. Reconcile SUBMITTED transactions
        await this.reconcileSubmitted(report);

        // 2. Reconcile PREPARED transactions
        await this.reconcilePrepared(report);

        // 3. Detect phantom executions (executed on chain but not in our DB)
        await this.detectPhantomExecutions(report);

        report.completedAt = new Date();
        return report;
    }

    /**
     * Reconcile SUBMITTED transactions (may be confirmed/rejected on chain)
     */
    private async reconcileSubmitted(report: ReconciliationReport): Promise<void> {
        // Find all SUBMITTED transactions
        const submitted = await this.prisma.transaction.findMany({
            where: { status: TxStatus.SUBMITTED },
        });

        for (const tx of submitted) {
            if (!tx.txHash) continue;

            report.checked++;

            try {
                // Check chain status
                const chainStatus = await this.chainState.getTxStatus(tx.txHash);

                if (chainStatus.status === 'confirmed' && chainStatus.blockHeight && chainStatus.blockHash) {
                    // Heal: mark as CONFIRMED
                    await this.tracker.markConfirmed(
                        tx.txHash,
                        chainStatus.blockHeight,
                        chainStatus.blockHash,
                        { reconciled: true }
                    );

                    report.healed++;
                    report.details.push({
                        txId: tx.id,
                        txHash: tx.txHash,
                        action: 'marked_confirmed',
                        reason: 'Found confirmed on chain',
                    });

                } else if (chainStatus.status === 'rejected') {
                    // Heal: mark as REJECTED
                    await this.tracker.markRejected(
                        tx.idempotencyKey,
                        chainStatus.error ?? 'Transaction rejected on chain',
                        0,
                        'LOGICAL' as any,
                        { reconciled: true }
                    );

                    report.healed++;
                    report.details.push({
                        txId: tx.id,
                        txHash: tx.txHash,
                        action: 'marked_rejected',
                        reason: 'Found rejected on chain',
                    });
                }

                // Update reconciliation tracking
                await this.prisma.transaction.update({
                    where: { id: tx.id },
                    data: {
                        lastReconciledAt: new Date(),
                        reconcileAttempts: { increment: 1 },
                    },
                });

            } catch (error) {
                report.failed++;
                console.error(`Failed to reconcile tx ${tx.id}:`, error);
            }
        }
    }

    /**
     * Reconcile PREPARED transactions (may have been submitted but we lost track)
     */
    private async reconcilePrepared(report: ReconciliationReport): Promise<void> {
        // Find old PREPARED transactions (>10 minutes old)
        const tenMinutesAgo = new Date(Date.now() - 600000);
        const prepared = await this.prisma.transaction.findMany({
            where: {
                status: TxStatus.PREPARED,
                preparedAt: { lte: tenMinutesAgo },
            },
        });

        for (const tx of prepared) {
            report.checked++;

            try {
                // Check if the canonical action was executed on chain
                const result = await this.chainState.wasActionExecuted(tx.canonicalTxKey);

                if (result.executed && result.txHash) {
                    // Heal: mark as SUBMITTED and CONFIRMED
                    await this.tracker.markSubmitted(tx.idempotencyKey, result.txHash, { reconciled: true });

                    if (result.blockHeight) {
                        await this.tracker.markConfirmed(
                            result.txHash,
                            result.blockHeight,
                            'unknown', // We don't have block hash
                            { reconciled: true }
                        );
                    }

                    report.healed++;
                    report.details.push({
                        txId: tx.id,
                        txHash: result.txHash,
                        action: 'recovered_submitted',
                        reason: 'Found executed on chain',
                    });
                }

                // Update reconciliation tracking
                await this.prisma.transaction.update({
                    where: { id: tx.id },
                    data: {
                        lastReconciledAt: new Date(),
                        reconcileAttempts: { increment: 1 },
                    },
                });

            } catch (error) {
                report.failed++;
                console.error(`Failed to reconcile prepared tx ${tx.id}:`, error);
            }
        }
    }

    /**
     * Detect phantom executions (executed on chain but not in our DB)
     * 
     * This helps catch cases where:
     * - Transaction was submitted directly (bypassing backend)
     * - Database write failed after submission
     */
    private async detectPhantomExecutions(report: ReconciliationReport): Promise<void> {
        // This would require scanning recent chain events and checking if they
        // correspond to transactions in our DB. Implementation depends on
        // how chain events are indexed.

        // Placeholder for now - would be implemented with event listener
        console.log('Phantom execution detection not yet implemented');
    }
}

// ============================================================================
// Types
// ============================================================================

export interface ReconciliationReport {
    startedAt: Date;
    completedAt?: Date;
    checked: number;
    healed: number;
    failed: number;
    details: ReconciliationDetail[];
}

export interface ReconciliationDetail {
    txId: string;
    txHash?: string;
    action: string;
    reason: string;
}

// ============================================================================
// Scheduled Job Runner
// ============================================================================

export class ReconciliationScheduler {
    private intervalId?: NodeJS.Timeout;

    constructor(
        private job: ReconciliationJob,
        private intervalMs: number = 300000 // 5 minutes default
    ) { }

    /**
     * Start scheduled reconciliation
     */
    start(): void {
        console.log(`Starting reconciliation job (every ${this.intervalMs}ms)`);

        // Run immediately
        this.runOnce();

        // Schedule periodic runs
        this.intervalId = setInterval(() => {
            this.runOnce();
        }, this.intervalMs);
    }

    /**
     * Stop scheduled reconciliation
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
    }

    /**
     * Run reconciliation once
     */
    private async runOnce(): Promise<void> {
        try {
            const report = await this.job.reconcile();
            console.log('Reconciliation complete:', {
                checked: report.checked,
                healed: report.healed,
                failed: report.failed,
                duration: report.completedAt && report.startedAt
                    ? report.completedAt.getTime() - report.startedAt.getTime()
                    : 0,
            });
        } catch (error) {
            console.error('Reconciliation failed:', error);
        }
    }
}
