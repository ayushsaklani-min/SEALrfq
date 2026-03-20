'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import DeadlineCountdown from '@/components/DeadlineCountdown';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
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
import { formatAmount, PRICING_MODE, pricingLabel, TIMING } from '@/lib/sealProtocol';
import { walletFirstTx } from '@/lib/walletTx';
import { useProtocolStore } from '@/stores/protocolStore';

type RFQDetail = {
    id: string;
    buyer: string;
    creator?: string;
    itemName?: string | null;
    description?: string | null;
    quantity?: string | null;
    unit?: string | null;
    status: string;
    tokenType: number;
    pricingMode: number;
    minBid: string;
    biddingDeadline: number;
    revealDeadline: number;
    minBidCount?: string | null;
    bidCount?: string | null;
    flatStake?: string | null;
    lifecycleBlock?: number | null;
    paid?: boolean;
    feeBps?: number;
    auctionSource?: string | null;
    winningBidId?: string | null;
    winningVendor?: string | null;
    winningBidAmount?: string | null;
    winningStake?: string | null;
    winnerAccepted?: boolean;
    platformPaused?: boolean;
};

type Bid = {
    id: string;
    vendor: string;
    isRevealed: boolean;
    isWinner?: boolean;
    revealedAmount?: string | null;
    stake: string;
    isRefunded?: boolean;
    isSlashed?: boolean;
};

type ImportForm = {
    auctionId: string;
    winnerAddress: string;
    price: string;
};

function parseCount(value?: string | null) {
    return Number(value || '0');
}

function resolveCancelMode(rfq: RFQDetail, currentBlock: number | null) {
    if (currentBlock === null) return null;
    if (rfq.status === 'OPEN' && currentBlock < rfq.biddingDeadline) {
        return { label: 'Cancel before bidding closes', mode: 3 };
    }
    if (rfq.status === 'OPEN' && currentBlock >= rfq.biddingDeadline && parseCount(rfq.bidCount) < parseCount(rfq.minBidCount)) {
        return { label: 'Cancel for too few bids', mode: 0 };
    }
    if (rfq.status === 'REVEAL' && currentBlock > rfq.revealDeadline + TIMING.SLASH_WINDOW) {
        return { label: 'Cancel for stuck reveal', mode: 1 };
    }
    if (rfq.status === 'WINNER_SELECTED' && rfq.lifecycleBlock && currentBlock > rfq.lifecycleBlock + TIMING.ESCROW_TIMEOUT_BLOCKS) {
        return { label: 'Cancel for missing escrow', mode: 2 };
    }
    return null;
}

