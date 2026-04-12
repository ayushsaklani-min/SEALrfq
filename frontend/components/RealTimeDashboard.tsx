'use client';

import { useState, useEffect, useCallback, useRef, type ElementType } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { authenticatedFetch } from '@/lib/authFetch';
import { formatAmount, pricingLabel, tokenLabel } from '@/lib/sealProtocol';
import { PageShell, Panel } from '@/components/protocol/ProtocolPrimitives';
import {
    Activity,
    Blocks,
    CheckCircle2,
    Clock,
    DollarSign,
    Gavel,
    RefreshCw,
    ShieldCheck,
    TrendingUp,
    UserCheck,
    Users,
    Wifi,
    WifiOff,
    Zap,
} from 'lucide-react';

type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

type DashboardInsights = {
    overview: {
        totalRfqs: number;
        activeRfqs: number;
        openCommitments: number;
        completedRfqs: number;
        privateSettlements: number;
        milestoneReleases: number;
        successRate: number;
        avgBidsPerRfq: number;
    };
    trustMetrics: {
        uniqueBuyers: number;
        uniqueVendors: number;
        revealRate: number;
        winnerAcceptanceRate: number;
        stablecoinUsageRate: number;
        auctionAdoptionRate: number;
        privateSettlementRate: number;
    };
    composition: {
        directRfqs: number;
        auctionRfqs: number;
        stablecoinRfqs: number;
        auditEvents: number;
        settlementTransfers: number;
    };
    tokenDistribution: Array<{
        tokenType: number;
        count: number;
    }>;
    pricingDistribution: Array<{
        pricingMode: number;
        count: number;
    }>;
    recentActivity: Array<{
        id: string;
        type: 'rfq_created' | 'bid_submitted' | 'auction_completed' | 'payment_released';
        message: string;
        timestamp: string;
        blockHeight: number;
        rfqId: string | null;
    }>;
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: string;
        tokenType: number;
        status: 'success';
        timestamp: string;
        rfqId: string;
    }>;
    leaderboards: {
        buyers: Array<{
            wallet: string;
            rfqsCreated: number;
            completedRfqs: number;
            liveRfqs: number;
            privateSettlements: number;
            completionRate: number;
            auctionRfqs: number;
        }>;
        vendors: Array<{
            wallet: string;
            bidsSubmitted: number;
            revealedBids: number;
            wins: number;
            settlementReceipts: number;
            revealRate: number;
            winRate: number;
        }>;
    };
};

function AnimatedCounter({ value, duration = 900 }: { value: number; duration?: number }) {
    const [displayValue, setDisplayValue] = useState(0);
    const previousValueRef = useRef(0);

    useEffect(() => {
        const startValue = previousValueRef.current;
        const endValue = value;
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 4);
            setDisplayValue(Math.round(startValue + (endValue - startValue) * eased));

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
            label: 'Refreshing...',
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
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${config.className}`}
        >
            <span className="relative flex h-2 w-2">
                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${config.dotColor}`} />
                <span className={`relative inline-flex h-2 w-2 rounded-full ${config.dotColor}`} />
            </span>
            <Icon className={`h-3.5 w-3.5 ${status === 'reconnecting' ? 'animate-spin' : ''}`} />
            <span>{config.label}</span>
        </motion.div>
    );
}

function MetricCard({
    label,
    value,
    icon: Icon,
    color,
    sublabel,
}: {
    label: string;
    value: number;
    icon: ElementType;
    color: 'emerald' | 'blue' | 'amber' | 'purple';
    sublabel: string;
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
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl border ${colors.border} ${colors.bg} p-5`}
        >
            <div className="flex items-start justify-between">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${colors.icon}`}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
            <div className={`mt-4 text-3xl font-bold ${colors.text}`}>
                <AnimatedCounter value={value} />
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">{label}</div>
            <div className="mt-2 text-xs leading-5 text-white/55">{sublabel}</div>
        </motion.div>
    );
}

function CompactStat({ label, value, hint }: { label: string; value: string; hint: string }) {
    return (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">{label}</div>
            <div className="mt-2 text-lg font-semibold text-white">{value}</div>
            <div className="mt-1 text-xs leading-5 text-white/55">{hint}</div>
        </div>
    );
}

