/**
 * Transaction Status Component
 * 
 * REQUIREMENTS:
 * 1. Backend-driven state only (poll every 2s for SUBMITTED)
 * 2. Full lifecycle with timestamps + tx IDs
 * 3. Terminal-state actions (retry for REJECTED, resume for EXPIRED)
 * 4. Idempotent actions (debounce + disable during processing)
 */

'use client';

import { useEffect, useState } from 'react';

type TxStatus = 'PREPARED' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';
type ErrorClass = 'NETWORK' | 'VALIDATION' | 'LOGICAL' | 'INFRASTRUCTURE' | 'UNKNOWN';

// ============================================================================
// Types
// ============================================================================

interface TransactionStatus {
    id: string;
    idempotencyKey: string;
    canonicalTxKey: string;
    txHash?: string;
    transition: string;
    status: TxStatus;
    statusHistory: Array<{ status: TxStatus; timestamp: string }> | string;

    // Timestamps
    preparedAt: string;
    submittedAt?: string;
    confirmedAt?: string;
    rejectedAt?: string;
    expiredAt?: string;

    // Blockchain metadata
    blockHeight?: number;
    blockHash?: string;

    // Error details
    error?: string;
    errorCode?: number;
    errorClass?: ErrorClass;

    // Retry info
    retryCount: number;
    maxRetries: number;
    canRetry: boolean;
}

interface TxStatusProps {
    /** Idempotency key to track */
    idempotencyKey: string;

    /** Canonical key (for retries) */
    canonicalTxKey?: string;

    /** Callback for retry action */
    onRetry?: () => Promise<void>;

    /** Callback for resume/rebuild (expired) */
    onResume?: () => Promise<void>;

    /** Show full history */
    showHistory?: boolean;

    /** Compact mode */
    compact?: boolean;
}

// ============================================================================
// Transaction Status Component
// ============================================================================

