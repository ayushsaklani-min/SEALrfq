'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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
    TextInput,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/aleoClient';
import { randomField } from '@/lib/sealProtocol';
import { walletFirstTx } from '@/lib/walletTx';
import { useProtocolStore } from '@/stores/protocolStore';

type DutchSummary = {
    auctionId?: string;
    rfqId?: string | null;
    currentPrice?: string | null;
    finalWinner?: string | null;
    finalPrice?: string | null;
    startBlock?: number | null;
    endBlock?: number | null;
};

export default function DutchAuctionsPage() {
    const { walletAddress } = useWallet();
    const saveAuctionSalt = useProtocolStore((state) => state.saveAuctionSalt);
    const [auctions, setAuctions] = useState<DutchSummary[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [rfqId, setRfqId] = useState('');
    const [startPrice, setStartPrice] = useState('');
    const [reservePrice, setReservePrice] = useState('');
    const [decrementPerBlock, setDecrementPerBlock] = useState('');
    const [startBlock, setStartBlock] = useState('');
    const [endBlock, setEndBlock] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [response, blockHeight] = await Promise.all([
                    authenticatedFetch('/api/auction/dutch'),
                    fetchCurrentBlockHeight(),
                ]);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load Dutch auctions.');
                if (!cancelled) {
                    setAuctions(payload.data || []);
                    setCurrentBlock(blockHeight);
                    if (blockHeight) {
                        setStartBlock(String(blockHeight + 20));
                        setEndBlock(String(blockHeight + 720));
                    }
                }
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load Dutch auctions.');
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
                startPrice,
                reservePrice,
                decrementPerBlock,
                startBlock: Number(startBlock),
                endBlock: Number(endBlock),
            };
            const result = await walletFirstTx('/api/auction/dutch', body, (_prepareData, txHash) => ({ ...body, txHash }));
            saveAuctionSalt(result.data.auctionId, salt);
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to create Dutch auction.');
        } finally {
            setActing(false);
        }
    };

    const wonCount = useMemo(() => auctions.filter((auction) => auction.finalWinner).length, [auctions]);
    const activeCount = useMemo(() => auctions.filter((auction) => !auction.finalWinner).length, [auctions]);

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title="SealDutch"
                description="Create a descending-price auction, let a participant take the live price, then import that result into an RFQ."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {!walletAddress ? (
                <Notice title="Wallet required">Connect a wallet to create a Dutch auction from this page.</Notice>
            ) : null}

            <DataGrid columns={3}>
                <DataPoint label="Auctions" value={auctions.length} />
                <DataPoint label="Live now" value={activeCount} />
                <DataPoint label="Accepted" value={wonCount} subtle={`Current block ${currentBlock ?? 'Unavailable'}`} />
            </DataGrid>

            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Panel title="Auction form" subtitle="Set the starting price, floor, and block range for the live price descent.">
                    <div className="space-y-4">
                        <Field label="Linked RFQ id" hint="Optional, but recommended if you plan to import the result later.">
                            <TextInput value={rfqId} onChange={(event) => setRfqId(event.target.value)} placeholder="123field" />
                        </Field>
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Starting price">
                                <TextInput value={startPrice} onChange={(event) => setStartPrice(event.target.value)} placeholder="5000000" />
                            </Field>
                            <Field label="Floor price">
                                <TextInput value={reservePrice} onChange={(event) => setReservePrice(event.target.value)} placeholder="1000000" />
                            </Field>
                        </div>
                        <Field label="Price drop per block" hint="The live price steps down by this amount every block after the start block.">
                            <TextInput
                                value={decrementPerBlock}
                                onChange={(event) => setDecrementPerBlock(event.target.value)}
                                placeholder="10000"
                            />
                        </Field>
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Starts at block">
                                <TextInput value={startBlock} onChange={(event) => setStartBlock(event.target.value)} />
                            </Field>
                            <Field label="Ends at block">
                                <TextInput value={endBlock} onChange={(event) => setEndBlock(event.target.value)} />
                            </Field>
                        </div>
                        <ActionBar>
                            <Button onClick={createAuction} isLoading={acting} disabled={!walletAddress}>
                                Create Dutch auction
                            </Button>
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">
                                The auction id is derived from your wallet and a local salt.
                            </div>
                        </ActionBar>
                    </div>
                </Panel>

                <div className="space-y-6">
                    <Panel title="Recent auctions">
                        {loading ? (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">Loading auctions.</div>
                        ) : auctions.length === 0 ? (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">No Dutch auctions created from this UI yet.</div>
                        ) : (
                            <div className="space-y-3">
                                {auctions.map((auction) => (
                                    <Link
                                        key={auction.auctionId || `${auction.rfqId}:${auction.startBlock}`}
                                        href={`/auctions/dutch/${encodeURIComponent(auction.auctionId || '')}`}
                                        className="block rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4 transition hover:border-[hsl(var(--primary)/0.3)]"
                                    >
                                        <div className="text-sm font-medium text-white">{auction.auctionId || '--'}</div>
                                        <div className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                                            RFQ: {auction.rfqId || '--'} | Live price: {auction.currentPrice || '--'}
                                        </div>
                                        <div className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                                            {auction.finalWinner ? `Winner: ${auction.finalWinner}` : 'Waiting for a participant to accept'}
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </Panel>

                    <Panel title="How it works">
                        <InfoList>
                            <InfoRow label="Price movement" value="Starts high and steps down each block" />
                            <InfoRow label="Participant flow" value="Accept the current live price in one transaction" />
                            <InfoRow label="RFQ handoff" value="Import the accepted result into the linked RFQ" />
                        </InfoList>
                    </Panel>
                </div>
            </div>

            {txKey ? (
                <Panel title="Latest transaction">
                    <TxStatusView idempotencyKey={txKey} compact={true} />
                </Panel>
            ) : null}
        </PageShell>
    );
}
