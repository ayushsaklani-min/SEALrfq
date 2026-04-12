'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CounterpartyProfileCard, type VendorProfileSummary } from '@/components/CounterpartyProfileCard';
import { TxStatusView } from '@/components/TxStatus';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    StatusChip,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/aleoClient';
import { analyzeWinnerSelection } from '@/lib/procurementIntelligence';
import { formatAmount, PRICING_MODE } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';
import { useProtocolStore } from '@/stores/protocolStore';

type RFQDetail = {
    id: string;
    itemName?: string | null;
    status: string;
    tokenType: number;
    pricingMode: number;
    revealDeadline: number;
};

type Bid = {
    id: string;
    vendor: string;
    isRevealed: boolean;
    revealedAmount?: string | null;
    isWinner?: boolean;
    vendorProfile?: VendorProfileSummary | null;
};

function riskVariant(risk: 'low' | 'medium' | 'high'): 'success' | 'warning' | 'destructive' {
    if (risk === 'low') return 'success';
    if (risk === 'medium') return 'warning';
    return 'destructive';
}

export default function SelectWinnerPage({ params }: { params: { id: string } }) {
    const addRecord = useProtocolStore((state) => state.addRecord);
    const setWorkflow = useProtocolStore((state) => state.setWorkflow);
    const [rfq, setRfq] = useState<RFQDetail | null>(null);
    const [bids, setBids] = useState<Bid[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const [rfqResponse, bidsResponse, blockHeight] = await Promise.all([
                    authenticatedFetch(`/api/rfq/${params.id}`),
                    authenticatedFetch(`/api/rfq/${params.id}/bids`),
                    fetchCurrentBlockHeight(),
                ]);

                const rfqPayload = await rfqResponse.json();
                const bidsPayload = await bidsResponse.json().catch(() => ({ data: [] }));
                if (!rfqResponse.ok) {
                    throw new Error(rfqPayload?.error?.message || 'Failed to load RFQ.');
                }

                if (!cancelled) {
                    setRfq(rfqPayload.data);
                    setBids((bidsPayload.data || []).filter((bid: Bid) => bid.isRevealed));
                    setCurrentBlock(blockHeight);
                }
            } catch (caught: any) {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load winner selection.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [params.id]);

    const decision = useMemo(() => analyzeWinnerSelection(bids), [bids]);

    const selectWinner = async (winningBidId: string) => {
        if (!rfq || acting) return;

        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/rfq/${encodeURIComponent(rfq.id)}/select-winner`,
                { winningBidId },
                (_prepareData, txHash) => ({ winningBidId, txHash }),
            );

            if (result.data.winner_certificate) {
                setWorkflow({ winnerCertificate: result.data.winner_certificate });
                addRecord({
                    id: result.data.winner_certificate.certificateId,
                    type: 'WinnerCertificate',
                    rfqId: rfq.id,
                    owner: result.data.winner_certificate.winnerAddress,
                    payload: result.data.winner_certificate,
                    createdAt: new Date().toISOString(),
                });
            }

            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to select winner.');
        } finally {
            setActing(false);
        }
    };

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading winner selection">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching revealed bids and RFQ state.</div>
                </Panel>
            </PageShell>
        );
    }

    if (!rfq) {
        return (
            <PageShell>
                <Notice tone="danger">{error || 'RFQ not found.'}</Notice>
            </PageShell>
        );
    }

    const canSelectWinner =
        rfq.pricingMode === PRICING_MODE.RFQ &&
        rfq.status === 'REVEAL' &&
        currentBlock !== null &&
        currentBlock >= rfq.revealDeadline &&
        bids.length > 0;
    const noRevealDeadlock =
        rfq.pricingMode === PRICING_MODE.RFQ &&
        rfq.status === 'OPEN' &&
        currentBlock !== null &&
        currentBlock >= rfq.revealDeadline &&
        bids.length === 0;

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="RFQ"
                eyebrowHref={`/buyer/rfqs/${encodeURIComponent(rfq.id)}`}
                title={`Select winner for ${rfq.itemName || rfq.id}`}
                description="Choose the winning revealed bid after the reveal deadline has passed."
                actions={
                    <ActionBar>
                        <StatusChip status={rfq.status} />
                        <TokenChip tokenType={rfq.tokenType} />
                    </ActionBar>
                }
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {noRevealDeadlock ? (
                <Notice tone="warning" title="No revealed bids">
                    The reveal deadline has passed, but no vendor revealed a bid. In the current `sealrfq_v18.aleo` contract, that leaves the RFQ
                    stuck in `OPEN`, so there is no winner to select here.
                </Notice>
            ) : !canSelectWinner ? (
                <Notice tone="warning" title="Winner selection unavailable">
                    Winner selection opens only after the reveal deadline while the RFQ is still in reveal status.
                </Notice>
            ) : null}

            {decision.recommendedBid ? (
                <Panel title="Decision console" subtitle="Ranks suppliers on procurement value, not just the lowest revealed price.">
                    <Notice tone={decision.recommendedBid.riskLevel === 'low' ? 'success' : 'warning'} title="Recommended supplier">
                        {decision.recommendedSummary}
                    </Notice>
                    <div className="mt-4">
                        <DataGrid columns={4}>
                            <DataPoint label="Recommended score" value={`${decision.recommendedBid.recommendationScore}/100`} />
                            <DataPoint
                                label="Lowest bid"
                                value={decision.lowestBid ? formatAmount(decision.lowestBid.revealedAmount, rfq.tokenType) : '--'}
                            />
                            <DataPoint label="Price spread" value={`${decision.priceSpreadPercent.toFixed(2)}%`} />
                            <DataPoint label="Profile coverage" value={`${decision.profileCoverageRate}%`} />
                        </DataGrid>
                    </div>
                    {decision.decisionReasons.length ? (
                        <div className="mt-4 space-y-2">
                            {decision.decisionReasons.map((reason) => (
                                <div key={reason} className="text-sm leading-6 text-white/70">
                                    • {reason}
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {decision.procurementWarnings.length ? (
                        <div className="mt-4 space-y-2 rounded-xl border border-amber-200/20 bg-amber-400/[0.06] p-4">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/70">Watchouts</div>
                            {decision.procurementWarnings.map((warning) => (
                                <div key={warning} className="text-sm leading-6 text-amber-50/90">
                                    • {warning}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </Panel>
            ) : null}

            <Panel title="Ranked supplier options">
                {decision.rankedBids.length === 0 ? (
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">No revealed bids are available yet.</div>
                ) : (
                    <div className="space-y-3">
                        {decision.rankedBids.map((bid) => (
                            <div key={bid.id} className="rounded-xl border border-white/12 bg-white/[0.05] p-4 transition hover:border-white/20">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant={bid.isRecommended ? 'success' : 'outline'}>
                                            {bid.isRecommended ? 'Recommended' : `Price rank ${bid.amountRank}`}
                                        </Badge>
                                        <Badge variant={riskVariant(bid.riskLevel)}>{bid.riskLevel} risk</Badge>
                                        <Badge variant="secondary">{bid.recommendationLabel}</Badge>
                                    </div>
                                    <div className="text-sm font-semibold text-white">{bid.recommendationScore}/100 decision score</div>
                                </div>
                                <DataGrid columns={4}>
                                    <DataPoint
                                        label="Vendor"
                                        value={<CopyableText value={bid.vendor} displayValue={truncateMiddle(bid.vendor, 14, 10)} />}
                                    />
                                    <DataPoint
                                        label="Bid id"
                                        value={<CopyableText value={bid.id} displayValue={truncateMiddle(bid.id, 14, 8)} />}
                                    />
                                    <DataPoint label="Amount" value={formatAmount(bid.revealedAmount, rfq.tokenType)} />
                                    <DataPoint label="Price position" value={bid.deltaFromLowestLabel} />
                                </DataGrid>
                                <div className="mt-3">
                                    <CounterpartyProfileCard title="Vendor scorecard" profile={bid.vendorProfile} compact />
                                </div>
                                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                                    <div className="rounded-xl border border-emerald-200/20 bg-emerald-400/[0.06] p-4">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/70">Why this bid works</div>
                                        <div className="mt-2 space-y-2 text-sm leading-6 text-emerald-50/90">
                                            {bid.strengths.length ? bid.strengths.map((item) => <div key={item}>• {item}</div>) : <div>• Competes mainly on price.</div>}
                                        </div>
                                    </div>
                                    <div className="rounded-xl border border-amber-200/20 bg-amber-400/[0.06] p-4">
                                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/70">What to check</div>
                                        <div className="mt-2 space-y-2 text-sm leading-6 text-amber-50/90">
                                            {bid.cautions.length ? bid.cautions.map((item) => <div key={item}>• {item}</div>) : <div>• No major indexed execution concerns.</div>}
                                        </div>
                                    </div>
                                </div>
                                <ActionBar className="mt-4">
                                    <Button disabled={!canSelectWinner || acting} isLoading={acting} onClick={() => selectWinner(bid.id)}>
                                        Select winner
                                    </Button>
                                </ActionBar>
                            </div>
                        ))}
                    </div>
                )}
            </Panel>

            <ActionBar>
                <Link href={`/buyer/rfqs/${encodeURIComponent(rfq.id)}`}>
                    <Button variant="secondary">Back to RFQ</Button>
                </Link>
                {rfq.status === 'WINNER_SELECTED' ? (
                    <Link href={`/buyer/rfqs/${encodeURIComponent(rfq.id)}/fund-escrow`}>
                        <Button>Continue to fund escrow</Button>
                    </Link>
                ) : null}
            </ActionBar>

            {txKey ? (
                <Panel title="Latest transaction">
                    <TxStatusView idempotencyKey={txKey} compact={true} />
                </Panel>
            ) : null}
        </PageShell>
    );
}