export function TxStatusView({
    idempotencyKey,
    canonicalTxKey,
    onRetry,
    onResume,
    showHistory = false,
    compact = false,
}: TxStatusProps) {
    const [tx, setTx] = useState<TransactionStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retrying, setRetrying] = useState(false);

    // Poll backend for status (REQUIREMENT 1: backend-driven)
    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;

        const fetchStatus = async () => {
            try {
                const response = await fetch(`/api/tx/${idempotencyKey}`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
                    },
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch transaction status');
                }

                const data = await response.json();
                setTx(data.data);
                setLoading(false);

                // Stop polling if terminal state
                if (
                    data.data.status === 'CONFIRMED' ||
                    data.data.status === 'REJECTED' ||
                    data.data.status === 'EXPIRED'
                ) {
                    if (intervalId) {
                        clearInterval(intervalId);
                    }
                }
            } catch (err: any) {
                setError(err.message);
                setLoading(false);
            }
        };

        // Initial fetch
        fetchStatus();

        // Poll every 2s for in-flight transactions.
        intervalId = setInterval(() => {
            if (!tx || tx.status === 'PREPARED' || tx.status === 'SUBMITTED') {
                fetchStatus();
            }
        }, 2000);

        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [idempotencyKey, tx?.status]);

    // Handle retry (REQUIREMENT 4: idempotent)
    const handleRetry = async () => {
        if (retrying || !onRetry) return; // Prevent double-click

        setRetrying(true);
        try {
            await onRetry();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setRetrying(false);
        }
    };

    // Handle resume (REQUIREMENT 4: idempotent)
    const handleResume = async () => {
        if (retrying || !onResume) return; // Prevent double-click

        setRetrying(true);
        try {
            await onResume();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setRetrying(false);
        }
    };

    if (loading) {
        return (
            <div className="rounded-xl border border-cyan-400/20 bg-black/50 p-4 text-sm text-cyan-200/80">
                Loading transaction status...
            </div>
        );
    }

    if (error || !tx) {
        return (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-300">
                Error: {error || 'Transaction not found'}
            </div>
        );
    }

    const history: Array<{ status: TxStatus; timestamp: string }> = Array.isArray(tx.statusHistory)
        ? tx.statusHistory
        : (() => {
              try {
                  return JSON.parse(tx.statusHistory || '[]');
              } catch {
                  return [];
              }
          })();

    return (
        <div
            className={`rounded-2xl border border-cyan-400/20 bg-black/55 shadow-[0_0_20px_rgba(34,211,238,0.16)] ${compact ? 'p-4' : 'p-5 sm:p-6'}`}
        >
            {/* REQUIREMENT 2: Full lifecycle with timestamps + tx IDs */}
            <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-cyan-400/15 pb-3">
                <StatusBadge status={tx.status} />
                <span className="rounded-md border border-cyan-400/20 bg-cyan-500/5 px-2 py-1 font-mono text-xs tracking-wide text-cyan-200">
                    {tx.transition}
                </span>
            </div>

            <div className="space-y-4">
                {/* Current state info */}
                <div className="space-y-3">
                    {tx.txHash && (
                        <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/5 p-3 text-sm">
                            <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-cyan-300/70">Tx Hash</span>
                            <a
                                href={`https://explorer.aleo.org/transaction/${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-cyan-200 underline decoration-cyan-400/40 underline-offset-4 transition hover:text-cyan-100"
                            >
                                {tx.txHash.substring(0, 18)}...
                            </a>
                        </div>
                    )}

                    {typeof tx.blockHeight === 'number' && tx.blockHeight > 0 && (
                        <div className="rounded-lg border border-cyan-400/20 bg-black/35 p-3 text-sm">
                            <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-cyan-300/70">Block Height</span>
                            <span className="font-mono text-cyan-100">{tx.blockHeight}</span>
                        </div>
                    )}

                    {/* Timestamps */}
                    <div className="grid gap-2 sm:grid-cols-2">
                        <TimestampItem label="Prepared" value={tx.preparedAt} />
                        {tx.submittedAt && <TimestampItem label="Submitted" value={tx.submittedAt} />}
                        {tx.confirmedAt && <TimestampItem label="Confirmed" value={tx.confirmedAt} />}
                        {tx.rejectedAt && <TimestampItem label="Rejected" value={tx.rejectedAt} />}
                        {tx.expiredAt && <TimestampItem label="Expired" value={tx.expiredAt} />}
                    </div>
                </div>

                {/* REQUIREMENT 3: Terminal-state actions */}
                {tx.status === 'REJECTED' && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                        <div className="text-sm text-red-200">
                            <span className="font-semibold text-red-100">Error:</span> {tx.error}
                            {tx.errorCode && <span className="font-mono text-red-300"> (Code: {tx.errorCode})</span>}
                            <div className="mt-1 text-xs uppercase tracking-wide text-red-300/80">{tx.errorClass}</div>
                        </div>

                        {tx.canRetry && onRetry && (
                            <button
                                onClick={handleRetry}
                                disabled={retrying}
                                className="mt-3 rounded-md border border-red-300/40 bg-red-500/20 px-3 py-1.5 text-sm font-medium text-red-100 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {retrying ? 'Retrying...' : `Retry (${tx.retryCount}/${tx.maxRetries})`}
                            </button>
                        )}

                        {!tx.canRetry && (
                            <div className="mt-2 text-xs text-red-300/80">
                                {tx.errorClass === 'LOGICAL'
                                    ? 'Cannot retry: contract validation error'
                                    : 'Max retries exceeded'}
                            </div>
                        )}
                    </div>
                )}

                {tx.status === 'EXPIRED' && (
                    <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
                        <div className="text-sm text-amber-100/90">
                            Transaction expired without confirmation. You can rebuild and resubmit.
                        </div>

                        {onResume && (
                            <button
                                onClick={handleResume}
                                disabled={retrying}
                                className="mt-3 rounded-md border border-amber-300/40 bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-50 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {retrying ? 'Rebuilding...' : 'Resume / Rebuild'}
                            </button>
                        )}
                    </div>
                )}

                {tx.status === 'CONFIRMED' && (
                    <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                        <div className="text-sm font-medium text-emerald-200">Transaction confirmed on-chain</div>
                    </div>
                )}

                {/* Status history (if requested) */}
                {showHistory && history.length > 0 && (
                    <div className="rounded-xl border border-cyan-400/15 bg-black/35 p-4">
                        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-cyan-300/70">History</div>
                        <ul className="space-y-2">
                            {history.map((entry, idx) => (
                                <li
                                    key={idx}
                                    className="flex items-center justify-between rounded-md border border-cyan-400/10 bg-cyan-500/5 px-3 py-2"
                                >
                                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${historyBadgeTone(entry.status)}`}>
                                        {entry.status}
                                    </span>
                                    <span className="font-mono text-xs text-cyan-100/85">{formatTimestamp(entry.timestamp)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================================================
// Status Badge Component
// ============================================================================

function StatusBadge({ status }: { status: TxStatus }) {
    const statusConfig = {
        PREPARED: { label: 'Prepared', tone: 'bg-slate-500/20 text-slate-200 border-slate-300/30', dot: 'bg-slate-300' },
        SUBMITTED: { label: 'Submitted', tone: 'bg-sky-500/20 text-sky-100 border-sky-300/30', dot: 'bg-sky-300' },
        CONFIRMED: { label: 'Confirmed', tone: 'bg-emerald-500/20 text-emerald-100 border-emerald-300/30', dot: 'bg-emerald-300' },
        REJECTED: { label: 'Rejected', tone: 'bg-red-500/20 text-red-100 border-red-300/30', dot: 'bg-red-300' },
        EXPIRED: { label: 'Expired', tone: 'bg-amber-500/20 text-amber-100 border-amber-300/30', dot: 'bg-amber-300' },
    };

    const config = statusConfig[status];

    return (
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${config.tone}`}>
            <span className={`h-2 w-2 rounded-full ${config.dot}`} />
            {config.label}
        </span>
    );
}

// ============================================================================
// Utilities
// ============================================================================

function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function TimestampItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-cyan-400/15 bg-black/30 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/65">{label}</div>
            <div className="mt-1 font-mono text-xs text-cyan-100/90">{formatTimestamp(value)}</div>
        </div>
    );
}

function historyBadgeTone(status: TxStatus): string {
    switch (status) {
        case 'CONFIRMED':
            return 'border border-emerald-300/30 bg-emerald-500/20 text-emerald-100';
        case 'REJECTED':
            return 'border border-red-300/30 bg-red-500/20 text-red-100';
        case 'SUBMITTED':
            return 'border border-sky-300/30 bg-sky-500/20 text-sky-100';
        case 'EXPIRED':
            return 'border border-amber-300/30 bg-amber-500/20 text-amber-100';
        default:
            return 'border border-slate-300/30 bg-slate-500/20 text-slate-100';
    }
}
