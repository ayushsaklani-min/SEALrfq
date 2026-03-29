'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    DisclosureCard,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    SelectInput,
    TextInput,
    TokenChip,
    WorkflowGuide,
    type WorkflowGuideStep,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/aleoClient';
import { blockEta, formatAmount, formatBlockTime, randomField, TIMING, tokenLabel, TOKEN_TYPE } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
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
    tokenType?: number | null;
    tokenSymbol?: string | null;
};

const FIELD_ID_PATTERN = /^\d+field$/;

function toMicroUnits(value: string): string {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return value;
    return String(Math.round(numeric * 1_000_000));
}

const BID_DURATIONS = [
    { label: '30 minutes', blocks: 360 },
    { label: '1 hour', blocks: 720 },
    { label: '2 hours', blocks: 1440 },
    { label: '4 hours', blocks: 2880 },
    { label: '8 hours', blocks: 5760 },
    { label: '1 day', blocks: 17280 },
    { label: 'Custom (blocks)', blocks: 0 },
];

const REVEAL_DURATIONS = [
    { label: '1 hour', blocks: 720 },
    { label: '2 hours', blocks: 1440 },
    { label: '4 hours', blocks: 2880 },
    { label: '8 hours', blocks: 5760 },
    { label: '1 day', blocks: 17280 },
    { label: 'Custom (blocks)', blocks: 0 },
];

