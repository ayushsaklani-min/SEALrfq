/**
 * Transaction History Component
 * 
 * Displays list of transactions with filtering and canonical action grouping.
 */

'use client';

import { useState, useEffect } from 'react';
import { TxStatusView } from './TxStatus';
import Link from 'next/link';

type TxStatus = 'PREPARED' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';

interface Transaction {
    id: string;
    idempotencyKey: string;
    canonicalTxKey: string;
    transition: string;
    status: TxStatus;
    preparedAt: string;
    confirmedAt?: string;
}

interface TxHistoryProps {
    /** Filter by status */
    filterStatus?: TxStatus | 'ALL';

    /** Filter by transition */
    filterTransition?: string;

    /** Limit number of results */
    limit?: number;

    /** Group by canonical key */
    groupByCanonical?: boolean;
}

export function TxHistory({
    filterStatus = 'ALL',
    filterTransition,
    limit = 20,
    groupByCanonical = false,
}: TxHistoryProps) {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedTx, setSelectedTx] = useState<string | null>(null);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const params = new URLSearchParams();
                if (filterStatus !== 'ALL') params.append('status', filterStatus);
                if (filterTransition) params.append('transition', filterTransition);
                params.append('limit', limit.toString());

                const response = await fetch(`/api/tx/history?${params}`, {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
                    },
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch transaction history');
                }

                const data = await response.json();
                setTransactions(data.data);
                setLoading(false);
            } catch (err: any) {
                setError(err.message);
                setLoading(false);
            }
        };

        fetchHistory();
    }, [filterStatus, filterTransition, limit]);

    if (loading) {
        return <div className="p-8 text-center text-gray-400 animate-pulse">Loading transaction history...</div>;
    }

    if (error) {
        return <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg">Error: {error}</div>;
    }

    if (transactions.length === 0) {
        return <div className="p-8 text-center text-gray-500 border border-white/5 rounded-xl bg-white/5">No transactions found</div>;
    }

    // Group by canonical key if requested
    const grouped = groupByCanonical
        ? groupByCanonicalKey(transactions)
        : transactions.map(tx => ({ canonical: tx.canonicalTxKey, attempts: [tx] }));

    return (
        <div className="glass rounded-xl p-6 border border-white/5 bg-gray-900/50 backdrop-blur-md">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
                <h3 className="text-xl font-bold font-display bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Transaction History</h3>
                <div className="w-full sm:w-auto">
                    {/* Status filter */}
                    <select
                        value={filterStatus}
                        onChange={(e) => window.location.href = `?status=${e.target.value}`}
                        className="bg-black/40 border border-white/10 text-gray-300 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 backdrop-blur-sm cursor-pointer hover:bg-black/60 transition-colors"
                    >
                        <option value="ALL">All Statuses</option>
                        <option value="PREPARED">Prepared</option>
                        <option value="SUBMITTED">Submitted</option>
                        <option value="CONFIRMED">Confirmed</option>
                        <option value="REJECTED">Rejected</option>
                        <option value="EXPIRED">Expired</option>
                    </select>
                </div>
            </div>

            <div className="space-y-4">
                {grouped.map(group => (
                    <div key={group.canonical} className="space-y-2">
                        {groupByCanonical && group.attempts.length > 1 && (
                            <div className="flex justify-between items-center text-xs uppercase tracking-wider text-gray-500 font-semibold px-2">
                                <span>Action: {group.canonical}</span>
                                <span className="bg-white/5 px-2 py-0.5 rounded text-white/50 border border-white/5">{group.attempts.length} attempts</span>
                            </div>
                        )}

                        {group.attempts.map(tx => (
                            <div key={tx.id} className="relative group">
                                <div
                                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all cursor-pointer shadow-sm hover:shadow-md"
                                    onClick={() => setSelectedTx(selectedTx === tx.idempotencyKey ? null : tx.idempotencyKey)}
                                >
                                    <div className="flex items-center space-x-4 mb-2 sm:mb-0">
                                        <div className={`text-2xl w-10 h-10 flex items-center justify-center rounded-full bg-black/20 ${getStatusColor(tx.status)}`}>
                                            {statusIcon(tx.status)}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="font-medium text-white group-hover:text-primary-300 transition-colors">{tx.transition}</span>
                                            <span className="text-xs text-gray-500">{formatTimestamp(tx.preparedAt)}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center w-full sm:w-auto justify-end">
                                        {tx.confirmedAt && (
                                            <span className="inline-flex items-center bg-green-500/10 text-green-400 text-xs px-2.5 py-1 rounded-full border border-green-500/20 font-medium">
                                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5"></span>
                                                Confirmed
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {selectedTx === tx.idempotencyKey && (
                                    <div className="mt-2 p-4 bg-black/40 rounded-lg border border-white/5 animate-slide-up shadow-inner">
                                        <TxStatusView
                                            idempotencyKey={tx.idempotencyKey}
                                            canonicalTxKey={tx.canonicalTxKey}
                                            showHistory={true}
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function getStatusColor(status: TxStatus): string {
    switch (status) {
        case 'CONFIRMED': return 'text-green-400';
        case 'REJECTED': return 'text-red-400';
        case 'SUBMITTED': return 'text-blue-400';
        default: return 'text-gray-400';
    }
}

function groupByCanonicalKey(transactions: Transaction[]): Array<{ canonical: string; attempts: Transaction[] }> {
    const groups = new Map<string, Transaction[]>();

    for (const tx of transactions) {
        const existing = groups.get(tx.canonicalTxKey) || [];
        existing.push(tx);
        groups.set(tx.canonicalTxKey, existing);
    }

    return Array.from(groups.entries()).map(([canonical, attempts]) => ({
        canonical,
        attempts: attempts.sort((a, b) =>
            new Date(b.preparedAt).getTime() - new Date(a.preparedAt).getTime()
        ),
    }));
}

function statusIcon(status: TxStatus): string {
    const icons = {
        PREPARED: '📝',
        SUBMITTED: '⏳',
        CONFIRMED: '✓',
        REJECTED: '✗',
        EXPIRED: '⏰',
    };
    return icons[status] || '?';
}

function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Show relative time if < 24h
    if (diff < 24 * 60 * 60 * 1000) {
        const minutes = Math.floor(diff / (60 * 1000));
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h ago`;
    }

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
