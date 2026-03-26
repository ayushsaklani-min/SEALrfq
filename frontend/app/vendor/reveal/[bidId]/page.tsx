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
    TextAreaInput,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/aleoClient';
import { formatAmount, PRICING_MODE } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';

type BidDetail = {
    id: string;
    rfqId: string;
    vendor: string;
    commitmentHash: string;
    stake: string;
    isRevealed: boolean;
};

type RfqDetail = {
    id: string;
    status: string;
    tokenType: number;
    pricingMode: number;
    biddingDeadline: number;
    revealDeadline: number;
};

function toMicroUnits(value: string): string | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return String(Math.round(numeric * 1_000_000));
}

function fromMicroUnits(value?: string | null) {
    if (!value) return '';
    return (Number(value) / 1_000_000).toString();
}

export default function RevealBidPage({ params }: { params: { bidId: string } }) {
    const [bid, setBid] = useState<BidDetail | null>(null);
    const [rfq, setRfq] = useState<RfqDetail | null>(null);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [amountInput, setAmountInput] = useState('');
    const [nonce, setNonce] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const bidResponse = await authenticatedFetch(`/api/bid/${params.bidId}`);
                const bidPayload = await bidResponse.json();
                if (!bidResponse.ok) throw new Error(bidPayload?.error?.message || 'Failed to load bid.');

                const [rfqResponse, blockHeight] = await Promise.all([
                    authenticatedFetch(`/api/rfq/${bidPayload.data.rfqId}`),
                    fetchCurrentBlockHeight(),
                ]);
                const rfqPayload = await rfqResponse.json();
                if (!rfqResponse.ok) throw new Error(rfqPayload?.error?.message || 'Failed to load RFQ.');

                const savedBundle = localStorage.getItem(`bid_nonce_${params.bidId}`);
                if (!cancelled) {
                    setBid(bidPayload.data);
                    setRfq(rfqPayload.data);
                    setCurrentBlock(blockHeight);
                    if (savedBundle) {
                        try {
                            const parsed = JSON.parse(savedBundle);
                            setNonce(parsed.nonce || '');
                            setAmountInput(fromMicroUnits(parsed.bidAmount));
                        } catch {
                            // Ignore malformed local bundle and let the user enter values manually.
                        }
                    }
                }
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load reveal form.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [params.bidId]);

    const revealBid = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!bid || !rfq || submitting) return;

        setSubmitting(true);
        setError(null);
        try {
            if (rfq.pricingMode !== PRICING_MODE.RFQ) {
                throw new Error('Reveal is disabled for imported auction pricing modes.');
            }
            if (currentBlock !== null && currentBlock < rfq.biddingDeadline) {
                throw new Error('Reveal opens after the bidding deadline. The first reveal auto-transitions the RFQ into reveal phase.');
            }
            if (currentBlock !== null && currentBlock >= rfq.revealDeadline) {
                throw new Error('Reveal deadline has passed.');
            }

            const bidAmount = toMicroUnits(amountInput);
            if (!bidAmount) throw new Error('Enter the exact original bid amount.');
            if (!nonce.trim()) throw new Error('Nonce is required.');

            const result = await walletFirstTx(
                `/api/bid/${encodeURIComponent(bid.id)}/reveal`,
                { bidAmount, nonce },
                (_prepareData, txHash) => ({ bidAmount, nonce, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to reveal bid.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading reveal form">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">
                        Fetching bid detail, RFQ status, and current block height.
                    </div>
                </Panel>
            </PageShell>
        );
    }

    if (!bid || !rfq) {
        return (
            <PageShell>
                <Notice tone="danger">{error || 'Bid not found.'}</Notice>
            </PageShell>
        );
    }

    if (bid.isRevealed) {
        return (
            <PageShell>
                <PageHeader eyebrow="Vendor" title="Bid already revealed" description="This bid has already been revealed on-chain." />
                <Link href="/vendor/my-bids" className="inline-flex text-sm font-medium text-[hsl(var(--primary))] hover:underline">
                    Return to my bids
                </Link>
            </PageShell>
        );
    }

    const revealOpen = currentBlock !== null && currentBlock >= rfq.biddingDeadline && currentBlock < rfq.revealDeadline;

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Vendor"
                title="Reveal bid"
                description="Enter the same amount and nonce used when you committed the bid. The first reveal can auto-open the RFQ reveal phase."
                actions={
                    <ActionBar>
                        <StatusChip status={rfq.status} />
                        <TokenChip tokenType={rfq.tokenType} />
                        <PricingChip pricingMode={rfq.pricingMode} />
                    </ActionBar>
                }
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {!revealOpen ? (
                <Notice title="Reveal window status">
                    {currentBlock !== null && currentBlock < rfq.biddingDeadline
                        ? 'Reveal is still locked until bidding closes.'
                        : 'Reveal is closed for this bid.'}
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-6">
                    <Panel title="Reveal form" subtitle="The amount and nonce must exactly match the values from your original commit.">
                        <form className="space-y-4" onSubmit={revealBid}>
                            <Field label="Original bid amount" hint="Enter the exact amount from the commit, in whole display units.">
                                <TextInput
                                    type="number"
                                    min="0.000001"
                                    step="0.000001"
                                    value={amountInput}
                                    onChange={(event) => setAmountInput(event.target.value)}
                                    placeholder="125"
                                />
                            </Field>
                            <Field label="Nonce" hint="This should match the nonce bundle saved at commit time.">
                                <TextAreaInput
                                    value={nonce}
                                    onChange={(event) => setNonce(event.target.value)}
                                    placeholder="Paste the nonce saved at bid commit time"
                                />
                            </Field>
                            <Button type="submit" disabled={!revealOpen || submitting} isLoading={submitting}>
                                Reveal bid
                            </Button>
                        </form>
                    </Panel>

                    {txKey ? (
                        <Panel title="Latest transaction">
                            <div className="space-y-4">
                                <TxStatusView idempotencyKey={txKey} compact={true} />
                                <Link href="/vendor/my-bids" className="inline-flex text-sm font-medium text-[hsl(var(--primary))] hover:underline">
                                    Return to my bids
                                </Link>
                            </div>
                        </Panel>
                    ) : null}
                </div>

                <div className="space-y-6">
                    <Panel title="Bid summary">
                        <DataGrid columns={2}>
                            <DataPoint label="Bid id" value={<CopyableText value={bid.id} displayValue={truncateMiddle(bid.id, 14, 8)} />} />
                            <DataPoint label="RFQ id" value={<CopyableText value={bid.rfqId} displayValue={truncateMiddle(bid.rfqId, 16, 10)} />} />
                            <DataPoint label="Stake" value={formatAmount(bid.stake, 0)} />
                            <DataPoint label="Vendor" value={<CopyableText value={bid.vendor} displayValue={truncateMiddle(bid.vendor, 14, 10)} />} />
                        </DataGrid>
                        <InfoList className="mt-4">
                            <InfoRow
                                label="Commitment hash"
                                value={<CopyableText value={bid.commitmentHash} displayValue={truncateMiddle(bid.commitmentHash, 18, 12)} breakAll={true} />}
                            />
                        </InfoList>
                    </Panel>

                    <Panel title="Deadlines">
                        <div className="space-y-3">
                            <DeadlineCountdown deadlineBlock={rfq.biddingDeadline} label="Bidding deadline" passedLabel="Bidding deadline reached" />
                            <DeadlineCountdown deadlineBlock={rfq.revealDeadline} label="Reveal deadline" passedLabel="Reveal deadline reached" />
                        </div>
                        <div className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
                            {revealOpen
                                ? 'Reveal is open now.'
                                : currentBlock !== null && currentBlock < rfq.biddingDeadline
                                  ? 'Reveal is still locked until bidding closes.'
                                  : 'Reveal deadline has passed.'}
                        </div>
                    </Panel>

                    <Panel title="Keep in mind">
                        <InfoList>
                            <InfoRow label="Exact match required" value="Wrong amount or nonce will fail the reveal check" />
                            <InfoRow label="Missing reveal" value="The creator may slash the stake during the slash window" />
                            <InfoRow label="Saved locally" value="The browser stores the nonce bundle, but keep an external copy too" />
                        </InfoList>
                    </Panel>
                </div>
            </div>
        </PageShell>
    );
}