export default function VickreyAuctionsPage() {
    const searchParams = useSearchParams();
    const { walletAddress } = useWallet();
    const saveAuctionSalt = useProtocolStore((state) => state.saveAuctionSalt);
    const linkedRfqId = searchParams.get('rfqId')?.trim() ?? '';
    const [auctions, setAuctions] = useState<AuctionSummary[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [rfqId, setRfqId] = useState(linkedRfqId);
    const [tokenType, setTokenType] = useState(String(TOKEN_TYPE.CREDITS));
    const [bidDurationBlocks, setBidDurationBlocks] = useState<number>(720);
    const [revealDurationBlocks, setRevealDurationBlocks] = useState<number>(TIMING.MIN_REVEAL_WINDOW);
    const [customBidBlocks, setCustomBidBlocks] = useState('720');
    const [customRevealBlocks, setCustomRevealBlocks] = useState(String(TIMING.MIN_REVEAL_WINDOW));
    const [minBid, setMinBid] = useState('');
    const [createdAuctionId, setCreatedAuctionId] = useState<string | null>(null);
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

    useEffect(() => {
        if (linkedRfqId) {
            setRfqId((current) => current || linkedRfqId);
        }
    }, [linkedRfqId]);

    const effectiveBidBlocks = bidDurationBlocks === 0 ? (Number(customBidBlocks) || 0) : bidDurationBlocks;
    const effectiveRevealBlocks = revealDurationBlocks === 0 ? (Number(customRevealBlocks) || 0) : revealDurationBlocks;
    const biddingDeadline = currentBlock ? currentBlock + effectiveBidBlocks : 0;
    const revealDeadline = biddingDeadline ? biddingDeadline + effectiveRevealBlocks : 0;
    const selectedTokenType = Number(tokenType);
    const returnToRfqHref = linkedRfqId ? `/buyer/rfqs/${encodeURIComponent(linkedRfqId)}` : null;
    const linkedAuctions = useMemo(
        () => (linkedRfqId ? auctions.filter((auction) => auction.rfqId === linkedRfqId) : []),
        [auctions, linkedRfqId],
    );
    const workflowSteps: WorkflowGuideStep[] = [
        {
            title: 'Create the linked auction',
            description: linkedRfqId
                ? 'The RFQ id is already prefilled. Create the auction from this page so vendors have a dedicated bidding workspace.'
                : 'Paste the RFQ id, then create the auction to open the sealed bidding workspace.',
            state: createdAuctionId ? 'complete' : ('current' as const),
        },
        {
            title: 'Vendors commit sealed bids',
            description: 'Share the auction detail page with vendors so they can commit hidden bids and save their bid id and salt.',
            state: createdAuctionId ? 'current' : ('upcoming' as const),
        },
        {
            title: 'Vendors reveal after bidding closes',
            description: 'Once the bidding deadline passes, vendors reveal the same bid id, amount, and salt they used during commit.',
            state: 'upcoming' as const,
        },
        {
            title: 'Finalize and import into the RFQ',
            description: 'After reveal is complete, finalize the auction and import the winner and final price back into the linked RFQ.',
            state: 'upcoming' as const,
        },
        {
            title: 'Finish winner response and escrow in RFQ',
            description: 'The imported winner still has to accept inside the RFQ before the buyer funds escrow and continues settlement.',
            state: 'upcoming' as const,
        },
    ];

    const createAuction = async () => {
        if (acting || !walletAddress) return;
        setActing(true);
        setError(null);
        try {
            const normalizedRfqId = rfqId.trim();
            if (!currentBlock) throw new Error('Could not fetch current block height. Check your connection.');
            if (!normalizedRfqId) throw new Error('Linked RFQ id is required. Paste the full RFQ id before creating the auction.');
            if (!FIELD_ID_PATTERN.test(normalizedRfqId)) {
                throw new Error('Linked RFQ id must be a full Aleo field such as 123field.');
            }
            if (!minBid.trim()) throw new Error('Enter a minimum bid amount.');
            if (effectiveBidBlocks < 60) throw new Error('Bidding window must be at least 5 minutes.');
            if (effectiveRevealBlocks < TIMING.MIN_REVEAL_WINDOW) {
                throw new Error(`Reveal window must be at least ${formatBlockTime(TIMING.MIN_REVEAL_WINDOW)}.`);
            }

            const salt = randomField();
            const body = {
                salt,
                rfqId: normalizedRfqId,
                tokenType: selectedTokenType,
                biddingDeadline,
                revealDeadline,
                minBid: toMicroUnits(minBid),
            };
            const result = await walletFirstTx('/api/auction/vickrey', body, (_prepareData, txHash) => ({ ...body, txHash }));
            saveAuctionSalt(result.data.auctionId, salt);
            setCreatedAuctionId(result.data.auctionId || null);
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
                title="Vickrey Auction"
                description="Sealed second-price auction. The current deployed contract supports linked RFQs and ALEO credits only."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {!walletAddress ? <Notice title="Wallet required">Connect a wallet to create a Vickrey auction.</Notice> : null}

            <DataGrid columns={3}>
                <DataPoint label="Auctions" value={auctions.length} />
                <DataPoint label="Finalized" value={finalizedCount} />
                <DataPoint label="Current block" value={currentBlock ?? 'Loading...'} />
            </DataGrid>

            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Panel title="Create auction">
                    <div className="space-y-4">
                        <Field label="Linked RFQ id" hint="Required. Paste the full RFQ id in 123field format. Its settlement token must match this auction token before import.">
                            <TextInput value={rfqId} onChange={(event) => setRfqId(event.target.value)} placeholder="123field" />
                        </Field>

                        <Field label="Settlement token">
                            <SelectInput value={tokenType} onChange={(event) => setTokenType(event.target.value)}>
                                <option value={TOKEN_TYPE.CREDITS}>ALEO credits</option>
                                <option value={TOKEN_TYPE.USDCX}>USDCx</option>
                                <option value={TOKEN_TYPE.USAD}>USAD</option>
                            </SelectInput>
                        </Field>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field
                                label="Bidding window"
                                hint={biddingDeadline > 0 ? `Closes at block ${biddingDeadline}` : 'How long for sealed bid submissions'}
                            >
                                <SelectInput value={bidDurationBlocks} onChange={(event) => setBidDurationBlocks(Number(event.target.value))}>
                                    {BID_DURATIONS.map((option) => (
                                        <option key={option.label} value={option.blocks}>
                                            {option.label}
                                        </option>
                                    ))}
                                </SelectInput>
                                {bidDurationBlocks === 0 ? (
                                    <TextInput
                                        className="mt-2"
                                        type="number"
                                        min="60"
                                        value={customBidBlocks}
                                        onChange={(event) => setCustomBidBlocks(event.target.value)}
                                        placeholder="720"
                                    />
                                ) : null}
                            </Field>
                            <Field
                                label="Reveal window"
                                hint={revealDeadline > 0 ? `Closes at block ${revealDeadline}` : 'Time after bidding to reveal bids'}
                            >
                                <SelectInput value={revealDurationBlocks} onChange={(event) => setRevealDurationBlocks(Number(event.target.value))}>
                                    {REVEAL_DURATIONS.map((option) => (
                                        <option key={option.label} value={option.blocks}>
                                            {option.label}
                                        </option>
                                    ))}
                                </SelectInput>
                                {revealDurationBlocks === 0 ? (
                                    <TextInput
                                        className="mt-2"
                                        type="number"
                                        min={TIMING.MIN_REVEAL_WINDOW}
                                        value={customRevealBlocks}
                                        onChange={(event) => setCustomRevealBlocks(event.target.value)}
                                        placeholder={String(TIMING.MIN_REVEAL_WINDOW)}
                                    />
                                ) : null}
                            </Field>
                        </div>

                        <Field label={`Minimum bid (${tokenLabel(selectedTokenType)})`} hint="Bids below this amount will be rejected.">
                            <TextInput type="number" min="0.000001" step="0.000001" value={minBid} onChange={(event) => setMinBid(event.target.value)} placeholder="1.0" />
                        </Field>

                        {currentBlock && effectiveBidBlocks > 0 && effectiveRevealBlocks > 0 ? (
                            <div className="space-y-1 rounded-xl border border-white/12 bg-white/[0.05] px-3 py-3 text-xs text-white/60">
                                <div>
                                    Bidding closes in <span className="font-medium text-white">~{formatBlockTime(effectiveBidBlocks)}</span>
                                </div>
                                <div>
                                    Reveals close <span className="font-medium text-white">~{formatBlockTime(effectiveRevealBlocks)}</span> after that
                                </div>
                            </div>
                        ) : null}

                        <Button onClick={createAuction} isLoading={acting} disabled={!walletAddress || !currentBlock}>
                            Create Vickrey auction
                        </Button>
                    </div>
                </Panel>

                <div className="space-y-6">
                    {linkedRfqId ? (
                        <Panel title="Linked RFQ" subtitle="You opened the auction workspace from an RFQ. Keep using this RFQ id for creation, import, and return navigation.">
                            <div className="space-y-4">
                                <div className="max-w-fit">
                                    <CopyableText value={linkedRfqId} displayValue={truncateMiddle(linkedRfqId, 16, 10)} />
                                </div>
                                {linkedAuctions.length > 0 ? (
                                    <div className="space-y-2">
                                        <div className="text-sm font-medium text-white/70">Existing linked auctions</div>
                                        {linkedAuctions.slice(0, 3).map((auction) => (
                                            <Link
                                                key={auction.auctionId || `${auction.rfqId}:${auction.creator}`}
                                                href={`/auctions/vickrey/${encodeURIComponent(auction.auctionId || '')}`}
                                                className="block rounded-xl border border-white/12 bg-white/[0.05] px-3 py-3 text-sm text-white/80 transition hover:border-white/20 hover:bg-white/[0.08]"
                                            >
                                                {auction.auctionId ? truncateMiddle(auction.auctionId, 16, 10) : 'Untitled auction'}
                                            </Link>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-sm text-white/55">No linked Vickrey auction is indexed for this RFQ yet.</div>
                                )}
                                {returnToRfqHref ? (
                                    <ActionBar>
                                        <Link href={returnToRfqHref}>
                                            <Button size="sm" variant="secondary">Back to RFQ</Button>
                                        </Link>
                                    </ActionBar>
                                ) : null}
                            </div>
                        </Panel>
                    ) : null}

                    <Panel title="Workflow guide" subtitle="Use this page as the handoff from RFQ creation into auction execution and back again.">
                        <WorkflowGuide steps={workflowSteps} />
                    </Panel>

                    <Panel title="Recent auctions" subtitle="Expand an auction to inspect linked RFQ details, bid progress, and the next action.">
                        {loading ? (
                            <div className="text-sm text-white/55">Loading auctions...</div>
                        ) : auctions.length === 0 ? (
                            <div className="text-sm text-white/55">No auctions created yet. Create one to get started.</div>
                        ) : (
                            <div className="space-y-3">
                                {auctions.map((auction, index) => (
                                    <DisclosureCard
                                        key={auction.auctionId || `${auction.rfqId}:${auction.creator}`}
                                        defaultOpen={index === 0}
                                        title={auction.auctionId ? truncateMiddle(auction.auctionId, 16, 10) : 'Untitled auction'}
                                        subtitle={
                                            auction.rfqId
                                                ? `Linked RFQ ${truncateMiddle(auction.rfqId, 14, 8)}`
                                                : 'No linked RFQ recorded yet'
                                        }
                                        trailing={
                                            <div className="flex flex-wrap items-center gap-2">
                                                <TokenChip tokenType={auction.tokenType} label={auction.tokenSymbol || undefined} />
                                                {auction.finalWinner ? (
                                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                                                        Finalized
                                                    </span>
                                                ) : (
                                                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                                        In progress
                                                    </span>
                                                )}
                                            </div>
                                        }
                                    >
                                        <div className="space-y-4">
                                            <DataGrid columns={2}>
                                                <DataPoint label="Bid count" value={auction.bidCount || '0'} />
                                                <DataPoint label="Revealed" value={auction.revealedCount || '0'} />
                                                <DataPoint label="Bid close" value={auction.biddingDeadline ? `Block ${auction.biddingDeadline}` : '--'} subtle={blockEta(auction.biddingDeadline, currentBlock)} />
                                                <DataPoint label="Reveal close" value={auction.revealDeadline ? `Block ${auction.revealDeadline}` : '--'} subtle={blockEta(auction.revealDeadline, currentBlock)} />
                                            </DataGrid>
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Auction id</div>
                                                    <div className="mt-2 max-w-fit">
                                                        {auction.auctionId ? (
                                                            <CopyableText value={auction.auctionId} displayValue={truncateMiddle(auction.auctionId, 16, 10)} />
                                                        ) : (
                                                            <span className="text-sm font-medium text-slate-950">--</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Linked RFQ</div>
                                                    <div className="mt-2 max-w-fit">
                                                        {auction.rfqId ? (
                                                            <CopyableText value={auction.rfqId} displayValue={truncateMiddle(auction.rfqId, 16, 10)} />
                                                        ) : (
                                                            <span className="text-sm font-medium text-slate-950">--</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
                                                {auction.finalWinner ? (
                                                    <span className="text-emerald-700">
                                                        Final price: {formatAmount(auction.finalPrice, auction.tokenType ?? TOKEN_TYPE.CREDITS)}
                                                    </span>
                                                ) : (
                                                    <span>Auction is still waiting for commits, reveals, and finalization.</span>
                                                )}
                                            </div>
                                            <ActionBar>
                                                {auction.auctionId ? (
                                                    <Link href={`/auctions/vickrey/${encodeURIComponent(auction.auctionId)}`}>
                                                        <Button size="sm">Open auction</Button>
                                                    </Link>
                                                ) : null}
                                                {auction.rfqId ? (
                                                    <Link href={`/buyer/rfqs/${encodeURIComponent(auction.rfqId)}`}>
                                                        <Button size="sm" variant="secondary">Open RFQ</Button>
                                                    </Link>
                                                ) : null}
                                            </ActionBar>
                                        </div>
                                    </DisclosureCard>
                                ))}
                            </div>
                        )}
                    </Panel>
                </div>
            </div>

            {txKey ? (
                <Panel title={createdAuctionId ? 'Auction created' : 'Transaction status'}>
                    <div className="space-y-4">
                        <TxStatusView idempotencyKey={txKey} compact={true} />
                        {createdAuctionId ? (
                            <>
                                <WorkflowGuide
                                    steps={[
                                        {
                                            title: 'Open the auction detail page',
                                            description: 'Use the auction detail page to monitor bids, reveals, and the finalization step.',
                                            state: 'current',
                                        },
                                        {
                                            title: 'Let vendors commit and reveal bids',
                                            description: 'Vendors need the auction page and their saved bid details to complete the sealed-bid flow.',
                                            state: 'upcoming',
                                        },
                                        {
                                            title: 'Finalize and import back into the RFQ',
                                            description: 'After the reveal phase is complete, finalize the auction and import the result into the linked RFQ.',
                                            state: 'upcoming',
                                        },
                                    ] satisfies WorkflowGuideStep[]}
                                />
                                <ActionBar>
                                    <Link href={`/auctions/vickrey/${encodeURIComponent(createdAuctionId)}`}>
                                        <Button>Open auction</Button>
                                    </Link>
                                    {returnToRfqHref ? (
                                        <Link href={returnToRfqHref}>
                                            <Button variant="secondary">Back to RFQ</Button>
                                        </Link>
                                    ) : null}
                                </ActionBar>
                            </>
                        ) : null}
                    </div>
                </Panel>
            ) : null}
        </PageShell>
    );
}
