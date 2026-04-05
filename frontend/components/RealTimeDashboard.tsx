'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { authenticatedFetch } from '@/lib/authFetch';
import { PageShell, Panel } from '@/components/protocol/ProtocolPrimitives';
import {
    Activity,
    TrendingUp,
    Clock,
    CheckCircle2,
    FileText,
    Gavel,
    DollarSign,
    Wifi,
    WifiOff,
    RefreshCw,
    ArrowUpRight,
    ArrowDownRight,
    Zap,
} from 'lucide-react';

interface DashboardMetrics {
    activeRfqs: number;
    pendingBids: number;
    completedAuctions: number;
    totalVolume: string;
}

interface ActivityEvent {
    id: string;
    type: 'rfq_created' | 'bid_submitted' | 'auction_completed' | 'payment_released';
    message: string;
    timestamp: Date;
}

interface Transaction {
    id: string;
    type: string;
    amount: string;
    status: 'success' | 'pending' | 'failed';
    timestamp: Date;
}

type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

// Animated counter component
function AnimatedCounter({ value, duration = 1000 }: { value: number; duration?: number }) {
    const [displayValue, setDisplayValue] = useState(0);
    const previousValueRef = useRef(0);

    useEffect(() => {
        const startValue = previousValueRef.current;
        const endValue = value;
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function for smooth animation
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const currentValue = Math.round(startValue + (endValue - startValue) * easeOutQuart);

            setDisplayValue(currentValue);

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                previousValueRef.current = endValue;
            }
        };

        requestAnimationFrame(animate);
    }, [value, duration]);

    return <span>{displayValue.toLocaleString()}</span>;
}

// Connection status indicator
function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
    const statusConfig = {
        connected: {
            icon: Wifi,
            label: 'Connected',
            className: 'text-emerald-400 bg-emerald-400/15 border-emerald-400/30',
            dotColor: 'bg-emerald-400',
        },
        reconnecting: {
            icon: RefreshCw,
            label: 'Reconnecting...',
            className: 'text-amber-400 bg-amber-400/15 border-amber-400/30',
            dotColor: 'bg-amber-400',
        },
        disconnected: {
            icon: WifiOff,
            label: 'Disconnected',
            className: 'text-red-400 bg-red-400/15 border-red-400/30',
            dotColor: 'bg-red-400',
        },
    };

    const config = statusConfig[status];
    const Icon = config.icon;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${config.className}`}
        >
            <span className="relative flex h-2 w-2">
                <span
                    className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${config.dotColor}`}
                />
                <span className={`relative inline-flex h-2 w-2 rounded-full ${config.dotColor}`} />
            </span>
            <Icon className={`h-3.5 w-3.5 ${status === 'reconnecting' ? 'animate-spin' : ''}`} />
            <span>{config.label}</span>
        </motion.div>
    );
}

