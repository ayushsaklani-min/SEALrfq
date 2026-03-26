'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import DeadlineCountdown from '@/components/DeadlineCountdown';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    Field,
    InfoList,
    InfoRow,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    PricingChip,
    StatusChip,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/aleoClient';
import { formatAmount, pricingLabel, PRICING_MODE, randomField, TIMING } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';

type RfqDetail = {
    id: string;
    itemName?: string | null;
    description?: string | null;
    quantity?: string | null;
    unit?: string | null;
    status: string;
    tokenType: number;
    pricingMode: number;
    minBid: string;
    flatStake?: string | null;
    biddingDeadline: number;
    revealDeadline: number;
    buyer: string;
};

type ExistingBid = {
    id: string;
    rfqId: string;
    isRevealed: boolean;
    revealedAmount?: string | null;
};

function toMicroUnits(value: string): string | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return String(Math.round(numeric * 1_000_000));
}

export default function VendorBidPage({ params }: { params: { rfqId: string } }) {
    const [rfq, setRfq] = useState<RfqDetail | null>(null);
    const [existingBid, setExistingBid] = useState<ExistingBid | null>(null);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [bidAmount, setBidAmount] = useState('');
    const [nonceBundle, setNonceBundle] = useState<{ bidId: string; nonce: string; bidAmount: string } | null>(null);
    const [txKey, setTxKey] = useState<string | null>(null);
    const [deadlineExtended, setDeadlineExtended] = useState(false);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [rfqResponse, blockHeight] = await Promise.all([
                    authenticatedFetch(`/api/rfq/${params.rfqId}`),
                    fetchCurrentBlockHeight(),
                ]);
                const payload = await rfqResponse.json();
                if (!rfqResponse.ok) {
                    throw new Error(payload?.error?.message || 'Failed to load RFQ.');
                }
                const bidsResponse = await authenticatedFetch('/api/bid/my-bids');
                const bidsPayload = await bidsResponse.json().catch(() => ({ data: [] }));
                if (!bidsResponse.ok) {
                    throw new Error(bidsPayload?.error?.message || 'Failed to load vendor bids.');
                }
                const matchedBid =
                    (bidsPayload.data || []).find((bid: ExistingBid) => bid.rfqId === params.rfqId) || null;
                if (!cancelled) {
                    setRfq(payload.data);
                    setExistingBid(matchedBid);
                    setCurrentBlock(blockHeight);
                    if (matchedBid?.id) {
                        const savedBundle = localStorage.getItem(`bid_nonce_${matchedBid.id}`);
                        if (savedBundle) {
                            try {
                                const parsed = JSON.parse(savedBundle);
                                setNonceBundle({
                                    bidId: parsed.bidId || matchedBid.id,
                                    nonce: parsed.nonce || '',
                                    bidAmount: parsed.bidAmount || '',
                                });
                            } catch {
                                // Ignore malformed local bundle.
                            }
                        }
                    }
                }
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load RFQ.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [params.rfqId]);

    const handleCommit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!rfq || submitting) return;

        setSubmitting(true);
        setError(null);
        setDeadlineExtended(false);

        try {
            if (rfq.status !== 'OPEN') throw new Error(`RFQ is ${rfq.status}.`);
            if (rfq.pricingMode !== PRICING_MODE.RFQ) throw new Error(`This RFQ uses ${pricingLabel(rfq.pricingMode)} pricing. Bid in the auction workspace instead.`);
            if (existingBid) throw new Error('You already committed a bid on this RFQ. Use the reveal flow instead of committing again.');

            const bidAmountMicro = toMicroUnits(bidAmount);
            if (!bidAmountMicro) throw new Error('Enter a valid bid amount.');
            if (BigInt(bidAmountMicro) < BigInt(rfq.minBid)) {
                throw new Error(`Bid must be at least ${formatAmount(rfq.minBid, rfq.tokenType)}.`);
            }

            const nonce = randomField();
            const stake = rfq.flatStake || '0';
            const originalBidding = rfq.biddingDeadline;
            const originalReveal = rfq.revealDeadline;

            const result = await walletFirstTx(
                '/api/bid/commit',
                {
                    rfqId: rfq.id,
                    bidAmount: bidAmountMicro,
                    nonce,
                    stake,
                },
                (prepareData, txHash) => ({
                    rfqId: rfq.id,
                    bidAmount: bidAmountMicro,
                    nonce,
                    stake,
                    bidId: prepareData.bid_id,
                    txHash,
                }),
            );

            const refreshed = await authenticatedFetch(`/api/rfq/${params.rfqId}`);
            const refreshedPayload = await refreshed.json().catch(() => null);
            if (refreshed.ok && refreshedPayload?.data) {
                setRfq(refreshedPayload.data);
                if (
                    refreshedPayload.data.biddingDeadline !== originalBidding ||
                    refreshedPayload.data.revealDeadline !== originalReveal
                ) {
                    setDeadlineExtended(true);
                }
            }

            localStorage.setItem(
                `bid_nonce_${result.data.bid_id}`,
                JSON.stringify({
                    bidId: result.data.bid_id,
                    rfqId: rfq.id,
                    nonce,
                    bidAmount: bidAmountMicro,
                    savedAt: new Date().toISOString(),
                }),
            );

            setNonceBundle({
                bidId: result.data.bid_id,
                nonce,
                bidAmount: bidAmountMicro,
            });
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to commit bid.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading RFQ">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching RFQ details.</div>
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

    const biddingOpen = currentBlock !== null && currentBlock < rfq.biddingDeadline;
    const revealOpen = currentBlock !== null && currentBlock >= rfq.biddingDeadline && currentBlock < rfq.revealDeadline;
    const urgentWindow = currentBlock !== null && rfq.biddingDeadline - currentBlock <= TIMING.SNIPE_WINDOW_BLOCKS;

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Vendor"
                title={rfq.itemName || 'Submit bid'}
                description="Enter the price, approve the wallet transaction, and keep the saved nonce for reveal."
                actions={
                    <ActionBar>
                        <StatusChip status={rfq.status} />
                        <TokenChip tokenType={rfq.tokenType} />
                        <PricingChip pricingMode={rfq.pricingMode} />
                    </ActionBar>
                }
            />

            {rfq.pricingMode !== PRICING_MODE.RFQ ? (
                <Notice tone="warning" title="Auction-backed RFQ">
                    This RFQ uses {pricingLabel(rfq.pricingMode)} pricing. Submit through the matching auction, not the RFQ bid flow.
                </Notice>
            ) : null}

            {deadlineExtended ? (
                <Notice title="Deadline extended">
                    A late bid triggered the anti-sniping rule, so both deadlines were extended by 40 blocks.
                </Notice>
            ) : null}

            {existingBid && !existingBid.isRevealed && revealOpen ? (
                <Notice title="Reveal is open">
                    Bidding is closed for this RFQ. Your committed bid can be revealed now.
                </Notice>
            ) : null}

            {existingBid && !existingBid.isRevealed && biddingOpen ? (
                <Notice title="Bid already committed">
                    You already committed a bid on this RFQ. Reveal opens once the bidding deadline passes.
                </Notice>
            ) : null}

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                    <Panel title="RFQ summary">
                        <DataGrid columns={2}>
                            <DataPoint label="RFQ id" value={<CopyableText value={rfq.id} displayValue={truncateMiddle(rfq.id, 16, 10)} />} />
                            <DataPoint label="Minimum bid" value={formatAmount(rfq.minBid, rfq.tokenType)} />
                            <DataPoint label="Required stake" value={formatAmount(rfq.flatStake || '0', 0)} />
                            <DataPoint
                                label="Buyer"
                                value={<CopyableText value={rfq.buyer} displayValue={truncateMiddle(rfq.buyer, 14, 10)} />}
                            />
                            <DataPoint label="Quantity" value={rfq.quantity ? `${rfq.quantity} ${rfq.unit || ''}`.trim() : '--'} />
                        </DataGrid>
                        {rfq.description ? (
                            <p className="mt-4 text-sm leading-6 text-white/60">{rfq.description}</p>
                        ) : null}
                    </Panel>

                    <Panel title="Commit bid" subtitle="Stake is fixed by the contract and cannot be edited.">
                        {rfq.pricingMode === PRICING_MODE.RFQ ? (
                            <form className="space-y-4" onSubmit={handleCommit}>
                                <Field label="Your sealed price" hint={`Must be at least ${formatAmount(rfq.minBid, rfq.tokenType)}.`}>
                                    <TextInput type="number" min="0.000001" step="0.000001" value={bidAmount} onChange={(event) => setBidAmount(event.target.value)} placeholder="125" />
                                </Field>
                                <Button type="submit" isLoading={submitting} disabled={rfq.status !== 'OPEN' || !biddingOpen || Boolean(existingBid)}>
                                    Commit bid
                                </Button>
                                {existingBid && !existingBid.isRevealed && revealOpen ? (
                                    <Link href={`/vendor/reveal/${encodeURIComponent(existingBid.id)}`}>
                                        <Button size="sm" variant="secondary" type="button">Open reveal</Button>
                                    </Link>
                                ) : null}
                            </form>
                        ) : (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">Direct bid commit is disabled on imported auction modes.</div>
                        )}
                    </Panel>
                </div>

                <div className="space-y-6">
                    <Panel title="Deadlines">
                        <div className="space-y-3">
                            <DeadlineCountdown deadlineBlock={rfq.biddingDeadline} label="Bid window" passedLabel="Bidding closed" />
                            <DeadlineCountdown deadlineBlock={rfq.revealDeadline} label="Reveal window" passedLabel="Reveal closed" />
                        </div>
                            <div className="mt-4 text-sm text-white/55">
                            {biddingOpen
                                ? 'Reveal is not open yet. It starts automatically after bidding closes.'
                                : revealOpen
                                  ? 'Reveal is open now for vendors who already committed a bid.'
                                  : 'The reveal deadline has passed.'}
                        </div>
                        {urgentWindow ? (
                            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
                                This RFQ is inside the anti-sniping window. A late bid may extend both deadlines.
                            </div>
                        ) : null}
                    </Panel>

                    {nonceBundle ? (
                        <Panel title="Saved for reveal">
                            <InfoList>
                                <InfoRow label="Bid id" value={<CopyableText value={nonceBundle.bidId} displayValue={truncateMiddle(nonceBundle.bidId, 14, 8)} />} />
                                <InfoRow label="Committed price" value={formatAmount(nonceBundle.bidAmount, rfq.tokenType)} />
                                <InfoRow label="Nonce" value={<CopyableText value={nonceBundle.nonce} displayValue={truncateMiddle(nonceBundle.nonce, 18, 10)} breakAll={true} />} />
                            </InfoList>
                            <ActionBar className="mt-4">
                                <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(nonceBundle.nonce)}>
                                    Copy nonce
                                </Button>
                                <Link href={`/vendor/reveal/${encodeURIComponent(nonceBundle.bidId)}`}>
                                    <Button size="sm">Open reveal</Button>
                                </Link>
                            </ActionBar>
                        </Panel>
                    ) : null}

                    {txKey ? (
                        <Panel title="Latest transaction">
                            <TxStatusView idempotencyKey={txKey} compact={true} />
                        </Panel>
                    ) : null}
                </div>
            </div>
        </PageShell>
    );
}
