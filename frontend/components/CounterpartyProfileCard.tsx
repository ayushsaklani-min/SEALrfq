'use client';

import { Badge } from '@/components/ui/Badge';
import { CopyableText, DataGrid, DataPoint } from '@/components/protocol/ProtocolPrimitives';
import { truncateMiddle } from '@/lib/utils';

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

type CounterpartyProfile = BuyerProfileSummary | VendorProfileSummary;

function scoreVariant(score: number): 'success' | 'warning' | 'outline' {
    if (score >= 75) return 'success';
    if (score >= 45) return 'warning';
    return 'outline';
}

export function CounterpartyProfileCard({
    title,
    profile,
    compact = false,
}: {
    title: string;
    profile: CounterpartyProfile | null | undefined;
    compact?: boolean;
}) {
    if (!profile) {
        return (
            <div className={`rounded-xl border border-white/12 bg-white/[0.04] ${compact ? 'p-3' : 'p-4'}`}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">{title}</div>
                <div className="mt-2 text-sm text-white/55">No indexed counterparty history yet.</div>
            </div>
        );
    }

    return (
        <div className={`rounded-xl border border-white/12 bg-white/[0.04] ${compact ? 'p-3' : 'p-4'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">{title}</div>
                    <div className="text-sm font-semibold text-white">{profile.summaryLabel}</div>
                </div>
                <Badge variant={scoreVariant(profile.trustScore)}>{profile.trustScore}/100 trust</Badge>
            </div>

            <div className="mt-3 max-w-fit">
                <CopyableText value={profile.wallet} displayValue={truncateMiddle(profile.wallet, 14, 10)} />
            </div>

            {profile.kind === 'buyer' ? (
                <div className="mt-3">
                    <DataGrid columns={3}>
                        <DataPoint label="RFQs" value={profile.rfqsCreated} />
                        <DataPoint label="Completion" value={`${profile.completionRate}%`} />
                        <DataPoint label="Private settles" value={profile.privateSettlements} />
                    </DataGrid>
                </div>
            ) : (
                <div className="mt-3">
                    <DataGrid columns={3}>
                        <DataPoint label="Bids" value={profile.bidsSubmitted} />
                        <DataPoint label="Reveal rate" value={`${profile.revealRate}%`} />
                        <DataPoint label="Wins" value={profile.wins} />
                    </DataGrid>
                </div>
            )}
        </div>
    );
}