// Metric card component
function MetricCard({
    label,
    value,
    icon: Icon,
    trend,
    trendValue,
    color,
}: {
    label: string;
    value: number;
    icon: React.ElementType;
    trend?: 'up' | 'down' | 'neutral';
    trendValue?: string;
    color: 'emerald' | 'blue' | 'amber' | 'purple';
}) {
    const colorClasses = {
        emerald: {
            bg: 'bg-emerald-400/10',
            border: 'border-emerald-400/25',
            text: 'text-emerald-300',
            icon: 'bg-emerald-400/15 border-emerald-300/25 text-emerald-200',
        },
        blue: {
            bg: 'bg-blue-400/10',
            border: 'border-blue-400/25',
            text: 'text-blue-300',
            icon: 'bg-blue-400/15 border-blue-300/25 text-blue-200',
        },
        amber: {
            bg: 'bg-amber-400/10',
            border: 'border-amber-400/25',
            text: 'text-amber-300',
            icon: 'bg-amber-400/15 border-amber-300/25 text-amber-200',
        },
        purple: {
            bg: 'bg-purple-400/10',
            border: 'border-purple-400/25',
            text: 'text-purple-300',
            icon: 'bg-purple-400/15 border-purple-300/25 text-purple-200',
        },
    };

    const colors = colorClasses[color];

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02, y: -2 }}
            transition={{ duration: 0.2 }}
            className={`group relative overflow-hidden rounded-2xl border ${colors.border} ${colors.bg} p-5 transition-all duration-300 hover:shadow-lg hover:shadow-black/20`}
        >
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

            <div className="relative">
                <div className="flex items-start justify-between">
                    <div
                        className={`flex h-11 w-11 items-center justify-center rounded-xl border ${colors.icon}`}
                    >
                        <Icon className="h-5 w-5" />
                    </div>
                    {trend && trendValue && (
                        <div
                            className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
                                trend === 'up'
                                    ? 'bg-emerald-400/15 text-emerald-300'
                                    : trend === 'down'
                                      ? 'bg-red-400/15 text-red-300'
                                      : 'bg-white/10 text-white/60'
                            }`}
                        >
                            {trend === 'up' ? (
                                <ArrowUpRight className="h-3 w-3" />
                            ) : trend === 'down' ? (
                                <ArrowDownRight className="h-3 w-3" />
                            ) : null}
                            {trendValue}
                        </div>
                    )}
                </div>

                <div className="mt-4">
                    <div className={`text-3xl font-bold ${colors.text}`}>
                        <AnimatedCounter value={value} />
                    </div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
                        {label}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

// Activity event item
function ActivityEventItem({ event, index }: { event: ActivityEvent; index: number }) {
    const eventConfig = {
        rfq_created: {
            icon: FileText,
            color: 'text-blue-300 bg-blue-400/15 border-blue-300/30',
        },
        bid_submitted: {
            icon: Gavel,
            color: 'text-amber-300 bg-amber-400/15 border-amber-300/30',
        },
        auction_completed: {
            icon: CheckCircle2,
            color: 'text-emerald-300 bg-emerald-400/15 border-emerald-300/30',
        },
        payment_released: {
            icon: DollarSign,
            color: 'text-purple-300 bg-purple-400/15 border-purple-300/30',
        },
    };

    const config = eventConfig[event.type];
    const Icon = config.icon;

    const formatTime = (date: Date) => {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (seconds < 60) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return date.toLocaleDateString();
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ delay: index * 0.05 }}
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06]"
        >
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${config.color}`}>
                <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-sm text-white/90">{event.message}</p>
                <p className="mt-0.5 text-xs text-white/50">{formatTime(event.timestamp)}</p>
            </div>
            <Zap className="h-3 w-3 shrink-0 text-white/30" />
        </motion.div>
    );
}

