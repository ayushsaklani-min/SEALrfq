'use client';

import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    DataGrid,
    DataPoint,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    TextInput,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { PRICING_MODE, randomField } from '@/lib/sealProtocol';
import { walletFirstTx } from '@/lib/walletTx';

type VickreyDetail = {
    auctionId?: string;
    rfqId?: string | null;
    creator?: string | null;
    bidCount?: string | null;
    revealedCount?: string | null;
    biddingDeadline?: number | null;
    revealDeadline?: number | null;
    lowestBid?: string | null;
    secondLowestBid?: string | null;
    finalWinner?: string | null;
    finalPrice?: string | null;
};

export default function VickreyDetailPage({ params }: { params: { auctionId: string } }) {
    const [auction, setAuction] = useState<VickreyDetail | null>(null);
    const [commitAmount, setCommitAmount] = useState('');
    const [commitStake, setCommitStake] = useState('');
    const [commitSalt, setCommitSalt] = useState(() => randomField());
    const [revealBidId, setRevealBidId] = useState('');
    const [revealAmount, setRevealAmount] = useState('');
    const [revealSalt, setRevealSalt] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await authenticatedFetch(`/api/auction/vickrey/${params.auctionId}`);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load Vickrey auction.');
                if (!cancelled) setAuction(payload.data);
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load Vickrey auction.');
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
    }, [params.auctionId]);

    const commitBid = async () => {
        setActing(true);
        setError(null);
        try {
            const body = { bidAmount: commitAmount, salt: commitSalt, stake: commitStake };
            const result = await walletFirstTx(
                `/api/auction/vickrey/${encodeURIComponent(params.auctionId)}/commit`,
                body,
                (prepareData, txHash) => ({ ...body, bidId: prepareData.bidId, txHash }),
            );
            if (result.data.bidId) {
                localStorage.setItem(
                    `vickrey_bid_${result.data.bidId}`,
                    JSON.stringify({ bidId: result.data.bidId, salt: commitSalt, amount: commitAmount }),
                );
                setRevealBidId(result.data.bidId);
                setRevealSalt(commitSalt);
                setRevealAmount(commitAmount);
            }
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to commit Vickrey bid.');
        } finally {
            setActing(false);
        }
    };

    const revealBid = async () => {
        setActing(true);
        setError(null);
        try {
            const body = { bidId: revealBidId, amount: revealAmount, salt: revealSalt };
            const result = await walletFirstTx(
                `/api/auction/vickrey/${encodeURIComponent(params.auctionId)}/reveal`,
                body,
                (_prepareData, txHash) => ({ ...body, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to reveal Vickrey bid.');
        } finally {
            setActing(false);
        }
    };

    const finalizeAuction = async () => {
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/auction/vickrey/${encodeURIComponent(params.auctionId)}/finalize`,
                {},
                (_prepareData, txHash) => ({ txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to finalize Vickrey auction.');
        } finally {
            setActing(false);
        }
    };

    const importIntoRfq = async () => {
        if (!auction?.rfqId || !auction.finalWinner || !auction.finalPrice) return;
        setActing(true);
        setError(null);
        try {
            const body = {
                auctionId: params.auctionId,
                winnerAddress: auction.finalWinner,
                price: auction.finalPrice,
                auctionType: PRICING_MODE.VICKREY,
            };
            const result = await walletFirstTx(
                `/api/rfq/${encodeURIComponent(auction.rfqId)}/import-auction`,
                body,
                (_prepareData, txHash) => ({ ...body, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to import auction result.');
        } finally {
            setActing(false);
        }
    };

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading auction">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching auction details.</div>
                </Panel>
            </PageShell>
        );
    }

    if (!auction) {
        return (
            <PageShell>
                <Notice tone="danger">{error || 'Auction not found.'}</Notice>
            </PageShell>
        );
    }

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title={`Vickrey ${params.auctionId}`}
                description="Commit sealed bids, reveal them, finalize the result, then import it into the linked RFQ."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                    <Panel title="Auction summary">
                        <DataGrid columns={2}>
                            <DataPoint label="RFQ id" value={auction.rfqId || '--'} />
                            <DataPoint label="Creator" value={auction.creator || '--'} />
                            <DataPoint label="Bid count" value={auction.bidCount || '0'} />
                            <DataPoint label="Revealed" value={auction.revealedCount || '0'} />
                            <DataPoint label="Lowest bid" value={auction.lowestBid || '--'} />
                            <DataPoint label="Second price" value={auction.secondLowestBid || '--'} />
                            <DataPoint label="Final winner" value={auction.finalWinner || '--'} />
                            <DataPoint label="Final price" value={auction.finalPrice || '--'} />
                        </DataGrid>
                    </Panel>

                    <Panel title="Participant actions">
                        <div className="space-y-5">
                            <div className="space-y-4">
                                <Field label="Commit amount">
                                    <TextInput value={commitAmount} onChange={(event) => setCommitAmount(event.target.value)} placeholder="Bid amount" />
                                </Field>
                                <Field label="Stake">
                                    <TextInput value={commitStake} onChange={(event) => setCommitStake(event.target.value)} placeholder="Stake amount" />
                                </Field>
                                <Field label="Salt">
                                    <TextInput value={commitSalt} onChange={(event) => setCommitSalt(event.target.value)} />
                                </Field>
                                <Button onClick={commitBid} isLoading={acting}>
                                    Commit bid
                                </Button>
                            </div>

                            <div className="space-y-4 border-t border-[hsl(var(--border))] pt-4">
                                <Field label="Bid id">
                                    <TextInput value={revealBidId} onChange={(event) => setRevealBidId(event.target.value)} placeholder="Bid id" />
                                </Field>
                                <Field label="Reveal amount">
                                    <TextInput value={revealAmount} onChange={(event) => setRevealAmount(event.target.value)} placeholder="Reveal amount" />
                                </Field>
                                <Field label="Reveal salt">
                                    <TextInput value={revealSalt} onChange={(event) => setRevealSalt(event.target.value)} placeholder="Reveal salt" />
                                </Field>
                                <Button variant="secondary" onClick={revealBid} isLoading={acting}>
                                    Reveal bid
                                </Button>
                            </div>
                        </div>
                    </Panel>
                </div>

                <div className="space-y-6">
                    <Panel title="Creator actions">
                        <ActionBar>
                            <Button onClick={finalizeAuction} isLoading={acting}>
                                Finalize auction
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={importIntoRfq}
                                isLoading={acting}
                                disabled={!auction.rfqId || !auction.finalWinner || !auction.finalPrice}
                            >
                                Import into RFQ
                            </Button>
                        </ActionBar>
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
