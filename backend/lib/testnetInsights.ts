import { PrismaClient } from '@prisma/client';

type ActivityItem = {
    id: string;
    type: 'rfq_created' | 'bid_submitted' | 'auction_completed' | 'payment_released';
    message: string;
    timestamp: string;
    blockHeight: number;
    rfqId: string | null;
};

type TransactionItem = {
    id: string;
    type: string;
    amount: string;
    tokenType: number;
    status: 'success';
    timestamp: string;
    rfqId: string;
};

type BuyerLeaderboardEntry = {
    wallet: string;
    rfqsCreated: number;
    completedRfqs: number;
    liveRfqs: number;
    privateSettlements: number;
    completionRate: number;
    auctionRfqs: number;
};

type VendorLeaderboardEntry = {
    wallet: string;
    bidsSubmitted: number;
    revealedBids: number;
    wins: number;
    settlementReceipts: number;
    revealRate: number;
    winRate: number;
};

export type TestnetInsights = {
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
    recentActivity: ActivityItem[];
    recentTransactions: TransactionItem[];
    leaderboards: {
        buyers: BuyerLeaderboardEntry[];
        vendors: VendorLeaderboardEntry[];
    };
};

const ENDED_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'WINNER_DECLINED']);

function percent(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 1000) / 10;
}

function average(total: number, count: number): number {
    if (count <= 0) return 0;
    return Math.round((total / count) * 10) / 10;
}

function shortRfqId(rfqId: string | null): string {
    if (!rfqId) return 'unknown';
    if (rfqId.length <= 14) return rfqId;
    return `${rfqId.slice(0, 8)}...${rfqId.slice(-4)}`;
}

function buildActivityMessage(eventType: string, rfqId: string | null): string {
    const label = shortRfqId(rfqId);
    switch (eventType) {
        case 'RFQ_CREATED':
            return `RFQ ${label} was created on testnet.`;
        case 'BID_COMMITTED':
            return `A sealed bid was committed for RFQ ${label}.`;
        case 'BID_REVEALED':
            return `A committed bid was revealed for RFQ ${label}.`;
        case 'WINNER_SELECTED':
            return `A winner was selected for RFQ ${label}.`;
        case 'ESCROW_FUNDED':
            return `Escrow was funded for RFQ ${label}.`;
        case 'PAYMENT_RELEASED':
            return `Settlement moved for RFQ ${label}.`;
        case 'STAKE_SLASHED':
            return `A non-revealer was slashed on RFQ ${label}.`;
        default:
            return `Protocol activity recorded for RFQ ${label}.`;
    }
}

function mapActivityType(eventType: string): ActivityItem['type'] {
    switch (eventType) {
        case 'RFQ_CREATED':
            return 'rfq_created';
        case 'BID_COMMITTED':
        case 'BID_REVEALED':
            return 'bid_submitted';
        case 'WINNER_SELECTED':
        case 'ESCROW_FUNDED':
            return 'auction_completed';
        default:
            return 'payment_released';
    }
}

