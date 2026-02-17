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
        return <div className="tx-status loading">Loading transaction status...</div>;
    }

    if (error || !tx) {
        return <div className="tx-status error">Error: {error || 'Transaction not found'}</div>;
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
        <div className={`tx-status ${tx.status.toLowerCase()} ${compact ? 'compact' : ''}`}>
            {/* REQUIREMENT 2: Full lifecycle with timestamps + tx IDs */}
            <div className="tx-status-header">
                <StatusBadge status={tx.status} />
                <span className="tx-transition">{tx.transition}</span>
            </div>

            <div className="tx-status-body">
                {/* Current state info */}
                <div className="tx-info">
                    {tx.txHash && (
                        <div className="tx-hash">
                            <strong>Tx Hash:</strong>{' '}
                            <a
                                href={`https://explorer.aleo.org/transaction/${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {tx.txHash.substring(0, 16)}...
                            </a>
                        </div>
                    )}

                    {tx.blockHeight && (
                        <div className="tx-block">
                            <strong>Block:</strong> {tx.blockHeight}
                        </div>
                    )}

                    {/* Timestamps */}
                    <div className="tx-timestamps">
                        <div><strong>Prepared:</strong> {formatTimestamp(tx.preparedAt)}</div>
                        {tx.submittedAt && <div><strong>Submitted:</strong> {formatTimestamp(tx.submittedAt)}</div>}
                        {tx.confirmedAt && <div><strong>Confirmed:</strong> {formatTimestamp(tx.confirmedAt)}</div>}
                        {tx.rejectedAt && <div><strong>Rejected:</strong> {formatTimestamp(tx.rejectedAt)}</div>}
                        {tx.expiredAt && <div><strong>Expired:</strong> {formatTimestamp(tx.expiredAt)}</div>}
                    </div>
                </div>

                {/* REQUIREMENT 3: Terminal-state actions */}
                {tx.status === 'REJECTED' && (
                    <div className="tx-terminal-action rejected">
                        <div className="error-details">
                            <strong>Error:</strong> {tx.error}
                            {tx.errorCode && <span className="error-code"> (Code: {tx.errorCode})</span>}
                            <div className="error-class">{tx.errorClass}</div>
                        </div>

                        {tx.canRetry && onRetry && (
                            <button
                                onClick={handleRetry}
                                disabled={retrying}
                                className="retry-btn"
                            >
                                {retrying ? 'Retrying...' : `Retry (${tx.retryCount}/${tx.maxRetries})`}
                            </button>
                        )}

                        {!tx.canRetry && (
                            <div className="cannot-retry">
                                {tx.errorClass === 'LOGICAL'
                                    ? 'Cannot retry: contract validation error'
                                    : 'Max retries exceeded'}
                            </div>
                        )}
                    </div>
                )}

                {tx.status === 'EXPIRED' && (
                    <div className="tx-terminal-action expired">
                        <div className="expired-message">
                            Transaction expired without confirmation. You can rebuild and resubmit.
                        </div>

                        {onResume && (
                            <button
                                onClick={handleResume}
                                disabled={retrying}
                                className="resume-btn"
                            >
                                {retrying ? 'Rebuilding...' : 'Resume / Rebuild'}
                            </button>
                        )}
                    </div>
                )}

                {tx.status === 'CONFIRMED' && (
                    <div className="tx-terminal-action confirmed">
                        <div className="success-message">Transaction confirmed on-chain</div>
                    </div>
                )}

                {/* Status history (if requested) */}
                {showHistory && history.length > 0 && (
                    <div className="tx-history">
                        <strong>History:</strong>
                        <ul>
                            {history.map((entry, idx) => (
                                <li key={idx}>
                                    <span className="status-badge">{entry.status}</span>
                                    <span className="timestamp">{formatTimestamp(entry.timestamp)}</span>
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
        PREPARED: { label: 'Prepared', className: 'status-prepared', icon: 'P' },
        SUBMITTED: { label: 'Submitted', className: 'status-submitted', icon: 'S' },
        CONFIRMED: { label: 'Confirmed', className: 'status-confirmed', icon: 'C' },
        REJECTED: { label: 'Rejected', className: 'status-rejected', icon: 'R' },
        EXPIRED: { label: 'Expired', className: 'status-expired', icon: 'E' },
    };

    const config = statusConfig[status];

    return (
        <span className={`status-badge ${config.className}`}>
            <span className="icon">{config.icon}</span>
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
