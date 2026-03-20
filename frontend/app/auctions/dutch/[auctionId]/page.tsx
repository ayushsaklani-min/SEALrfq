'use client';

import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    DataGrid,
    DataPoint,
    InfoList,
    InfoRow,
    Notice,
    PageHeader,
    PageShell,
    Panel,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { PRICING_MODE } from '@/lib/sealProtocol';
import { walletFirstTx } from '@/lib/walletTx';

type DutchDetail = {
    auctionId?: string;
    rfqId?: string | null;
    creator?: string | null;
    currentBlock?: number | null;
    currentPrice?: string | null;
    startPrice?: string | null;
    reservePrice?: string | null;
    priceDecrement?: string | null;
    startBlock?: number | null;
    endBlock?: number | null;
    finalWinner?: string | null;
    finalPrice?: string | null;
};

export default function DutchDetailPage({ params }: { params: { auctionId: string } }) {
    const [auction, setAuction] = useState<DutchDetail | null>(null);
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await authenticatedFetch(`/api/auction/dutch/${params.auctionId}`);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load Dutch auction.');
                if (!cancelled) setAuction(payload.data);
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load Dutch auction.');
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

    const acceptPrice = async () => {
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/auction/dutch/${encodeURIComponent(params.auctionId)}/accept-price`,
                {},
                (_prepareData, txHash) => ({ txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to accept the current price.');
        } finally {
            setActing(false);
        }
    };

    const expireAuction = async () => {
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/auction/dutch/${encodeURIComponent(params.auctionId)}/expire`,
                {},
                (_prepareData, txHash) => ({ txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to expire auction.');
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
                auctionType: PRICING_MODE.DUTCH,
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
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching Dutch auction details.</div>
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

    const beforeStart =
        typeof auction.currentBlock === 'number' &&
        typeof auction.startBlock === 'number' &&
        auction.currentBlock < auction.startBlock;
    const afterEnd =
        typeof auction.currentBlock === 'number' &&
        typeof auction.endBlock === 'number' &&
        auction.currentBlock > auction.endBlock;
    const accepted = Boolean(auction.finalWinner);

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title={`Dutch ${params.auctionId}`}
                description="Track the live price, take it in one transaction, then import the result into the linked RFQ."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {accepted ? (
                <Notice tone="success" title="Auction accepted">
                    The auction has a final winner and price. The creator can now import the result into the RFQ.
                </Notice>
            ) : beforeStart ? (
                <Notice title="Auction not started">The price ticker is waiting for the configured start block.</Notice>
            ) : afterEnd ? (
                <Notice tone="warning" title="Auction window ended">
                    If no one accepted before the end block, the creator can expire the auction.
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                    <Panel title="Auction summary">
                        <DataGrid columns={2}>
                            <DataPoint label="RFQ id" value={auction.rfqId || '--'} />
                            <DataPoint label="Creator" value={auction.creator || '--'} />
                            <DataPoint label="Current block" value={auction.currentBlock ?? '--'} />
                            <DataPoint label="Live price" value={auction.currentPrice || '--'} />
                            <DataPoint label="Start price" value={auction.startPrice || '--'} />
                            <DataPoint label="Floor price" value={auction.reservePrice || '--'} />
                            <DataPoint label="Starts at" value={auction.startBlock ?? '--'} />
                            <DataPoint label="Ends at" value={auction.endBlock ?? '--'} />
                            <DataPoint label="Final winner" value={auction.finalWinner || '--'} />
                            <DataPoint label="Final price" value={auction.finalPrice || '--'} />
                        </DataGrid>
                    </Panel>

                    <Panel title="Participant actions" subtitle="Take the current live price with one on-chain transaction.">
                        <ActionBar>
                            <Button onClick={acceptPrice} isLoading={acting} disabled={accepted || beforeStart || afterEnd}>
                                Accept current price
                            </Button>
                        </ActionBar>
                    </Panel>
                </div>

                <div className="space-y-6">
                    <Panel title="Creator actions">
                        <InfoList>
                            <InfoRow label="Linked RFQ" value={auction.rfqId || '--'} />
                            <InfoRow label="Ready to import" value={auction.rfqId && auction.finalWinner && auction.finalPrice ? 'Yes' : 'Not yet'} />
                            <InfoRow
                                label="Next step"
                                value={
                                    accepted
                                        ? 'Import result into RFQ'
                                        : beforeStart
                                          ? 'Wait for start block'
                                          : afterEnd
                                            ? 'Expire if no winner'
                                            : 'Wait for accept flow'
                                }
                            />
                        </InfoList>
                        <ActionBar className="mt-4">
                            <Button variant="secondary" onClick={expireAuction} isLoading={acting}>
                                Expire auction
                            </Button>
                            <Button
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
