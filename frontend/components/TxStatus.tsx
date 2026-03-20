'use client';

import { useEffect, useState } from 'react';
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
        return <div className="rounded-lg border border-red-500/25 bg-red-500/8 p-3 text-sm text-red-300">{error || 'Transaction not found'}</div>;
    }

    const history: Array<{ status: TxStatus; timestamp: string }> = Array.isArray(tx.statusHistory)
        ? tx.statusHistory
        : (() => { try { return JSON.parse(tx.statusHistory || '[]'); } catch { return []; } })();

    const statusIcon = {
        PREPARED: <Clock className="h-4 w-4 text-slate-400" />,
        SUBMITTED: <Clock className="h-4 w-4 text-blue-400 animate-pulse" />,
        CONFIRMED: <CheckCircle className="h-4 w-4 text-emerald-400" />,
        REJECTED: <XCircle className="h-4 w-4 text-red-400" />,
        EXPIRED: <AlertTriangle className="h-4 w-4 text-amber-400" />,
    };

    const statusLabel = {
        PREPARED: 'Preparing',
        SUBMITTED: 'Processing',
        CONFIRMED: 'Confirmed',
        REJECTED: 'Failed',
        EXPIRED: 'Expired',
    };

    const statusBg = {
        PREPARED: 'border-slate-500/25 bg-slate-500/8',
        SUBMITTED: 'border-blue-500/25 bg-blue-500/8',
        CONFIRMED: 'border-emerald-500/25 bg-emerald-500/8',
        REJECTED: 'border-red-500/25 bg-red-500/8',
        EXPIRED: 'border-amber-500/25 bg-amber-500/8',
    };

    return (
        <div className={`rounded-xl border ${statusBg[tx.status]} ${compact ? 'p-3' : 'p-4'}`}>
            <div className="flex items-center gap-2 mb-2">
                {statusIcon[tx.status]}
                <span className="text-sm font-medium text-white">{statusLabel[tx.status]}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{tx.transition}</span>
            </div>

            {tx.txHash && (
                <div className="text-xs text-[hsl(var(--muted-foreground))] font-mono truncate">
                    Tx: {tx.txHash.startsWith('at1') ? (
                        <a href={`https://explorer.aleo.org/transaction/${tx.txHash}`} target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--primary))] hover:underline">
                            {tx.txHash.substring(0, 20)}...
                        </a>
                    ) : tx.txHash}
                </div>
            )}

            {tx.status === 'REJECTED' && tx.error && (
                <div className="mt-2 text-xs text-red-300">{tx.error}</div>
            )}

            {tx.status === 'REJECTED' && tx.canRetry && onRetry && (
                <button onClick={handleRetry} disabled={retrying} className="mt-2 rounded-lg border border-red-500/30 bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/25 disabled:opacity-50">
                    {retrying ? 'Retrying...' : 'Retry'}
                </button>
            )}

            {tx.status === 'EXPIRED' && onResume && (
                <button onClick={handleResume} disabled={retrying} className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25 disabled:opacity-50">
                    {retrying ? 'Rebuilding...' : 'Resume'}
                </button>
            )}

            {showHistory && history.length > 0 && (
                <div className="mt-3 border-t border-white/5 pt-2 space-y-1">
                    {history.map((entry, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="text-[hsl(var(--muted-foreground))]">{entry.status}</span>
                            <span className="text-[hsl(var(--muted-foreground))] font-mono">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
