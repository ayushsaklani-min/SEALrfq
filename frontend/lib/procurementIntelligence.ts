import { formatAmount, pricingLabel, STATUS_LABELS, tokenLabel, TOKEN_TYPE } from '@/lib/sealProtocol';
import type { DeliveryMilestone } from '@/lib/deliveryAssurance';

type BuyerProfileLike = {
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

type VendorProfileLike = {
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

type DecisionBidInput = {
    id: string;
    vendor: string;
    isRevealed?: boolean;
    isWinner?: boolean;
    revealedAmount?: string | null;
    vendorProfile?: VendorProfileLike | null;
};

type OpportunityInput = {
    biddingDeadline: number;
    currentBlock: number | null;
    tokenType: number;
    pricingMode: number;
    bidCount?: string | number | null;
    minBidCount?: string | number | null;
    buyerProfile?: BuyerProfileLike | null;
};

type PacketInput = {
    rfq: {
        id: string;
        buyer: string;
        itemName?: string | null;
        description?: string | null;
        status: string;
        tokenType: number;
        pricingMode: number;
        biddingDeadline: number;
        revealDeadline: number;
        winningVendor?: string | null;
        winningBidId?: string | null;
        winningBidAmount?: string | null;
        winnerAccepted?: boolean;
        paid?: boolean;
        buyerProfile?: BuyerProfileLike | null;
    };
    events: Array<{
        eventType: string;
        txId: string;
        blockHeight: number;
        processedAt: string;
        transition?: string;
    }>;
    milestones?: DeliveryMilestone[];
    decision: WinnerSelectionDecision;
};

export type RankedBidDecision = {
    id: string;
    vendor: string;
    revealedAmount: string;
    vendorProfile: VendorProfileLike | null;
    amountRank: number;
    recommendationScore: number;
    riskLevel: 'low' | 'medium' | 'high';
    recommendationLabel: string;
    deltaFromLowestBps: number;
    deltaFromLowestPercent: number;
    deltaFromLowestLabel: string;
    priceScore: number;
    trustScore: number;
    revealRate: number;
    settlementReceipts: number;
    strengths: string[];
    cautions: string[];
    isRecommended: boolean;
    isLowestPrice: boolean;
    isWinner?: boolean;
};

export type WinnerSelectionDecision = {
    rankedBids: RankedBidDecision[];
    recommendedBid: RankedBidDecision | null;
    lowestBid: RankedBidDecision | null;
    bidderCount: number;
    averageTrustScore: number;
    averageRevealRate: number;
    profileCoverageRate: number;
    priceSpreadPercent: number;
    recommendedSummary: string;
    decisionReasons: string[];
    procurementWarnings: string[];
};

export type VendorOpportunitySnapshot = {
    summaryTitle: string;
    recommendation: string;
    tone: 'neutral' | 'success' | 'warning' | 'danger';
    buyerTrustScore: number;
    buyerCompletionRate: number;
    profileCoverageLabel: string;
    competitionProgressLabel: string;
    blocksRemaining: number | null;
    settlementLabel: string;
    positives: string[];
    cautions: string[];
};

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function compareBigInt(a: bigint, b: bigint) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

function toBigInt(value: string | bigint) {
    return typeof value === 'bigint' ? value : BigInt(value);
}

function percentBps(numerator: bigint, denominator: bigint) {
    if (denominator <= 0n) return 0;
    return Number((numerator * 10_000n) / denominator);
}

function toPercent(value: number) {
    return Number((value / 100).toFixed(2));
}

function formatPercent(value: number) {
    return `${toPercent(value).toFixed(2)}%`;
}

function listTop(values: string[], limit = 3) {
    return values.filter(Boolean).slice(0, limit);
}

function riskLevel(profile: VendorProfileLike | null, deltaFromLowestBps: number): 'low' | 'medium' | 'high' {
    if (!profile) return 'high';
    if (profile.slashedBids > 0 || profile.trustScore < 40 || profile.revealRate < 65) return 'high';
    if (profile.trustScore < 65 || profile.settlementReceipts === 0 || deltaFromLowestBps > 800) return 'medium';
    return 'low';
}

function recommendationLabel(score: number, risk: 'low' | 'medium' | 'high', isLowestPrice: boolean) {
    if (risk === 'high' && isLowestPrice) return 'Cheapest but risky';
    if (score >= 80) return 'Best overall pick';
    if (score >= 68) return 'Strong value';
    if (score >= 55) return 'Usable option';
    return 'Fallback only';
}

export function analyzeWinnerSelection(bids: DecisionBidInput[]): WinnerSelectionDecision {
    const revealed = bids
        .filter((bid) => bid.isRevealed !== false && bid.revealedAmount)
        .map((bid) => ({
            ...bid,
            revealedAmount: bid.revealedAmount as string,
            amount: toBigInt(bid.revealedAmount as string),
        }))
        .sort((left, right) => compareBigInt(left.amount, right.amount));

    if (revealed.length === 0) {
        return {
            rankedBids: [],
            recommendedBid: null,
            lowestBid: null,
            bidderCount: 0,
            averageTrustScore: 0,
            averageRevealRate: 0,
            profileCoverageRate: 0,
            priceSpreadPercent: 0,
            recommendedSummary: 'No revealed bids are available yet.',
            decisionReasons: [],
            procurementWarnings: [],
        };
    }

    const lowestAmount = revealed[0].amount;
    const highestAmount = revealed[revealed.length - 1].amount;
    const priceSpan = highestAmount - lowestAmount;
    const profileCount = revealed.filter((bid) => bid.vendorProfile).length;
    const averageTrustScore = Math.round(
        revealed.reduce((sum, bid) => sum + (bid.vendorProfile?.trustScore ?? 32), 0) / revealed.length,
    );
    const averageRevealRate = Math.round(
        revealed.reduce((sum, bid) => sum + (bid.vendorProfile?.revealRate ?? 55), 0) / revealed.length,
    );

    const rankedBids = revealed
        .map((bid, index) => {
            const profile = bid.vendorProfile ?? null;
            const trustScore = profile?.trustScore ?? 32;
            const revealRate = profile?.revealRate ?? 55;
            const deliveryEvidence = clamp(((profile?.wins ?? 0) * 18) + ((profile?.settlementReceipts ?? 0) * 22), 0, 100);
            const slashPenalty = clamp((profile?.slashedBids ?? 0) * 12, 0, 24);
            const priceScore =
                priceSpan === 0n ? 100 : 100 - Number(((bid.amount - lowestAmount) * 100n) / priceSpan);
            const deltaFromLowestBps = percentBps(bid.amount - lowestAmount, lowestAmount);
            const deltaFromLowestPercent = toPercent(deltaFromLowestBps);
            const computedRisk = riskLevel(profile, deltaFromLowestBps);
            const score = clamp(
                Math.round(
                    priceScore * 0.52 +
                        trustScore * 0.23 +
                        revealRate * 0.15 +
                        deliveryEvidence * 0.1 -
                        slashPenalty,
                ),
                0,
                100,
            );
            const strengths = listTop([
                index === 0 ? 'Lowest revealed price in this round' : '',
                deltaFromLowestBps > 0 && deltaFromLowestBps <= 300 ? `Within ${formatPercent(deltaFromLowestBps)} of the lowest offer` : '',
                trustScore >= 75 ? `${profile?.summaryLabel || 'Reliable supplier'} with strong indexed history` : '',
                revealRate >= 90 ? 'Consistently reveals committed bids on time' : '',
                (profile?.settlementReceipts ?? 0) >= 2 ? 'Has completed prior settlements on testnet' : '',
                (profile?.wins ?? 0) >= 2 ? 'Repeatedly selected in prior RFQs' : '',
            ]);
            const cautions = listTop([
                !profile ? 'No indexed supplier history yet' : '',
                deltaFromLowestBps > 800 ? `Costs ${formatPercent(deltaFromLowestBps)} more than the lowest bid` : '',
                profile && trustScore < 60 ? 'Indexed supplier history is still thin' : '',
                profile && revealRate < 80 ? `Reveal discipline is only ${revealRate}%` : '',
                profile && profile.settlementReceipts === 0 ? 'No indexed settlement receipts yet' : '',
                profile && profile.slashedBids > 0 ? `${profile.slashedBids} prior bid(s) were slashed` : '',
            ]);

            const rankedBid: RankedBidDecision = {
                id: bid.id,
                vendor: bid.vendor,
                revealedAmount: bid.revealedAmount,
                vendorProfile: profile,
                amountRank: index + 1,
                recommendationScore: score,
                riskLevel: computedRisk,
                recommendationLabel: recommendationLabel(score, computedRisk, index === 0),
                deltaFromLowestBps,
                deltaFromLowestPercent,
                deltaFromLowestLabel: index === 0 ? 'Lowest price' : `+${deltaFromLowestPercent.toFixed(2)}% vs lowest`,
                priceScore,
                trustScore,
                revealRate,
                settlementReceipts: profile?.settlementReceipts ?? 0,
                strengths,
                cautions,
                isRecommended: false,
                isLowestPrice: index === 0,
                isWinner: bid.isWinner,
            };

            return rankedBid;
        })
        .sort((left, right) => {
            if (right.recommendationScore !== left.recommendationScore) {
                return right.recommendationScore - left.recommendationScore;
            }
            return left.amountRank - right.amountRank;
        });

    const recommendedBid = rankedBids[0] ?? null;
    const lowestBid = rankedBids.find((bid) => bid.isLowestPrice) ?? null;

    for (const bid of rankedBids) {
        bid.isRecommended = recommendedBid?.id === bid.id;
    }

    const decisionReasons: string[] = [];
    if (recommendedBid) {
        if (recommendedBid.isLowestPrice) {
            decisionReasons.push('The recommended vendor is already the cheapest revealed bid, so cost and execution quality align.');
        } else {
            decisionReasons.push(
                `The recommended vendor is ${recommendedBid.deltaFromLowestPercent.toFixed(2)}% above the lowest bid but carries stronger execution evidence.`,
            );
        }
        decisionReasons.push(
            `Indexed supplier trust is ${recommendedBid.trustScore}/100 with a ${recommendedBid.revealRate}% reveal rate.`,
        );
        if (recommendedBid.settlementReceipts > 0) {
            decisionReasons.push(
                `This supplier has ${recommendedBid.settlementReceipts} indexed settlement receipt${recommendedBid.settlementReceipts === 1 ? '' : 's'}, which lowers delivery risk.`,
            );
        }
    }

    const procurementWarnings: string[] = [];
    if (revealed.length === 1) {
        procurementWarnings.push('Only one bid was revealed, so there is no competitive benchmark.');
    }
    if (profileCount < revealed.length) {
        procurementWarnings.push('Some revealed suppliers still have no indexed delivery history.');
    }
    if (rankedBids.some((bid) => bid.vendorProfile?.slashedBids)) {
        procurementWarnings.push('At least one revealed supplier has prior slash history.');
    }
    const priceSpreadPercent = lowestAmount > 0n ? toPercent(percentBps(highestAmount - lowestAmount, lowestAmount)) : 0;
    if (priceSpreadPercent < 2) {
        procurementWarnings.push('Price spread is narrow, so reliability matters more than pure price.');
    }

    const recommendedSummary = recommendedBid
        ? recommendedBid.isLowestPrice
            ? `${recommendedBid.vendor} is the cleanest pick because it is both the lowest price and the strongest overall supplier signal.`
            : `${recommendedBid.vendor} is not the cheapest offer, but it carries better execution signals than the lowest-price alternative.`
        : 'No recommendation is available yet.';

    return {
        rankedBids,
        recommendedBid,
        lowestBid,
        bidderCount: revealed.length,
        averageTrustScore,
        averageRevealRate,
        profileCoverageRate: Math.round((profileCount / revealed.length) * 100),
        priceSpreadPercent,
        recommendedSummary,
        decisionReasons,
        procurementWarnings,
    };
}

function countValue(value: string | number | null | undefined) {
    return Number(value ?? 0);
}

export function buildVendorOpportunitySnapshot(input: OpportunityInput): VendorOpportunitySnapshot {
    const buyerProfile = input.buyerProfile ?? null;
    const buyerTrustScore = buyerProfile?.trustScore ?? 30;
    const buyerCompletionRate = buyerProfile?.completionRate ?? 0;
    const bidCount = countValue(input.bidCount);
    const minBidCount = Math.max(1, countValue(input.minBidCount) || 1);
    const blocksRemaining = input.currentBlock === null ? null : Math.max(0, input.biddingDeadline - input.currentBlock);
    const settlementLabel =
        input.tokenType === TOKEN_TYPE.CREDITS
            ? 'Aleo credits settlement path with optional private invoice'
            : `${tokenLabel(input.tokenType)} private settlement ready`;

    const positives = listTop([
        buyerTrustScore >= 75 ? `${buyerProfile?.summaryLabel || 'Reliable buyer'} with strong indexed history` : '',
        buyerCompletionRate >= 70 ? `Buyer completion rate is ${buyerCompletionRate}%` : '',
        input.tokenType !== TOKEN_TYPE.CREDITS ? 'Private stablecoin settlement path is available' : 'Private settlement with Shield ALEO credit records is available',
        bidCount < minBidCount ? 'Bid floor has not been crowded yet' : '',
    ], 4);

    const cautions = listTop([
        !buyerProfile ? 'Buyer has no indexed procurement history yet' : '',
        buyerProfile && buyerTrustScore < 45 ? 'Buyer trust score is still low' : '',
        buyerProfile && buyerCompletionRate < 50 && buyerProfile.rfqsCreated > 0 ? 'Buyer completion history is mixed' : '',
        blocksRemaining !== null && blocksRemaining <= 20 ? 'Bid window is close to closing' : '',
        bidCount >= minBidCount * 2 ? 'Competition is already heated' : '',
    ], 4);

    let tone: VendorOpportunitySnapshot['tone'] = 'neutral';
    let summaryTitle = 'Opportunity needs judgment';
    let recommendation = 'Bid only if your pricing discipline is clear and you can manage a competitive round.';

    if (blocksRemaining !== null && blocksRemaining <= 8) {
        tone = 'danger';
        summaryTitle = 'Closing window';
        recommendation = 'Commit immediately if you already have pricing. The bid window is nearly closed.';
    } else if (buyerTrustScore >= 70 && buyerCompletionRate >= 60 && cautions.length <= 1) {
        tone = 'success';
        summaryTitle = 'High-confidence buyer';
        recommendation = 'This buyer has enough indexed history to justify serious participation on testnet.';
    } else if (buyerTrustScore < 45 || cautions.length >= 3) {
        tone = 'warning';
        summaryTitle = 'Thin buyer history';
        recommendation = 'Bid selectively. Protect your margin because buyer execution history is still limited.';
    }

    return {
        summaryTitle,
        recommendation,
        tone,
        buyerTrustScore,
        buyerCompletionRate,
        profileCoverageLabel: buyerProfile ? `${buyerProfile.rfqsCreated} indexed RFQs` : 'No history yet',
        competitionProgressLabel: `${bidCount}/${minBidCount} bids toward threshold`,
        blocksRemaining,
        settlementLabel,
        positives,
        cautions,
    };
}

export function buildProcurementPacketMarkdown({ rfq, events, milestones = [], decision }: PacketInput) {
    const lines: string[] = [
        '# SEALrfq Procurement Packet',
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        '## RFQ Summary',
        `- RFQ ID: ${rfq.id}`,
        `- Item: ${rfq.itemName || 'Unspecified item'}`,
        `- Status: ${STATUS_LABELS[rfq.status] || rfq.status}`,
        `- Pricing mode: ${pricingLabel(rfq.pricingMode)}`,
        `- Settlement token: ${tokenLabel(rfq.tokenType)}`,
        `- Buyer: ${rfq.buyer}`,
        `- Winner: ${rfq.winningVendor || 'Not selected'}`,
        `- Winning bid: ${rfq.winningBidAmount ? formatAmount(rfq.winningBidAmount, rfq.tokenType) : 'Not selected'}`,
        `- Winner accepted: ${rfq.winnerAccepted ? 'Yes' : 'No'}`,
        `- Private payment recorded: ${rfq.paid ? 'Yes' : 'No'}`,
        `- Bidding deadline: block ${rfq.biddingDeadline}`,
        `- Reveal deadline: block ${rfq.revealDeadline}`,
    ];

    if (rfq.description) {
        lines.push('', '## Description', rfq.description);
    }

    lines.push(
        '',
        '## Buyer Trust',
        `- Buyer trust: ${rfq.buyerProfile ? `${rfq.buyerProfile.trustScore}/100 (${rfq.buyerProfile.summaryLabel})` : 'No indexed history'}`,
        `- Buyer completion rate: ${rfq.buyerProfile ? `${rfq.buyerProfile.completionRate}%` : 'N/A'}`,
        `- Private settlements: ${rfq.buyerProfile ? rfq.buyerProfile.privateSettlements : 0}`,
    );

    lines.push(
        '',
        '## Decision Intelligence',
        `- Recommended vendor: ${decision.recommendedBid?.vendor || 'N/A'}`,
        `- Recommendation summary: ${decision.recommendedSummary}`,
        `- Bidder count: ${decision.bidderCount}`,
        `- Average supplier trust: ${decision.averageTrustScore}/100`,
        `- Average reveal rate: ${decision.averageRevealRate}%`,
        `- Price spread: ${decision.priceSpreadPercent.toFixed(2)}%`,
    );

    if (decision.decisionReasons.length) {
        lines.push('', '### Why');
        for (const reason of decision.decisionReasons) {
            lines.push(`- ${reason}`);
        }
    }

    if (decision.procurementWarnings.length) {
        lines.push('', '### Warnings');
        for (const warning of decision.procurementWarnings) {
            lines.push(`- ${warning}`);
        }
    }

    if (decision.rankedBids.length) {
        lines.push('', '## Ranked Suppliers');
        for (const bid of decision.rankedBids) {
            lines.push(
                `- ${bid.vendor}: ${formatAmount(bid.revealedAmount, rfq.tokenType)} | score ${bid.recommendationScore}/100 | ${bid.deltaFromLowestLabel} | risk ${bid.riskLevel}`,
            );
        }
    }

    if (milestones.length) {
        lines.push('', '## Delivery Assurance');
        for (const milestone of milestones) {
            lines.push(
                `- ${milestone.sequence}. ${milestone.title}: ${formatAmount(milestone.targetAmount, rfq.tokenType)} | ${milestone.status}${milestone.evidenceHash ? ` | evidence ${milestone.evidenceHash}` : ''}`,
            );
        }
    }

    if (events.length) {
        lines.push('', '## Audit Timeline');
        for (const event of events.slice(0, 25)) {
            lines.push(
                `- [${event.blockHeight}] ${event.eventType} via ${event.transition || 'unknown transition'} at ${new Date(event.processedAt).toISOString()} (${event.txId})`,
            );
        }
    }

    return lines.join('\n');
}
