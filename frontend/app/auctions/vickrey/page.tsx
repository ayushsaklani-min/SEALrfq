'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    DataGrid,
    DataPoint,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    TextInput,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/aleoClient';
import { randomField } from '@/lib/sealProtocol';
import { walletFirstTx } from '@/lib/walletTx';
import { useProtocolStore } from '@/stores/protocolStore';

type AuctionSummary = {
    auctionId?: string;
    rfqId?: string | null;
    statusCode: number;
    creator?: string | null;
    bidCount?: string | null;
    revealedCount?: string | null;
    biddingDeadline?: number | null;
    revealDeadline?: number | null;
    finalWinner?: string | null;
    finalPrice?: string | null;
};

export default function VickreyAuctionsPage() {
    const { walletAddress } = useWallet();
    const saveAuctionSalt = useProtocolStore((state) => state.saveAuctionSalt);
    const [auctions, setAuctions] = useState<AuctionSummary[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [rfqId, setRfqId] = useState('');
    const [biddingDeadline, setBiddingDeadline] = useState('');
    const [revealDeadline, setRevealDeadline] = useState('');
    const [minBid, setMinBid] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [response, blockHeight] = await Promise.all([
                    authenticatedFetch('/api/auction/vickrey'),
                    fetchCurrentBlockHeight(),
                ]);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load Vickrey auctions.');
                if (!cancelled) {
                    setAuctions(payload.data || []);
                    setCurrentBlock(blockHeight);
                    if (blockHeight) {
                        setBiddingDeadline(String(blockHeight + 360));
                        setRevealDeadline(String(blockHeight + 1080));
                    }
                }
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load Vickrey auctions.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const createAuction = async () => {
        if (acting || !walletAddress) return;
        setActing(true);
        setError(null);
        try {
            const salt = randomField();
            const body = {
                salt,
                rfqId,
                biddingDeadline: Number(biddingDeadline),
                revealDeadline: Number(revealDeadline),
                minBid,
            };
            const result = await walletFirstTx('/api/auction/vickrey', body, (_prepareData, txHash) => ({ ...body, txHash }));
            saveAuctionSalt(result.data.auctionId, salt);
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to create Vickrey auction.');
        } finally {
            setActing(false);
        }
    };

    const finalizedCount = useMemo(() => auctions.filter((auction) => auction.finalWinner && auction.finalPrice).length, [auctions]);

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title="SealVickrey"
                description="Create sealed second-price auctions and import the finalized result into an RFQ."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <DataGrid columns={3}>
                <DataPoint label="Auctions" value={auctions.length} />
                <DataPoint label="Finalized" value={finalizedCount} />
                <DataPoint label="Current block" value={currentBlock ?? 'Unavailable'} />
            </DataGrid>

            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Panel title="Create auction">
                    <div className="space-y-4">
                        <Field label="Linked RFQ id" hint="Optional, but recommended if the result will be imported later.">
                            <TextInput value={rfqId} onChange={(event) => setRfqId(event.target.value)} placeholder="123field" />
                        </Field>
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Bid close block">
                                <TextInput value={biddingDeadline} onChange={(event) => setBiddingDeadline(event.target.value)} />
                            </Field>
                            <Field label="Reveal close block">
                                <TextInput value={revealDeadline} onChange={(event) => setRevealDeadline(event.target.value)} />
                            </Field>
                        </div>
                        <Field label="Minimum bid" hint="Enter the raw micro-unit amount expected by the program.">
                            <TextInput value={minBid} onChange={(event) => setMinBid(event.target.value)} placeholder="1000000" />
                        </Field>
                        <Button onClick={createAuction} isLoading={acting} disabled={!walletAddress}>
                            Create Vickrey auction
                        </Button>
                    </div>
                </Panel>

                <Panel title="Recent auctions">
                    {loading ? (
                        <div className="text-sm text-[hsl(var(--muted-foreground))]">Loading auctions.</div>
                    ) : auctions.length === 0 ? (
                        <div className="text-sm text-[hsl(var(--muted-foreground))]">No auctions created from this UI yet.</div>
                    ) : (
                        <div className="space-y-3">
                            {auctions.map((auction) => (
                                <Link
                                    key={auction.auctionId || `${auction.rfqId}:${auction.creator}`}
                                    href={`/auctions/vickrey/${encodeURIComponent(auction.auctionId || '')}`}
                                    className="block rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4 transition hover:border-[hsl(var(--primary)/0.3)]"
                                >
                                    <div className="text-sm font-medium text-white">{auction.auctionId || '--'}</div>
                                    <div className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                                        RFQ: {auction.rfqId || '--'} · Bids: {auction.bidCount || '0'} · Revealed: {auction.revealedCount || '0'}
                                    </div>
                                    <div className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                                        {auction.finalWinner ? `Final price: ${auction.finalPrice}` : 'Waiting for finalization'}
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </Panel>
            </div>

            {txKey ? (
                <Panel title="Latest transaction">
                    <TxStatusView idempotencyKey={txKey} compact={true} />
                </Panel>
            ) : null}
        </PageShell>
    );
}