export async function getTestnetInsights(prisma: PrismaClient): Promise<TestnetInsights> {
    const [rfqs, bids, recentPayments, recentEvents, allPayments, auditEventCount, settlementTransferCount] = await Promise.all([
        prisma.rFQ.findMany({
            select: {
                id: true,
                buyer: true,
                status: true,
                tokenType: true,
                pricingMode: true,
                paid: true,
                winnerAccepted: true,
            },
        }),
        prisma.bid.findMany({
            select: {
                id: true,
                rfqId: true,
                vendor: true,
                isWinner: true,
                isRevealed: true,
                isSlashed: true,
                isRefunded: true,
            },
        }),
        prisma.payment.findMany({
            orderBy: { releasedAt: 'desc' },
            take: 8,
            select: {
                id: true,
                rfqId: true,
                amount: true,
                isFinal: true,
                releasedAt: true,
            },
        }),
        prisma.rFQEvent.findMany({
            orderBy: { processedAt: 'desc' },
            take: 10,
            select: {
                id: true,
                eventType: true,
                rfqId: true,
                blockHeight: true,
                processedAt: true,
            },
        }),
        prisma.payment.findMany({
            select: {
                recipient: true,
                rfqId: true,
                isFinal: true,
            },
        }),
        prisma.rFQEvent.count(),
        prisma.payment.count(),
    ]);

    const rfqById = new Map(rfqs.map((rfq) => [rfq.id, rfq]));
    const completedRfqs = rfqs.filter((rfq) => rfq.status === 'COMPLETED').length;
    const activeRfqs = rfqs.filter((rfq) => !ENDED_STATUSES.has(rfq.status)).length;
    const openCommitments = bids.filter((bid) => !bid.isRevealed && !bid.isRefunded && !bid.isSlashed).length;
    const privateSettlements = rfqs.filter((rfq) => rfq.paid).length;
    const milestoneReleases = allPayments.filter((payment) => !payment.isFinal).length;
    const stablecoinRfqs = rfqs.filter((rfq) => rfq.tokenType !== 0).length;
    const auctionRfqs = rfqs.filter((rfq) => rfq.pricingMode !== 0).length;
    const directRfqs = rfqs.length - auctionRfqs;
    const revealedBids = bids.filter((bid) => bid.isRevealed).length;
    const winningBids = bids.filter((bid) => bid.isWinner).length;
    const settledRfqCount = new Set(allPayments.map((payment) => payment.rfqId)).size;

    const buyerStats = new Map<string, Omit<BuyerLeaderboardEntry, 'completionRate'>>();
    for (const rfq of rfqs) {
        const current = buyerStats.get(rfq.buyer) ?? {
            wallet: rfq.buyer,
            rfqsCreated: 0,
            completedRfqs: 0,
            liveRfqs: 0,
            privateSettlements: 0,
            auctionRfqs: 0,
        };
        current.rfqsCreated += 1;
        current.completedRfqs += rfq.status === 'COMPLETED' ? 1 : 0;
        current.liveRfqs += ENDED_STATUSES.has(rfq.status) ? 0 : 1;
        current.privateSettlements += rfq.paid ? 1 : 0;
        current.auctionRfqs += rfq.pricingMode !== 0 ? 1 : 0;
        buyerStats.set(rfq.buyer, current);
    }

    const paymentCountsByRecipient = new Map<string, number>();
    for (const payment of allPayments) {
        paymentCountsByRecipient.set(
            payment.recipient,
            (paymentCountsByRecipient.get(payment.recipient) ?? 0) + 1,
        );
    }

    const vendorStats = new Map<string, Omit<VendorLeaderboardEntry, 'revealRate' | 'winRate'>>();
    for (const bid of bids) {
        const current = vendorStats.get(bid.vendor) ?? {
            wallet: bid.vendor,
            bidsSubmitted: 0,
            revealedBids: 0,
            wins: 0,
            settlementReceipts: paymentCountsByRecipient.get(bid.vendor) ?? 0,
        };
        current.bidsSubmitted += 1;
        current.revealedBids += bid.isRevealed ? 1 : 0;
        current.wins += bid.isWinner ? 1 : 0;
        vendorStats.set(bid.vendor, current);
    }

    const tokenCounts = new Map<number, number>([
        [0, 0],
        [1, 0],
        [2, 0],
    ]);
    const pricingCounts = new Map<number, number>([
        [0, 0],
        [1, 0],
        [2, 0],
    ]);

    for (const rfq of rfqs) {
        tokenCounts.set(rfq.tokenType, (tokenCounts.get(rfq.tokenType) ?? 0) + 1);
        pricingCounts.set(rfq.pricingMode, (pricingCounts.get(rfq.pricingMode) ?? 0) + 1);
    }

    return {
        overview: {
            totalRfqs: rfqs.length,
            activeRfqs,
            openCommitments,
            completedRfqs,
            privateSettlements,
            milestoneReleases,
            successRate: percent(completedRfqs, rfqs.length),
            avgBidsPerRfq: average(bids.length, rfqs.length),
        },
        trustMetrics: {
            uniqueBuyers: buyerStats.size,
            uniqueVendors: vendorStats.size,
            revealRate: percent(revealedBids, bids.length),
            winnerAcceptanceRate: percent(rfqs.filter((rfq) => rfq.winnerAccepted).length, winningBids),
            stablecoinUsageRate: percent(stablecoinRfqs, rfqs.length),
            auctionAdoptionRate: percent(auctionRfqs, rfqs.length),
            privateSettlementRate: percent(privateSettlements, settledRfqCount),
        },
        composition: {
            directRfqs,
            auctionRfqs,
            stablecoinRfqs,
            auditEvents: auditEventCount,
            settlementTransfers: settlementTransferCount,
        },
        tokenDistribution: Array.from(tokenCounts.entries()).map(([tokenType, count]) => ({
            tokenType,
            count,
        })),
        pricingDistribution: Array.from(pricingCounts.entries()).map(([pricingMode, count]) => ({
            pricingMode,
            count,
        })),
        recentActivity: recentEvents.map((event) => ({
            id: event.id,
            type: mapActivityType(event.eventType),
            message: buildActivityMessage(event.eventType, event.rfqId),
            timestamp: event.processedAt.toISOString(),
            blockHeight: event.blockHeight,
            rfqId: event.rfqId,
        })),
        recentTransactions: recentPayments.map((payment) => ({
            id: payment.id,
            type: payment.isFinal ? 'Final settlement' : 'Milestone release',
            amount: payment.amount.toString(),
            tokenType: rfqById.get(payment.rfqId)?.tokenType ?? 0,
            status: 'success' as const,
            timestamp: payment.releasedAt.toISOString(),
            rfqId: payment.rfqId,
        })),
        leaderboards: {
            buyers: Array.from(buyerStats.values())
                .map((entry) => ({
                    ...entry,
                    completionRate: percent(entry.completedRfqs, entry.rfqsCreated),
                }))
                .sort((left, right) => {
                    if (right.completedRfqs !== left.completedRfqs) return right.completedRfqs - left.completedRfqs;
                    if (right.completionRate !== left.completionRate) return right.completionRate - left.completionRate;
                    return right.rfqsCreated - left.rfqsCreated;
                })
                .slice(0, 5),
            vendors: Array.from(vendorStats.values())
                .map((entry) => ({
                    ...entry,
                    revealRate: percent(entry.revealedBids, entry.bidsSubmitted),
                    winRate: percent(entry.wins, entry.bidsSubmitted),
                }))
                .sort((left, right) => {
                    if (right.wins !== left.wins) return right.wins - left.wins;
                    if (right.revealRate !== left.revealRate) return right.revealRate - left.revealRate;
                    return right.bidsSubmitted - left.bidsSubmitted;
                })
                .slice(0, 5),
        },
    };
}
