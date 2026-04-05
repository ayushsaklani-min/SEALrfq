'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, 
  CheckCircle, 
  Clock, 
  XCircle, 
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react';

/**
 * Transaction status types matching the backend API response
 */
type TxStatusType = 'pending' | 'confirmed' | 'failed' | 'unknown';

/**
 * Transaction status response from the API
 */
interface TxStatus {
  txId: string;
  status: TxStatusType;
  confirmations: number;
  blockHeight?: number;
  programId?: string;
  functionName?: string;
  fee?: number;
  timestamp?: string;
  message?: string;
  error?: string;
}

/**
 * Props for the TransactionTracker component
 */
interface TransactionTrackerProps {
  /** Optional initial transaction ID to track */
  initialTxId?: string;
  /** Callback when transaction is confirmed */
  onConfirmed?: (txStatus: TxStatus) => void;
  /** Callback when transaction fails */
  onFailed?: (txStatus: TxStatus) => void;
  /** Auto-refresh interval in milliseconds (default: 5000, set to 0 to disable) */
  refreshInterval?: number;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Custom class name for the container */
  className?: string;
}

/**
 * Status metadata for styling and icons
 */
const STATUS_META: Record<TxStatusType, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  animate?: boolean;
}> = {
  pending: {
    icon: Clock,
    label: 'Pending',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
    borderColor: 'border-blue-400/25',
    animate: true,
  },
  confirmed: {
    icon: CheckCircle,
    label: 'Confirmed',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/10',
    borderColor: 'border-emerald-400/25',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    color: 'text-red-400',
    bgColor: 'bg-red-400/10',
    borderColor: 'border-red-400/25',
  },
  unknown: {
    icon: AlertTriangle,
    label: 'Unknown',
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
    borderColor: 'border-amber-400/25',
  },
};

/**
 * TransactionTracker component for querying and displaying Aleo transaction status.
 * Allows users to input a transaction ID and view its current status with auto-refresh.
 */