function ActivityEventItem({
    event,
    index,
}: {
    event: DashboardInsights['recentActivity'][number];
    index: number;
}) {
    const eventConfig = {
        rfq_created: {
            icon: Activity,
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

    return (
        <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ delay: index * 0.04 }}
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.06]"
        >
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${config.color}`}>
                <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-sm text-white/90">{event.message}</p>
                <p className="mt-0.5 text-xs text-white/50">
                    Block {event.blockHeight} • {new Date(event.timestamp).toLocaleString()}
                </p>
            </div>
        </motion.div>
    );
}

function TransactionItem({
    transaction,
    index,
}: {
    transaction: DashboardInsights['recentTransactions'][number];
    index: number;
}) {
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
                        {new Date(transaction.timestamp).toLocaleString()} • {transaction.rfqId.slice(0, 8)}...
                    </p>
                </div>
            </div>
            <div className="text-right">
                <p className="text-sm font-semibold text-white">{formatAmount(transaction.amount, transaction.tokenType)}</p>
                <span className="inline-block rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    Settled
                </span>
            </div>
        </motion.div>
    );
}

function truncateWallet(wallet: string) {
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function LeaderboardRow({
    index,
    title,
    primary,
    secondary,
}: {
    index: number;
    title: string;
    primary: string;
    secondary: string;
}) {
    return (
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/[0.08] text-xs font-semibold text-white/80">
                    {index + 1}
                </div>
                <div>
                    <div className="text-sm font-medium text-white">{title}</div>
                    <div className="text-xs text-white/50">{secondary}</div>
                </div>
            </div>
            <div className="text-sm font-semibold text-white">{primary}</div>
        </div>
    );
}

export function RealTimeDashboard() {
    const [insights, setInsights] = useState<DashboardInsights | null>(null);
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
                throw new Error(`HTTP error ${response.status}`);
            }

            const payload = await response.json();
            setInsights(payload.data ?? null);
            setConnectionStatus('connected');
            setLastUpdated(new Date());
            retryCountRef.current = 0;
            setIsLoading(false);
        } catch (error) {
            console.error('Failed to fetch insights:', error);
            retryCountRef.current += 1;
            setConnectionStatus(retryCountRef.current >= maxRetries ? 'disconnected' : 'reconnecting');
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboardData();
        const pollInterval = setInterval(fetchDashboardData, 5000);
        return () => clearInterval(pollInterval);
    }, [fetchDashboardData]);

    return (
        <PageShell className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-200/75">
                        <span className="h-1 w-1 rounded-full bg-emerald-400/70" />
                        Testnet Command Center
                    </div>
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                        SEALrfq Insights
                    </h1>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                        Procurement-first telemetry for the buildathon story: trust, settlement execution, auction adoption, and private-payment usage.
                    </p>
                    {lastUpdated ? (
                        <p className="mt-1 text-xs text-white/45">
                            Last updated {lastUpdated.toLocaleTimeString()}
                        </p>
                    ) : null}
                </div>
                <ConnectionIndicator status={connectionStatus} />
            </div>

            {isLoading || !insights ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[...Array(4)].map((_, index) => (
                        <div
                            key={index}
                            className="h-36 animate-pulse rounded-2xl border border-white/12 bg-white/[0.04]"
                        />
                    ))}
                </div>
            ) : (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <MetricCard
                            label="Active RFQs"
                            value={insights.overview.activeRfqs}
                            icon={Activity}
                            color="blue"
                            sublabel={`${insights.overview.totalRfqs} total RFQs tracked on testnet.`}
                        />
                        <MetricCard
                            label="Open Commitments"
                            value={insights.overview.openCommitments}
                            icon={Clock}
                            color="amber"
                            sublabel="Committed bids not yet revealed, refunded, or slashed."
                        />
                        <MetricCard
                            label="Completed RFQs"
                            value={insights.overview.completedRfqs}
                            icon={CheckCircle2}
                            color="emerald"
                            sublabel={`${insights.overview.successRate}% of created RFQs have reached completion.`}
                        />
                        <MetricCard
                            label="Private Settlements"
                            value={insights.overview.privateSettlements}
                            icon={ShieldCheck}
                            color="purple"
                            sublabel="Winner paid through the private invoice path."
                        />
                    </div>

                    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                        <Panel
                            title="Buildathon edge"
                            subtitle="These are the metrics that differentiate SEALrfq as a testnet procurement protocol instead of a generic auction surface."
                        >
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <CompactStat
                                    label="Reveal discipline"
                                    value={`${insights.trustMetrics.revealRate}%`}
                                    hint="How often committed bids complete the sealed reveal step."
                                />
                                <CompactStat
                                    label="Winner follow-through"
                                    value={`${insights.trustMetrics.winnerAcceptanceRate}%`}
                                    hint="How often selected winners accept and continue settlement."
                                />
                                <CompactStat
                                    label="Stablecoin usage"
                                    value={`${insights.trustMetrics.stablecoinUsageRate}%`}
                                    hint="Share of RFQs using USDCx or USAD instead of native credits."
                                />
                                <CompactStat
                                    label="Auction adoption"
                                    value={`${insights.trustMetrics.auctionAdoptionRate}%`}
                                    hint="Share of RFQs that escalate into Vickrey or Dutch price discovery."
                                />
                            </div>
                        </Panel>

                        <Panel
                            title="Protocol composition"
                            subtitle="Live mix of direct RFQs, auction-linked workflows, compliance tokens, and audit coverage."
                        >
                            <div className="grid gap-3 sm:grid-cols-2">
                                <CompactStat
                                    label="Direct RFQs"
                                    value={String(insights.composition.directRfqs)}
                                    hint="Buyer-led procurement without a separate auction handoff."
                                />
                                <CompactStat
                                    label="Auction RFQs"
                                    value={String(insights.composition.auctionRfqs)}
                                    hint="RFQs that use Dutch or Vickrey price discovery before settlement."
                                />
                                <CompactStat
                                    label="Stablecoin RFQs"
                                    value={String(insights.composition.stablecoinRfqs)}
                                    hint="Deals that are compatible with compliant stablecoin settlement."
                                />
                                <CompactStat
                                    label="Audit events"
                                    value={String(insights.composition.auditEvents)}
                                    hint="Indexed on-chain events available for audit workspace review."
                                />
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
                                        <Blocks className="h-3.5 w-3.5" />
                                        Token mix
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {insights.tokenDistribution.map((item) => (
                                            <span
                                                key={`token-${item.tokenType}`}
                                                className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/80"
                                            >
                                                {tokenLabel(item.tokenType)} • {item.count}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
                                        <Gavel className="h-3.5 w-3.5" />
                                        Pricing mix
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {insights.pricingDistribution.map((item) => (
                                            <span
                                                key={`pricing-${item.pricingMode}`}
                                                className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/80"
                                            >
                                                {pricingLabel(item.pricingMode)} • {item.count}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </Panel>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Panel
                            title="Buyer trust board"
                            subtitle="Top buyers ranked by delivery through completion, private settlements, and workflow throughput."
                        >
                            <div className="space-y-2">
                                {insights.leaderboards.buyers.length > 0 ? (
                                    insights.leaderboards.buyers.map((buyer, index) => (
                                        <LeaderboardRow
                                            key={buyer.wallet}
                                            index={index}
                                            title={truncateWallet(buyer.wallet)}
                                            primary={`${buyer.completionRate}%`}
                                            secondary={`${buyer.completedRfqs}/${buyer.rfqsCreated} completed • ${buyer.privateSettlements} private • ${buyer.auctionRfqs} auction-linked`}
                                        />
                                    ))
                                ) : (
                                    <div className="py-8 text-sm text-white/55">No buyer activity indexed yet.</div>
                                )}
                            </div>
                        </Panel>

                        <Panel
                            title="Vendor reliability board"
                            subtitle="Top vendors ranked by reveal discipline, win conversion, and settlement participation."
                        >
                            <div className="space-y-2">
                                {insights.leaderboards.vendors.length > 0 ? (
                                    insights.leaderboards.vendors.map((vendor, index) => (
                                        <LeaderboardRow
                                            key={vendor.wallet}
                                            index={index}
                                            title={truncateWallet(vendor.wallet)}
                                            primary={`${vendor.revealRate}%`}
                                            secondary={`${vendor.wins} wins • ${vendor.revealedBids}/${vendor.bidsSubmitted} revealed • ${vendor.settlementReceipts} receipts`}
                                        />
                                    ))
                                ) : (
                                    <div className="py-8 text-sm text-white/55">No vendor activity indexed yet.</div>
                                )}
                            </div>
                        </Panel>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Panel title="Live activity feed" subtitle="Recent protocol events from the indexed testnet trail.">
                            <div className="space-y-2">
                                <AnimatePresence mode="popLayout">
                                    {insights.recentActivity.length > 0 ? (
                                        insights.recentActivity.map((event, index) => (
                                            <ActivityEventItem key={event.id} event={event} index={index} />
                                        ))
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-8 text-center">
                                            <Activity className="h-10 w-10 text-white/20" />
                                            <p className="mt-3 text-sm text-white/50">No recent activity</p>
                                        </div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </Panel>

                        <Panel title="Recent settlements" subtitle="Latest settlement actions executed by the escrow and invoice flows.">
                            <div className="space-y-2">
                                {insights.recentTransactions.length > 0 ? (
                                    insights.recentTransactions.map((transaction, index) => (
                                        <TransactionItem key={transaction.id} transaction={transaction} index={index} />
                                    ))
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-8 text-center">
                                        <DollarSign className="h-10 w-10 text-white/20" />
                                        <p className="mt-3 text-sm text-white/50">No recent settlements</p>
                                    </div>
                                )}
                            </div>
                        </Panel>
                    </div>

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
                                Testnet only. Polling every <span className="font-semibold text-white">5 seconds</span>
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
                            <span className="inline-flex items-center gap-1.5">
                                <Users className="h-3.5 w-3.5" />
                                {insights.trustMetrics.uniqueBuyers} buyers
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <UserCheck className="h-3.5 w-3.5" />
                                {insights.trustMetrics.uniqueVendors} vendors
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <TrendingUp className="h-3.5 w-3.5" />
                                {insights.overview.avgBidsPerRfq} avg bids/RFQ
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <ShieldCheck className="h-3.5 w-3.5" />
                                {insights.trustMetrics.privateSettlementRate}% private-settlement share
                            </span>
                        </div>
                    </motion.div>
                </>
            )}
        </PageShell>
    );
}

export default RealTimeDashboard;