export default function BuyerRfqDetailPage({ params }: { params: { id: string } }) {
    const addRecord = useProtocolStore((state) => state.addRecord);
    const setWorkflow = useProtocolStore((state) => state.setWorkflow);
    const [rfq, setRfq] = useState<RFQDetail | null>(null);
    const [bids, setBids] = useState<Bid[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [importForm, setImportForm] = useState<ImportForm>({ auctionId: '', winnerAddress: '', price: '' });
    const [fundAmount, setFundAmount] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionBusy, setActionBusy] = useState(false);

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
                    setBids(bidsPayload.data || []);
                    setCurrentBlock(blockHeight);
                    setFundAmount(rfqPayload.data.winningBidAmount || '');
                }
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load RFQ.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        const intervalId = window.setInterval(load, 15000);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [params.id]);

    const selectWinner = async (winningBidId: string) => {
        if (!rfq || actionBusy) return;
        setActionBusy(true);
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
            setActionBusy(false);
        }
    };

    const fundEscrow = async () => {
        if (!rfq || actionBusy) return;
        setActionBusy(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/rfq/${encodeURIComponent(rfq.id)}/fund-escrow`,
                { amount: fundAmount },
                (_prepareData, txHash) => ({ amount: fundAmount, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to fund escrow.');
        } finally {
            setActionBusy(false);
        }
    };

    const importAuctionResult = async () => {
        if (!rfq || actionBusy) return;
        setActionBusy(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/rfq/${encodeURIComponent(rfq.id)}/import-auction`,
                {
                    auctionId: importForm.auctionId,
                    winnerAddress: importForm.winnerAddress,
                    price: importForm.price,
                    auctionType: rfq.pricingMode,
                },
                (_prepareData, txHash) => ({
                    auctionId: importForm.auctionId,
                    winnerAddress: importForm.winnerAddress,
                    price: importForm.price,
                    auctionType: rfq.pricingMode,
                    txHash,
                }),
            );
            addRecord({
                id: `${rfq.id}:${importForm.auctionId}`,
                type: 'AuctionImported',
                rfqId: rfq.id,
                owner: rfq.buyer,
                payload: importForm,
                createdAt: new Date().toISOString(),
            });
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to import auction result.');
        } finally {
            setActionBusy(false);
        }
    };

    const cancelRfq = async () => {
        if (!rfq || actionBusy) return;
        setActionBusy(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/rfq/${encodeURIComponent(rfq.id)}/cancel`,
                {},
                (_prepareData, txHash) => ({ txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to cancel RFQ.');
        } finally {
            setActionBusy(false);
        }
    };

    const slashBid = async (bid: Bid) => {
        if (!rfq || actionBusy) return;
        setActionBusy(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/rfq/${encodeURIComponent(rfq.id)}/slash`,
                { bidId: bid.id, stake: bid.stake },
                (_prepareData, txHash) => ({ bidId: bid.id, stake: bid.stake, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to slash non-revealer.');
        } finally {
            setActionBusy(false);
        }
    };

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading RFQ">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching RFQ details and bids.</div>
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

    const cancelMode = resolveCancelMode(rfq, currentBlock);
    const slashWindowOpen =
        currentBlock !== null &&
        currentBlock > rfq.revealDeadline &&
        currentBlock <= rfq.revealDeadline + TIMING.SLASH_WINDOW &&
        (rfq.status === 'REVEAL' || rfq.status === 'WINNER_SELECTED');
    const canSelectWinner =
        rfq.pricingMode === PRICING_MODE.RFQ &&
        rfq.status === 'REVEAL' &&
        currentBlock !== null &&
        currentBlock >= rfq.revealDeadline;
    const canImportAuction =
        rfq.pricingMode !== PRICING_MODE.RFQ &&
        rfq.status === 'OPEN' &&
        !rfq.auctionSource &&
        parseCount(rfq.bidCount) === 0 &&
        currentBlock !== null &&
        currentBlock <= rfq.revealDeadline;
    const canFundEscrow = rfq.status === 'WINNER_SELECTED' && rfq.winnerAccepted && Boolean(rfq.winningBidAmount);
    const revealedCount = bids.filter((bid) => bid.isRevealed).length;

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Buyer"
                title={rfq.itemName || 'RFQ detail'}
                description={rfq.description || 'Manage bids, import auction results, and hand off into settlement.'}
                actions={
                    <ActionBar>
                        <StatusChip status={rfq.status} />
                        <TokenChip tokenType={rfq.tokenType} />
                        <PricingChip pricingMode={rfq.pricingMode} />
                    </ActionBar>
                }
            />

            {rfq.platformPaused ? (
                <Notice tone="warning" title="Platform paused">
                    Existing RFQs still work, but no new RFQs can be created.
                </Notice>
            ) : null}

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-6">
                    <Panel title="Summary">
                        <DataGrid columns={3}>
                            <DataPoint label="Minimum bid" value={formatAmount(rfq.minBid, rfq.tokenType)} />
                            <DataPoint label="Flat stake" value={rfq.flatStake ? formatAmount(rfq.flatStake, 0) : '--'} />
                            <DataPoint label="Bid count" value={`${rfq.bidCount ?? '0'} / ${rfq.minBidCount ?? '1'}`} />
                            <DataPoint label="Revealed bids" value={revealedCount} />
                            <DataPoint label="Winner" value={rfq.winningVendor || '--'} />
                            <DataPoint label="Winning amount" value={rfq.winningBidAmount ? formatAmount(rfq.winningBidAmount, rfq.tokenType) : '--'} />
                            <DataPoint label="Winner accepted" value={rfq.winnerAccepted ? 'Yes' : 'No'} />
                        </DataGrid>
                        <div className="mt-4 grid gap-3">
                            <DeadlineCountdown deadlineBlock={rfq.biddingDeadline} label="Bidding deadline" passedLabel="Bidding closed" />
                            <DeadlineCountdown deadlineBlock={rfq.revealDeadline} label="Reveal deadline" passedLabel="Reveal closed" />
                        </div>
                    </Panel>

                    <Panel
                        title="Next action"
                        subtitle={
                            canImportAuction
                                ? `This RFQ uses ${pricingLabel(rfq.pricingMode)} pricing, so the next step is to import the finalized auction result.`
                                : canFundEscrow
                                  ? 'The winner accepted. Fund the winning amount to start settlement.'
                                  : canSelectWinner
                                    ? 'Reveal has ended. Pick the winning revealed bid below.'
                                    : 'The next available action depends on the current contract state.'
                        }
                    >
                        {canImportAuction ? (
                            <div className="space-y-4">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <Field label="Auction id">
                                        <TextInput value={importForm.auctionId} onChange={(event) => setImportForm((current) => ({ ...current, auctionId: event.target.value }))} placeholder="123field" />
                                    </Field>
                                    <Field label="Winner address">
                                        <TextInput value={importForm.winnerAddress} onChange={(event) => setImportForm((current) => ({ ...current, winnerAddress: event.target.value }))} placeholder="aleo1..." />
                                    </Field>
                                </div>
                                <Field label="Final price" hint="Use the finalized auction price in micro-units.">
                                    <TextInput value={importForm.price} onChange={(event) => setImportForm((current) => ({ ...current, price: event.target.value }))} placeholder="125000000" />
                                </Field>
                                <Button onClick={importAuctionResult} isLoading={actionBusy}>
                                    Import auction result
                                </Button>
                            </div>
                        ) : canFundEscrow ? (
                            <div className="space-y-4">
                                <Field label="Escrow amount" hint="This should match the winning amount.">
                                    <TextInput value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} placeholder="Winning amount in micro-units" />
                                </Field>
                                <Button onClick={fundEscrow} isLoading={actionBusy}>
                                    Fund escrow
                                </Button>
                            </div>
                        ) : canSelectWinner ? (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">
                                Choose the winner from the revealed bids list below.
                            </div>
                        ) : (
                            <InfoList>
                                <InfoRow label="Current status" value={rfq.status} />
                                <InfoRow label="Price source" value={pricingLabel(rfq.pricingMode)} />
                                <InfoRow label="Settlement" value={rfq.paid ? 'Private payment recorded' : 'No private payment yet'} />
                            </InfoList>
                        )}
                    </Panel>

                    <Panel title="Bids">
                        {bids.length === 0 ? (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">No bids yet.</div>
                        ) : (
                            <div className="space-y-3">
                                {bids.map((bid) => (
                                    <div key={bid.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-white">{bid.vendor}</div>
                                                <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{bid.id}</div>
                                            </div>
                                            <div className="text-sm text-[hsl(var(--muted-foreground))] lg:text-right">
                                                <div>{bid.isWinner ? 'Winner' : bid.isRevealed ? 'Revealed' : 'Committed only'}</div>
                                                <div>Stake: {formatAmount(bid.stake, 0)}</div>
                                                <div>Bid: {bid.revealedAmount ? formatAmount(bid.revealedAmount, rfq.tokenType) : '--'}</div>
                                            </div>
                                        </div>
                                        <ActionBar className="mt-3">
                                            {canSelectWinner && bid.isRevealed ? (
                                                <Button size="sm" onClick={() => selectWinner(bid.id)} isLoading={actionBusy}>
                                                    Select winner
                                                </Button>
                                            ) : null}
                                            {slashWindowOpen && !bid.isRevealed ? (
                                                <Button size="sm" variant="danger" onClick={() => slashBid(bid)} isLoading={actionBusy}>
                                                    Slash non-revealer
                                                </Button>
                                            ) : null}
                                        </ActionBar>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>
                </div>

                <div className="space-y-6">
                    <Panel title="Winning bid">
                        <InfoList>
                            <InfoRow label="Winning bid id" value={rfq.winningBidId || '--'} />
                            <InfoRow label="Vendor" value={rfq.winningVendor || '--'} />
                            <InfoRow label="Amount" value={rfq.winningBidAmount ? formatAmount(rfq.winningBidAmount, rfq.tokenType) : '--'} />
                            <InfoRow label="Accepted" value={rfq.winnerAccepted ? 'Yes' : 'No'} />
                            <InfoRow label="Private payment" value={rfq.paid ? 'Yes' : 'No'} />
                        </InfoList>
                        <ActionBar className="mt-4">
                            <Link href={`/escrow/${encodeURIComponent(rfq.id)}`}>
                                <Button variant="secondary">Open escrow</Button>
                            </Link>
                        </ActionBar>
                    </Panel>

                    <Panel title="Lifecycle controls">
                        {canSelectWinner ? (
                            <Notice title="Winner selection is open">Reveal is complete. The lowest valid revealed bid can now be selected.</Notice>
                        ) : null}
                        {slashWindowOpen ? (
                            <Notice tone="warning" title="Slash window open">
                                Slash unrevealed bids before block {rfq.revealDeadline + TIMING.SLASH_WINDOW}.
                            </Notice>
                        ) : null}
                        {cancelMode ? (
                            <div className="space-y-3">
                                <div className="text-sm text-[hsl(var(--muted-foreground))]">Available cancel path: <span className="font-medium text-white">{cancelMode.label}</span></div>
                                <Button variant="danger" onClick={cancelRfq} isLoading={actionBusy}>
                                    Cancel RFQ
                                </Button>
                            </div>
                        ) : (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">No cancel path is available right now.</div>
                        )}
                    </Panel>

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
