'use client';

import { useEffect, useState } from 'react';
import { CopyInlineButton, CopyableText } from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { CheckCircle, Clock, XCircle, AlertTriangle } from 'lucide-react';

type TxStatus = 'PREPARED' | 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';

interface TransactionStatus {
    id: string;
    idempotencyKey: string;
    canonicalTxKey: string;
    txHash?: string;
    transition: string;
    status: TxStatus;
    statusHistory: Array<{ status: TxStatus; timestamp: string }> | string;
    preparedAt: string;
    submittedAt?: string;
    confirmedAt?: string;
    rejectedAt?: string;
    expiredAt?: string;
    blockHeight?: number;
    blockHash?: string;
    error?: string;
    errorCode?: number;
    errorClass?: string;
    retryCount: number;
    maxRetries: number;
    canRetry: boolean;
}

interface TxStatusProps {
    idempotencyKey: string;
    canonicalTxKey?: string;
    onRetry?: () => Promise<void>;
    onResume?: () => Promise<void>;
    showHistory?: boolean;
    compact?: boolean;
}

export function TxStatusView({
    idempotencyKey,
    onRetry,
    onResume,
    showHistory = false,
    compact = false,
}: TxStatusProps) {
    const [tx, setTx] = useState<TransactionStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retrying, setRetrying] = useState(false);

    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;
        const fetchStatus = async () => {
            try {
                const response = await authenticatedFetch(`/api/tx/${idempotencyKey}`);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error?.message || 'Failed to fetch status');
                setTx(payload.data);
                setError(null);
                setLoading(false);
                if (['CONFIRMED', 'REJECTED', 'EXPIRED'].includes(payload.data.status)) {
                    if (intervalId) clearInterval(intervalId);
                }
            } catch (err: any) {
                setError(err.message);
                setLoading(false);
            }
        };
        fetchStatus();
        intervalId = setInterval(() => {
            if (!tx || tx.status === 'PREPARED' || tx.status === 'SUBMITTED') fetchStatus();
        }, 2000);
        return () => { if (intervalId) clearInterval(intervalId); };
    }, [idempotencyKey, tx?.status]);

    const handleRetry = async () => {
        if (retrying || !onRetry) return;
        setRetrying(true);
        try { await onRetry(); } catch (err: any) { setError(err.message); } finally { setRetrying(false); }
    };

    const handleResume = async () => {
        if (retrying || !onResume) return;
        setRetrying(true);
        try { await onResume(); } catch (err: any) { setError(err.message); } finally { setRetrying(false); }
    };

    if (loading) {
        return <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-3 text-sm text-[hsl(var(--muted-foreground))]">Loading transaction status...</div>;
    }

    if (error || !tx) {
        return <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error || 'Transaction not found'}</div>;
    }

    const history: Array<{ status: TxStatus; timestamp: string }> = Array.isArray(tx.statusHistory)
        ? tx.statusHistory
        : (() => { try { return JSON.parse(tx.statusHistory || '[]'); } catch { return []; } })();

    const statusIcon = {
        PREPARED: <Clock className="h-4 w-4 text-slate-500" />,
        SUBMITTED: <Clock className="h-4 w-4 animate-pulse text-blue-500" />,
        CONFIRMED: <CheckCircle className="h-4 w-4 text-emerald-500" />,
        REJECTED: <XCircle className="h-4 w-4 text-red-500" />,
        EXPIRED: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    };

    const statusLabel = {
        PREPARED: 'Preparing',
        SUBMITTED: 'Processing',
        CONFIRMED: 'Confirmed',
        REJECTED: 'Failed',
        EXPIRED: 'Expired',
    };

    const statusBg = {
        PREPARED: 'border-slate-200 bg-slate-50',
        SUBMITTED: 'border-blue-200 bg-blue-50',
        CONFIRMED: 'border-emerald-200 bg-emerald-50',
        REJECTED: 'border-red-200 bg-red-50',
        EXPIRED: 'border-amber-200 bg-amber-50',
    };

    return (
        <div className={`rounded-2xl border ${statusBg[tx.status]} ${compact ? 'p-3' : 'p-4'}`}>
            <div className="mb-2 flex items-center gap-2">
                {statusIcon[tx.status]}
                <span className="text-sm font-semibold text-slate-950">{statusLabel[tx.status]}</span>
                <span className="text-xs text-slate-500">{tx.transition}</span>
            </div>

            {tx.txHash && (
                <div className="text-xs text-slate-600">
                    <div className="mb-1 font-medium uppercase tracking-[0.16em] text-slate-500">Transaction</div>
                    {tx.txHash.startsWith('at1') ? (
                        <div className="flex items-center gap-2">
                            <a
                                href={`https://explorer.aleo.org/transaction/${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 truncate font-mono text-[13px] text-[hsl(var(--primary))] hover:underline"
                            >
                                {tx.txHash}
                            </a>
                            <CopyInlineButton value={tx.txHash} title="Copy transaction hash" />
                        </div>
                    ) : (
                        <CopyableText value={tx.txHash} />
                    )}
                </div>
            )}

            {tx.status === 'REJECTED' && tx.error && (
                <div className="mt-2 text-xs text-red-700">{tx.error}</div>
            )}

            {tx.status === 'REJECTED' && tx.canRetry && onRetry && (
                <button onClick={handleRetry} disabled={retrying} className="mt-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-70">
                    {retrying ? 'Retrying...' : 'Retry'}
                </button>
            )}

            {tx.status === 'EXPIRED' && onResume && (
                <button onClick={handleResume} disabled={retrying} className="mt-2 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-70">
                    {retrying ? 'Rebuilding...' : 'Resume'}
                </button>
            )}

            {showHistory && history.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-slate-200 pt-3">
                    {history.map((entry, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="text-slate-600">{entry.status}</span>
                            <span className="font-mono text-slate-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
