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
    InfoList,
    InfoRow,
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
import { blockEta, formatAmount, formatBlockTime, randomField, tokenLabel, TOKEN_TYPE } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
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
    tokenType?: number | null;
    tokenSymbol?: string | null;
};

const FIELD_ID_PATTERN = /^\d+field$/;

function toMicroUnits(value: string): string {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return value;
    return String(Math.round(numeric * 1_000_000));
}

function fromMicroUnits(value: string, tokenType: number) {
    return formatAmount(value, tokenType);
}

const START_DELAYS = [
    { label: 'Immediately (~1 min)', blocks: 20 },
    { label: '5 minutes', blocks: 60 },
    { label: '15 minutes', blocks: 180 },
    { label: '30 minutes', blocks: 360 },
    { label: '1 hour', blocks: 720 },
];

const DURATIONS = [
    { label: '30 minutes', blocks: 360 },
    { label: '1 hour', blocks: 720 },
    { label: '2 hours', blocks: 1440 },
    { label: '4 hours', blocks: 2880 },
    { label: '8 hours', blocks: 5760 },
    { label: '1 day', blocks: 17280 },
];

export default function DutchAuctionsPage() {
    const searchParams = useSearchParams();
    const { walletAddress } = useWallet();
    const saveAuctionSalt = useProtocolStore((state) => state.saveAuctionSalt);
    const linkedRfqId = searchParams.get('rfqId')?.trim() ?? '';
    const [auctions, setAuctions] = useState<DutchSummary[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [rfqId, setRfqId] = useState(linkedRfqId);
    const [tokenType, setTokenType] = useState(String(TOKEN_TYPE.CREDITS));
    const [startPrice, setStartPrice] = useState('');
    const [reservePrice, setReservePrice] = useState('');
    const [startDelayBlocks, setStartDelayBlocks] = useState<number>(20);
    const [durationBlocks, setDurationBlocks] = useState<number>(720);
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
                    authenticatedFetch('/api/auction/dutch'),
                    fetchCurrentBlockHeight(),
                ]);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load Dutch auctions.');
                if (!cancelled) {
                    setAuctions(payload.data || []);
                    setCurrentBlock(blockHeight);
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

    useEffect(() => {
        if (linkedRfqId) {
            setRfqId((current) => current || linkedRfqId);
        }
    }, [linkedRfqId]);

    const startBlock = currentBlock ? currentBlock + startDelayBlocks : 0;
    const endBlock = startBlock ? startBlock + durationBlocks : 0;
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
                ? 'The RFQ id is already prefilled. Create the Dutch auction here so vendors can monitor the price path.'
                : 'Paste the RFQ id, then create the Dutch auction to open the live-price workflow.',
            state: createdAuctionId ? 'complete' : ('current' as const),
        },
        {
            title: 'Vendors monitor the live price',
            description: 'Once the start block is reached, vendors watch the descending price and decide when to accept it.',
            state: createdAuctionId ? 'current' : ('upcoming' as const),
        },
        {
            title: 'A vendor accepts and the auction finalizes',
            description: 'The first valid accept locks the winner and final price for import back into the RFQ.',
            state: 'upcoming' as const,
        },
        {
            title: 'Import the accepted result into the RFQ',
            description: 'Return to the linked RFQ and import the finalized Dutch outcome so the winner-response flow can continue.',
            state: 'upcoming' as const,
        },
        {
            title: 'Finish winner response and escrow in RFQ',
            description: 'The imported winner accepts inside the RFQ, then the buyer funds escrow and continues settlement.',
            state: 'upcoming' as const,
        },
    ];

    const startPriceMicro = Number(toMicroUnits(startPrice));
    const reservePriceMicro = Number(toMicroUnits(reservePrice));
    const decrementPerBlock =
        durationBlocks > 0 && startPriceMicro > reservePriceMicro
            ? Math.max(1, Math.floor((startPriceMicro - reservePriceMicro) / durationBlocks))
            : 0;

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
            if (!startPrice.trim()) throw new Error('Enter a starting price.');
            if (!reservePrice.trim()) throw new Error('Enter a floor (reserve) price.');
            if (Number(startPrice) <= Number(reservePrice)) {
                throw new Error('Starting price must be higher than the floor price.');
            }
            if (decrementPerBlock <= 0) throw new Error('Price drop per block must be greater than zero.');

            const salt = randomField();
            const body = {
                salt,
                rfqId: normalizedRfqId,
                tokenType: selectedTokenType,
                startPrice: toMicroUnits(startPrice),
                reservePrice: toMicroUnits(reservePrice),
                decrementPerBlock: String(decrementPerBlock),
                startBlock,
                endBlock,
            };
            const result = await walletFirstTx('/api/auction/dutch', body, (_prepareData, txHash) => ({ ...body, txHash }));
            saveAuctionSalt(result.data.auctionId, salt);
            setCreatedAuctionId(result.data.auctionId || null);
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
                eyebrowHref="/auctions"
                title="Dutch Auction"
                description="Price starts high and drops each block. The current deployed contract supports linked RFQs and ALEO credits only."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {!walletAddress ? <Notice title="Wallet required">Connect a wallet to create a Dutch auction.</Notice> : null}

            <DataGrid columns={3}>
                <DataPoint label="Auctions" value={auctions.length} />
                <DataPoint label="Live now" value={activeCount} />
                <DataPoint label="Accepted" value={wonCount} subtle={`Current block ${currentBlock ?? 'Loading...'}`} />
            </DataGrid>

            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <Panel title="Create auction" subtitle="Set your prices. The price drop per block is calculated automatically.">
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
                            <Field label={`Starting price (${tokenLabel(selectedTokenType)})`} hint="The highest price a vendor will see.">
                                <TextInput type="number" min="0.000001" step="0.000001" value={startPrice} onChange={(event) => setStartPrice(event.target.value)} placeholder="5.0" />
                            </Field>
                            <Field label={`Floor price (${tokenLabel(selectedTokenType)})`} hint="Price will never drop below this.">
                                <TextInput type="number" min="0.000001" step="0.000001" value={reservePrice} onChange={(event) => setReservePrice(event.target.value)} placeholder="1.0" />
                            </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Starts in" hint={startBlock > 0 ? `Start block: ${startBlock}` : 'How long before price descent begins'}>
                                <SelectInput value={startDelayBlocks} onChange={(event) => setStartDelayBlocks(Number(event.target.value))}>
                                    {START_DELAYS.map((option) => (
                                        <option key={option.label} value={option.blocks}>
                                            {option.label}
                                        </option>
                                    ))}
                                </SelectInput>
                            </Field>
                            <Field label="Auction duration" hint={endBlock > 0 ? `End block: ${endBlock}` : 'How long the price descent runs'}>
                                <SelectInput value={durationBlocks} onChange={(event) => setDurationBlocks(Number(event.target.value))}>
                                    {DURATIONS.map((option) => (
                                        <option key={option.label} value={option.blocks}>
                                            {option.label}
                                        </option>
                                    ))}
                                </SelectInput>
                            </Field>
                        </div>

                        {startPrice && reservePrice && decrementPerBlock > 0 ? (
                            <div className="space-y-1 rounded-xl border border-white/12 bg-white/[0.05] px-3 py-3 text-xs text-white/60">
                                <div>
                                    Price drops <span className="font-medium text-white">{fromMicroUnits(String(decrementPerBlock), selectedTokenType)}/block</span>
                                </div>
                                <div>
                                    Starts in <span className="font-medium text-white">~{formatBlockTime(startDelayBlocks)}</span>, runs for <span className="font-medium text-white">~{formatBlockTime(durationBlocks)}</span>
                                </div>
                            </div>
                        ) : null}

                        <ActionBar>
                            <Button onClick={createAuction} isLoading={acting} disabled={!walletAddress || !currentBlock}>
                                Create Dutch auction
                            </Button>
                        </ActionBar>
                    </div>
                </Panel>

                <div className="space-y-6">
                    {linkedRfqId ? (
                        <Panel title="Linked RFQ" subtitle="You opened the Dutch workspace from an RFQ. Keep this RFQ id for creation, import, and return navigation.">
                            <div className="space-y-4">
                                <div className="max-w-fit">
                                    <CopyableText value={linkedRfqId} displayValue={truncateMiddle(linkedRfqId, 16, 10)} />
                                </div>
                                {linkedAuctions.length > 0 ? (
                                    <div className="space-y-2">
                                        <div className="text-sm font-medium text-white/70">Existing linked auctions</div>
                                        {linkedAuctions.slice(0, 3).map((auction) => (
                                            <Link
                                                key={auction.auctionId || `${auction.rfqId}:${auction.startBlock}`}
                                                href={`/auctions/dutch/${encodeURIComponent(auction.auctionId || '')}`}
                                                className="block rounded-xl border border-white/12 bg-white/[0.05] px-3 py-3 text-sm text-white/80 transition hover:border-white/20 hover:bg-white/[0.08]"
                                            >
                                                {auction.auctionId ? truncateMiddle(auction.auctionId, 16, 10) : 'Untitled auction'}
                                            </Link>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-sm text-white/55">No linked Dutch auction is indexed for this RFQ yet.</div>
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

                    <Panel title="Workflow guide" subtitle="Use this page as the handoff from RFQ creation into Dutch execution and back into the RFQ.">
                        <WorkflowGuide steps={workflowSteps} />
                    </Panel>

                    <Panel title="Recent auctions" subtitle="Expand an auction to inspect its linked RFQ, live pricing state, and the next action.">
                        {loading ? (
                            <div className="text-sm text-white/55">Loading auctions...</div>
                        ) : auctions.length === 0 ? (
                            <div className="text-sm text-white/55">No Dutch auctions created yet.</div>
                        ) : (
                            <div className="space-y-3">
                                {auctions.map((auction, index) => (
                                    <DisclosureCard
                                        key={auction.auctionId || `${auction.rfqId}:${auction.startBlock}`}
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
                                                    <span className="rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200">
                                                        Accepted
                                                    </span>
                                                ) : (
                                                    <span className="rounded-full border border-blue-300/30 bg-blue-400/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">
                                                        Live
                                                    </span>
                                                )}
                                            </div>
                                        }
                                    >
                                        <div className="space-y-4">
                                            <DataGrid columns={2}>
                                                <DataPoint
                                                    label="Live price"
                                                    value={auction.currentPrice ? formatAmount(auction.currentPrice, auction.tokenType ?? TOKEN_TYPE.CREDITS) : '--'}
                                                />
                                                <DataPoint
                                                    label="Final price"
                                                    value={
                                                        auction.finalPrice
                                                            ? formatAmount(auction.finalPrice, auction.tokenType ?? TOKEN_TYPE.CREDITS)
                                                            : '--'
                                                    }
                                                />
                                                <DataPoint label="Start block" value={auction.startBlock ? `Block ${auction.startBlock}` : '--'} subtle={blockEta(auction.startBlock, currentBlock)} />
                                                <DataPoint label="End block" value={auction.endBlock ? `Block ${auction.endBlock}` : '--'} subtle={blockEta(auction.endBlock, currentBlock)} />
                                            </DataGrid>
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <div className="rounded-xl border border-white/12 bg-white/[0.05] p-3">
                                                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Auction id</div>
                                                    <div className="mt-2 max-w-fit">
                                                        {auction.auctionId ? (
                                                            <CopyableText value={auction.auctionId} displayValue={truncateMiddle(auction.auctionId, 16, 10)} />
                                                        ) : (
                                                            <span className="text-sm font-medium text-white/50">--</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="rounded-xl border border-white/12 bg-white/[0.05] p-3">
                                                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Linked RFQ</div>
                                                    <div className="mt-2 max-w-fit">
                                                        {auction.rfqId ? (
                                                            <CopyableText value={auction.rfqId} displayValue={truncateMiddle(auction.rfqId, 16, 10)} />
                                                        ) : (
                                                            <span className="text-sm font-medium text-white/50">--</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/60">
                                                {auction.finalWinner ? (
                                                    <span className="text-emerald-300">Accepted by a vendor. This auction is ready for RFQ import.</span>
                                                ) : (
                                                    <span>Waiting for a participant to accept the current live price.</span>
                                                )}
                                            </div>
                                            <ActionBar>
                                                {auction.auctionId ? (
                                                    <Link href={`/auctions/dutch/${encodeURIComponent(auction.auctionId)}`}>
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

                    <Panel title="How it works">
                        <InfoList>
                            <InfoRow label="Price movement" value="Starts high, drops each block automatically" />
                            <InfoRow label="Vendor action" value="Accept the current live price in one transaction" />
                            <InfoRow label="RFQ handoff" value="Import the accepted result into the linked RFQ" />
                        </InfoList>
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
                                            description: 'Use the Dutch detail page to monitor the live price, accept flow, and import step.',
                                            state: 'current',
                                        },
                                        {
                                            title: 'Wait for a vendor to accept the live price',
                                            description: 'The first valid accept sets the winner and final price for this auction.',
                                            state: 'upcoming',
                                        },
                                        {
                                            title: 'Import the result back into the RFQ',
                                            description: 'After acceptance, return to the RFQ and import the finalized Dutch result.',
                                            state: 'upcoming',
                                        },
                                    ] satisfies WorkflowGuideStep[]}
                                />
                                <ActionBar>
                                    <Link href={`/auctions/dutch/${encodeURIComponent(createdAuctionId)}`}>
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
