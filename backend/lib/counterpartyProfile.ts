import { PrismaClient } from '@prisma/client';

type BuyerAccumulator = {
    wallet: string;
    rfqsCreated: number;
    completedRfqs: number;
    liveRfqs: number;
    privateSettlements: number;
    auctionRfqs: number;
};

type VendorAccumulator = {
    wallet: string;
    bidsSubmitted: number;
    revealedBids: number;
    wins: number;
    settlementReceipts: number;
    slashedBids: number;
};

export type BuyerProfileSummary = {
    kind: 'buyer';
    wallet: string;
    trustScore: number;
    summaryLabel: string;
    rfqsCreated: number;
    completedRfqs: number;
    liveRfqs: number;
    privateSettlements: number;
    completionRate: number;
    auctionUsageRate: number;
};

export type VendorProfileSummary = {
    kind: 'vendor';
    wallet: string;
    trustScore: number;
    summaryLabel: string;
    bidsSubmitted: number;
    revealedBids: number;
    wins: number;
    settlementReceipts: number;
    slashedBids: number;
    revealRate: number;
    winRate: number;
};

const TERMINAL_RFQ_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'WINNER_DECLINED']);

function percent(part: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((part / total) * 100);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function buyerLabel(score: number): string {
    if (score >= 80) return 'Institutional buyer';
    if (score >= 60) return 'Reliable buyer';
    if (score >= 35) return 'Growing buyer';
    return 'New buyer';
}

function vendorLabel(score: number): string {
    if (score >= 80) return 'Reliable supplier';
    if (score >= 60) return 'Responsive supplier';
    if (score >= 35) return 'Emerging supplier';
    return 'New supplier';
}

function buildBuyerSummary(stats: BuyerAccumulator): BuyerProfileSummary {
    const completionRate = percent(stats.completedRfqs, stats.rfqsCreated);
    const auctionUsageRate = percent(stats.auctionRfqs, stats.rfqsCreated);
    const score = clamp(
        Math.round(
            Math.min(stats.rfqsCreated * 8, 24) +
                completionRate * 0.45 +
                Math.min(stats.privateSettlements * 8, 16) +
                auctionUsageRate * 0.1,
        ),
        0,
        100,
    );

    return {
        kind: 'buyer',
        wallet: stats.wallet,
        trustScore: score,
        summaryLabel: buyerLabel(score),
        rfqsCreated: stats.rfqsCreated,
        completedRfqs: stats.completedRfqs,
        liveRfqs: stats.liveRfqs,
        privateSettlements: stats.privateSettlements,
        completionRate,
        auctionUsageRate,
    };
}

function buildVendorSummary(stats: VendorAccumulator): VendorProfileSummary {
    const revealRate = percent(stats.revealedBids, stats.bidsSubmitted);
    const winRate = percent(stats.wins, stats.bidsSubmitted);
    const score = clamp(
        Math.round(
            Math.min(stats.bidsSubmitted * 5, 20) +
                revealRate * 0.5 +
                winRate * 0.15 +
                Math.min(stats.settlementReceipts * 8, 16) -
                Math.min(stats.slashedBids * 10, 20),
        ),
        0,
        100,
    );

    return {
        kind: 'vendor',
        wallet: stats.wallet,
        trustScore: score,
        summaryLabel: vendorLabel(score),
        bidsSubmitted: stats.bidsSubmitted,
        revealedBids: stats.revealedBids,
        wins: stats.wins,
        settlementReceipts: stats.settlementReceipts,
        slashedBids: stats.slashedBids,
        revealRate,
        winRate,
    };
}

export async function getBuyerProfiles(
    prisma: PrismaClient,
    wallets: Array<string | null | undefined>,
): Promise<Record<string, BuyerProfileSummary>> {
    const uniqueWallets = Array.from(new Set(wallets.filter((wallet): wallet is string => Boolean(wallet))));
    if (uniqueWallets.length === 0) return {};

    const rfqs = await prisma.rFQ.findMany({
        where: {
            buyer: { in: uniqueWallets },
        },
        select: {
            buyer: true,
            status: true,
            paid: true,
            pricingMode: true,
        },
    });

    const accumulators = new Map<string, BuyerAccumulator>(
        uniqueWallets.map((wallet) => [
            wallet,
            {
                wallet,
                rfqsCreated: 0,
                completedRfqs: 0,
                liveRfqs: 0,
                privateSettlements: 0,
                auctionRfqs: 0,
            },
        ]),
    );

    for (const rfq of rfqs) {
        const current = accumulators.get(rfq.buyer);
        if (!current) continue;
        current.rfqsCreated += 1;
        current.completedRfqs += rfq.status === 'COMPLETED' ? 1 : 0;
        current.liveRfqs += TERMINAL_RFQ_STATUSES.has(rfq.status) ? 0 : 1;
        current.privateSettlements += rfq.paid ? 1 : 0;
        current.auctionRfqs += rfq.pricingMode !== 0 ? 1 : 0;
    }

    return Array.from(accumulators.values()).reduce<Record<string, BuyerProfileSummary>>((acc, stats) => {
        acc[stats.wallet] = buildBuyerSummary(stats);
        return acc;
    }, {});
}

export async function getVendorProfiles(
    prisma: PrismaClient,
    wallets: Array<string | null | undefined>,
): Promise<Record<string, VendorProfileSummary>> {
    const uniqueWallets = Array.from(new Set(wallets.filter((wallet): wallet is string => Boolean(wallet))));
    if (uniqueWallets.length === 0) return {};

    const [bids, payments] = await Promise.all([
        prisma.bid.findMany({
            where: {
                vendor: { in: uniqueWallets },
            },
            select: {
                vendor: true,
                isRevealed: true,
                isWinner: true,
                isSlashed: true,
            },
        }),
        prisma.payment.findMany({
            where: {
                recipient: { in: uniqueWallets },
            },
            select: {
                recipient: true,
            },
        }),
    ]);

    const accumulators = new Map<string, VendorAccumulator>(
        uniqueWallets.map((wallet) => [
            wallet,
            {
                wallet,
                bidsSubmitted: 0,
                revealedBids: 0,
                wins: 0,
                settlementReceipts: 0,
                slashedBids: 0,
            },
        ]),
    );

    for (const bid of bids) {
        const current = accumulators.get(bid.vendor);
        if (!current) continue;
        current.bidsSubmitted += 1;
        current.revealedBids += bid.isRevealed ? 1 : 0;
        current.wins += bid.isWinner ? 1 : 0;
        current.slashedBids += bid.isSlashed ? 1 : 0;
    }

    for (const payment of payments) {
        const current = accumulators.get(payment.recipient);
        if (!current) continue;
        current.settlementReceipts += 1;
    }

    return Array.from(accumulators.values()).reduce<Record<string, VendorProfileSummary>>((acc, stats) => {
        acc[stats.wallet] = buildVendorSummary(stats);
        return acc;
    }, {});
}