// Transaction item
function TransactionItem({ transaction, index }: { transaction: Transaction; index: number }) {
    const statusConfig = {
        success: { label: 'Completed', color: 'text-emerald-300 bg-emerald-400/15' },
        pending: { label: 'Pending', color: 'text-amber-300 bg-amber-400/15' },
        failed: { label: 'Failed', color: 'text-red-300 bg-red-400/15' },
    };

    const config = statusConfig[transaction.status];

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06]"
        >
            <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/[0.08]">
                    <DollarSign className="h-4 w-4 text-white/70" />
                </div>
                <div>
                    <p className="text-sm font-medium text-white">{transaction.type}</p>
                    <p className="text-xs text-white/50">
                        {transaction.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                </div>
            </div>
            <div className="text-right">
                <p className="text-sm font-semibold text-white">{transaction.amount}</p>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${config.color}`}>
                    {config.label}
                </span>
            </div>
        </motion.div>
    );
}

export function RealTimeDashboard() {
    const [metrics, setMetrics] = useState<DashboardMetrics>({
        activeRfqs: 0,
        pendingBids: 0,
        completedAuctions: 0,
        totalVolume: '0',
    });
    const [activities, setActivities] = useState<ActivityEvent[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const retryCountRef = useRef(0);
    const maxRetries = 3;

    const fetchDashboardData = useCallback(async () => {
        try {
            setConnectionStatus('reconnecting');
            
            const response = await authenticatedFetch('/api/analytics');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const payload = await response.json();
            const data = payload.data ?? payload;

            // Update metrics
            setMetrics({
                activeRfqs: data.activeRfqs ?? data.active_rfqs ?? 0,
                pendingBids: data.pendingBids ?? data.pending_bids ?? 0,
                completedAuctions: data.completedAuctions ?? data.completed_auctions ?? 0,
                totalVolume: data.totalVolume ?? data.total_volume ?? '0',
            });

            // Update activities if available
            if (data.recentActivity || data.recent_activity) {
                const rawActivities = data.recentActivity || data.recent_activity || [];
                setActivities(
                    rawActivities.slice(0, 10).map((a: { id?: string; type: ActivityEvent['type']; message: string; timestamp: string }, idx: number) => ({
                        id: a.id ?? `activity-${idx}-${Date.now()}`,
                        type: a.type,
                        message: a.message,
                        timestamp: new Date(a.timestamp),
                    }))
                );
            }

            // Update transactions if available
            if (data.recentTransactions || data.recent_transactions) {
                const rawTransactions = data.recentTransactions || data.recent_transactions || [];
                setTransactions(
                    rawTransactions.slice(0, 5).map((t: { id?: string; type: string; amount: string; status: Transaction['status']; timestamp: string }, idx: number) => ({
                        id: t.id ?? `tx-${idx}-${Date.now()}`,
                        type: t.type,
                        amount: t.amount,
                        status: t.status,
                        timestamp: new Date(t.timestamp),
                    }))
                );
            }

            setConnectionStatus('connected');
            setLastUpdated(new Date());
            retryCountRef.current = 0;
            setIsLoading(false);
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error);
            retryCountRef.current += 1;

            if (retryCountRef.current >= maxRetries) {
                setConnectionStatus('disconnected');
            } else {
                setConnectionStatus('reconnecting');
            }
            setIsLoading(false);
        }
    }, []);

    // Initial fetch and polling
    useEffect(() => {
        fetchDashboardData();

        const pollInterval = setInterval(() => {
            fetchDashboardData();
        }, 5000);

        return () => clearInterval(pollInterval);
    }, [fetchDashboardData]);

    // Parse volume for display
    const volumeValue = parseFloat(metrics.totalVolume.replace(/[^0-9.]/g, '')) || 0;

    return (
        <PageShell className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-200/75">
                        <span className="h-1 w-1 rounded-full bg-emerald-400/70" />
                        Live Dashboard
                    </div>
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                        Real-Time Analytics
                    </h1>
                    {lastUpdated && (
                        <p className="mt-1 text-sm text-white/50">
                            Last updated: {lastUpdated.toLocaleTimeString()}
                        </p>
                    )}
                </div>
                <ConnectionIndicator status={connectionStatus} />
            </div>

            {/* Loading skeleton */}
            {isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[...Array(4)].map((_, i) => (
                        <div
                            key={i}
                            className="h-36 animate-pulse rounded-2xl border border-white/12 bg-white/[0.04]"
                        />
                    ))}
                </div>
            ) : (
                <>
                    {/* Metrics Grid */}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <MetricCard
                            label="Active RFQs"
                            value={metrics.activeRfqs}
                            icon={FileText}
                            trend="up"
                            trendValue="+12%"
                            color="blue"
                        />
                        <MetricCard
                            label="Pending Bids"
                            value={metrics.pendingBids}
                            icon={Clock}
                            trend="neutral"
                            trendValue="0%"
                            color="amber"
                        />
                        <MetricCard
                            label="Completed Auctions"
                            value={metrics.completedAuctions}
                            icon={CheckCircle2}
                            trend="up"
                            trendValue="+8%"
                            color="emerald"
                        />
                        <MetricCard
                            label="Total Volume"
                            value={volumeValue}
                            icon={TrendingUp}
                            trend="up"
                            trendValue="+23%"
                            color="purple"
                        />
                    </div>

                    {/* Activity and Transactions Grid */}
                    <div className="grid gap-6 lg:grid-cols-2">
                        {/* Activity Feed */}
                        <Panel title="Live Activity Feed" subtitle="Recent platform events">
                            <div className="space-y-2">
                                <AnimatePresence mode="popLayout">
                                    {activities.length > 0 ? (
                                        activities.map((event, index) => (
                                            <ActivityEventItem key={event.id} event={event} index={index} />
                                        ))
                                    ) : (
                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            className="flex flex-col items-center justify-center py-8 text-center"
                                        >
                                            <Activity className="h-10 w-10 text-white/20" />
                                            <p className="mt-3 text-sm text-white/50">No recent activity</p>
                                            <p className="text-xs text-white/30">Events will appear here in real-time</p>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </Panel>

                        {/* Recent Transactions */}
                        <Panel title="Recent Transactions" subtitle="Latest settlement activity">
                            <div className="space-y-2">
                                {transactions.length > 0 ? (
                                    transactions.map((transaction, index) => (
                                        <TransactionItem key={transaction.id} transaction={transaction} index={index} />
                                    ))
                                ) : (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="flex flex-col items-center justify-center py-8 text-center"
                                    >
                                        <DollarSign className="h-10 w-10 text-white/20" />
                                        <p className="mt-3 text-sm text-white/50">No recent transactions</p>
                                        <p className="text-xs text-white/30">Transactions will appear here</p>
                                    </motion.div>
                                )}
                            </div>
                        </Panel>
                    </div>

                    {/* Status Bar */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/15">
                                <Zap className="h-4 w-4 text-emerald-300" />
                            </div>
                            <span className="text-sm text-white/70">
                                Polling every <span className="font-semibold text-white">5 seconds</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-white/50">
                            <span>Retries: {retryCountRef.current}/{maxRetries}</span>
                            <span className="text-white/30">|</span>
                            <span>Status: {connectionStatus}</span>
                        </div>
                    </motion.div>
                </>
            )}
        </PageShell>
    );
}

export default RealTimeDashboard;