export function TransactionTracker({
  initialTxId = '',
  onConfirmed,
  onFailed,
  refreshInterval = 5000,
  compact = false,
  className = '',
}: TransactionTrackerProps) {
  const [inputTxId, setInputTxId] = useState(initialTxId);
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  // Track if callbacks have been fired to prevent duplicate calls
  const callbackFiredRef = useRef<{ confirmed: boolean; failed: boolean }>({
    confirmed: false,
    failed: false,
  });

  /**
   * Fetch transaction status from the API
   */
  const fetchStatus = useCallback(async (txId: string, isAutoRefresh = false) => {
    if (!txId.trim()) {
      setError('Please enter a transaction ID');
      return;
    }

    // Basic validation for Aleo transaction ID format
    if (!txId.startsWith('at1')) {
      setError('Invalid transaction ID format. Aleo transaction IDs start with "at1"');
      return;
    }

    if (!isAutoRefresh) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(`/api/tx/status?txId=${encodeURIComponent(txId.trim())}`);
      const data: TxStatus = await response.json();

      if (!response.ok && data.error) {
        setError(data.error);
        if (!isAutoRefresh) {
          setLoading(false);
        }
        return;
      }

      setTxStatus(data);

      // Fire callbacks only once per status
      if (data.status === 'confirmed' && !callbackFiredRef.current.confirmed) {
        callbackFiredRef.current.confirmed = true;
        onConfirmed?.(data);
      } else if (data.status === 'failed' && !callbackFiredRef.current.failed) {
        callbackFiredRef.current.failed = true;
        onFailed?.(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch transaction status');
    } finally {
      if (!isAutoRefresh) {
        setLoading(false);
      }
    }
  }, [onConfirmed, onFailed]);

  /**
   * Handle form submission
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Reset callback tracking for new transaction
    callbackFiredRef.current = { confirmed: false, failed: false };
    fetchStatus(inputTxId);
  };

  /**
   * Handle manual refresh
   */
  const handleRefresh = () => {
    if (txStatus?.txId) {
      fetchStatus(txStatus.txId);
    }
  };

  /**
   * Copy transaction ID to clipboard
   */
  const handleCopy = async () => {
    if (txStatus?.txId) {
      await navigator.clipboard.writeText(txStatus.txId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /**
   * Auto-refresh effect for pending transactions
   */
  useEffect(() => {
    if (!autoRefresh || !txStatus?.txId || refreshInterval <= 0) {
      return;
    }

    // Only auto-refresh for pending status
    if (txStatus.status !== 'pending') {
      return;
    }

    const intervalId = setInterval(() => {
      fetchStatus(txStatus.txId, true);
    }, refreshInterval);

    return () => clearInterval(intervalId);
  }, [autoRefresh, txStatus?.txId, txStatus?.status, refreshInterval, fetchStatus]);

  /**
   * Fetch initial transaction if provided
   */
  useEffect(() => {
    if (initialTxId) {
      fetchStatus(initialTxId);
    }
  }, [initialTxId, fetchStatus]);

  const statusMeta = txStatus ? STATUS_META[txStatus.status] : null;
  const StatusIcon = statusMeta?.icon;

  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.02] backdrop-blur-sm ${className}`}>
      {/* Search Input */}
      <form onSubmit={handleSubmit} className={`${compact ? 'p-3' : 'p-4'}`}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={inputTxId}
              onChange={(e) => setInputTxId(e.target.value)}
              placeholder="Enter transaction ID (at1...)"
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:border-blue-400/50 focus:outline-none focus:ring-1 focus:ring-blue-400/25 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.1] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              'Track'
            )}
          </button>
        </div>
      </form>

      {/* Error Display */}
      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-white/10 px-4 py-3"
          >
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transaction Status Display */}
      <AnimatePresence mode="wait">
        {txStatus && statusMeta && StatusIcon && (
          <motion.div
            key={txStatus.txId + txStatus.status}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="border-t border-white/10"
          >
            {/* Status Header */}
            <div className={`${compact ? 'p-3' : 'p-4'} ${statusMeta.bgColor}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <motion.div
                    animate={statusMeta.animate ? { scale: [1, 1.1, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    <StatusIcon className={`h-5 w-5 ${statusMeta.color}`} />
                  </motion.div>
                  <span className={`font-semibold ${statusMeta.color}`}>
                    {statusMeta.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Auto-refresh toggle */}
                  {txStatus.status === 'pending' && (
                    <button
                      onClick={() => setAutoRefresh(!autoRefresh)}
                      className={`rounded-md px-2 py-1 text-xs transition-colors ${
                        autoRefresh
                          ? 'bg-blue-400/20 text-blue-300'
                          : 'bg-white/5 text-white/50 hover:text-white/70'
                      }`}
                      title={autoRefresh ? 'Auto-refresh enabled' : 'Auto-refresh disabled'}
                    >
                      {autoRefresh ? 'Auto' : 'Manual'}
                    </button>
                  )}
                  {/* Refresh button */}
                  <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/70 disabled:opacity-50"
                    title="Refresh status"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Status message */}
              {txStatus.message && (
                <p className="mt-2 text-sm text-white/60">{txStatus.message}</p>
              )}
            </div>

            {/* Transaction Details */}
            <div className={`space-y-3 ${compact ? 'p-3' : 'p-4'}`}>
              {/* Transaction ID */}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
                  Transaction ID
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`https://testnet.explorer.provable.com/transaction/${txStatus.txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate font-mono text-xs text-blue-300 hover:underline"
                  >
                    {txStatus.txId}
                  </a>
                  <button
                    onClick={handleCopy}
                    className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/60"
                    title="Copy transaction ID"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <a
                    href={`https://testnet.explorer.provable.com/transaction/${txStatus.txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/60"
                    title="View on explorer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              {/* Block Height */}
              {txStatus.blockHeight !== undefined && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
                    Block Height
                  </div>
                  <span className="font-mono text-sm text-white/70">
                    {txStatus.blockHeight.toLocaleString()}
                  </span>
                </div>
              )}

              {/* Program & Function */}
              {(txStatus.programId || txStatus.functionName) && (
                <div className="grid grid-cols-2 gap-4">
                  {txStatus.programId && (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
                        Program
                      </div>
                      <span className="font-mono text-xs text-white/60 break-all">
                        {txStatus.programId}
                      </span>
                    </div>
                  )}
                  {txStatus.functionName && (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
                        Function
                      </div>
                      <span className="font-mono text-xs text-white/60">
                        {txStatus.functionName}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Confirmations */}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
                  Confirmations
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className={`h-full ${
                        txStatus.confirmations > 0 ? 'bg-emerald-400' : 'bg-white/20'
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: txStatus.confirmations > 0 ? '100%' : '0%' }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <span className="text-xs text-white/50 tabular-nums">
                    {txStatus.confirmations}
                  </span>
                </div>
              </div>

              {/* Timestamp */}
              {txStatus.timestamp && (
                <div className="pt-2 border-t border-white/5">
                  <span className="text-[10px] text-white/30">
                    Last checked: {new Date(txStatus.timestamp).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default TransactionTracker;
