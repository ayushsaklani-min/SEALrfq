'use client';

import { useState, useEffect } from 'react';
import { TxStatusView } from './TxStatus';
import { authenticatedFetch } from '@/lib/authFetch';
import { CheckCircle, Clock, XCircle, AlertTriangle, FileText } from 'lucide-react';

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
    filterStatus?: TxStatus | 'ALL';
    filterTransition?: string;
    limit?: number;
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

                const response = await authenticatedFetch(`/api/tx/history?${params}`);
                const payload = await response.json();

                if (!response.ok) {
                    throw new Error(payload?.error?.message || 'Failed to fetch transaction history');
                }

                setTransactions(payload.data);
                setLoading(false);
            } catch (err: any) {
                setError(err.message);
                setLoading(false);
            }
        };

        fetchHistory();
    }, [filterStatus, filterTransition, limit]);

    if (loading) {
        return <div className="p-8 text-center text-[hsl(var(--muted-foreground))]">Loading transaction history...</div>;
    }

    if (error) {
        return <div className="p-4 rounded-lg border border-red-500/25 bg-red-500/8 text-sm text-red-300">{error}</div>;
    }

    if (transactions.length === 0) {
        return <div className="p-8 text-center text-[hsl(var(--muted-foreground))] border border-dashed border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--secondary))]">No transactions found</div>;
    }

    const grouped = groupByCanonical
        ? groupByCanonicalKey(transactions)
        : transactions.map(tx => ({ canonical: tx.canonicalTxKey, attempts: [tx] }));

    return (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-3">
                <h3 className="text-base font-semibold text-white">Transaction History</h3>
                <select
                    value={filterStatus}
                    onChange={(e) => window.location.href = `?status=${e.target.value}`}
                    className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 py-2 text-sm text-white"
                >
                    <option value="ALL">All Statuses</option>
                    <option value="PREPARED">Prepared</option>
                    <option value="SUBMITTED">Submitted</option>
                    <option value="CONFIRMED">Confirmed</option>
                    <option value="REJECTED">Rejected</option>
                    <option value="EXPIRED">Expired</option>
                </select>
            </div>

            <div className="space-y-3">
                {grouped.map(group => (
                    <div key={group.canonical} className="space-y-2">
                        {groupByCanonical && group.attempts.length > 1 && (
                            <div className="flex justify-between items-center text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))] font-semibold px-2">
                                <span>Action: {group.canonical}</span>
                                <span className="bg-[hsl(var(--secondary))] px-2 py-0.5 rounded text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))]">{group.attempts.length} attempts</span>
                            </div>
                        )}

                        {group.attempts.map(tx => (
                            <div key={tx.id}>
                                <div
                                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-lg bg-[hsl(var(--secondary))] hover:bg-[hsl(var(--muted))] border border-[hsl(var(--border))] transition-colors cursor-pointer"
                                    onClick={() => setSelectedTx(selectedTx === tx.idempotencyKey ? null : tx.idempotencyKey)}
                                >
                                    <div className="flex items-center gap-3 mb-2 sm:mb-0">
                                        <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${getStatusBg(tx.status)}`}>
                                            {statusIcon(tx.status)}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-white">{tx.transition}</span>
                                            <span className="text-xs text-[hsl(var(--muted-foreground))]">{formatTimestamp(tx.preparedAt)}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center w-full sm:w-auto justify-end">
                                        {tx.confirmedAt && (
                                            <span className="inline-flex items-center text-emerald-400 text-xs px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 font-medium">
                                                Confirmed
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {selectedTx === tx.idempotencyKey && (
                                    <div className="mt-2 p-3 bg-[hsl(var(--secondary))] rounded-lg border border-[hsl(var(--border))]">
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

function getStatusBg(status: TxStatus): string {
    switch (status) {
        case 'CONFIRMED': return 'bg-emerald-500/15 text-emerald-400';
        case 'REJECTED': return 'bg-red-500/15 text-red-400';
        case 'SUBMITTED': return 'bg-blue-500/15 text-blue-400';
        case 'EXPIRED': return 'bg-amber-500/15 text-amber-400';
        default: return 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]';
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

function statusIcon(status: TxStatus) {
    switch (status) {
        case 'PREPARED': return <FileText className="w-4 h-4" />;
        case 'SUBMITTED': return <Clock className="w-4 h-4" />;
        case 'CONFIRMED': return <CheckCircle className="w-4 h-4" />;
        case 'REJECTED': return <XCircle className="w-4 h-4" />;
        case 'EXPIRED': return <AlertTriangle className="w-4 h-4" />;
    }
}

function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

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
