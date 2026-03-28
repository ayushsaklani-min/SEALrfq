'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    TextInput,
    TokenChip,
    WorkflowGuide,
    type WorkflowGuideStep,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { formatAmount, PRICING_MODE, tokenLabel, TOKEN_TYPE, randomField } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';

type VickreyDetail = {
    auctionId?: string;
    rfqId?: string | null;
    creator?: string | null;
    bidCount?: string | null;
    revealedCount?: string | null;
    flatStake?: string | null;
    biddingDeadline?: number | null;
    revealDeadline?: number | null;
    lowestBid?: string | null;
    secondLowestBid?: string | null;
    finalWinner?: string | null;
    finalPrice?: string | null;
    tokenType?: number | null;
    tokenSymbol?: string | null;
};

function toMicroUnits(value: string): string {
    const numeric = Number(value.trim());
    if (!Number.isFinite(numeric) || numeric <= 0) return '0';
    return String(Math.round(numeric * 1_000_000));
}

function fromMicroUnits(value: string | null | undefined): string {
    if (!value) return '';
    try {
        const raw = BigInt(value);
        const whole = raw / 1_000_000n;
        const fraction = raw % 1_000_000n;
        if (fraction === 0n) return whole.toString();
        return `${whole}.${fraction.toString().padStart(6, '0').replace(/0+$/, '')}`;
    } catch {
        return value;
    }
}

function requiredStakeForBid(amountRaw: string, flatStakeRaw: string | null | undefined): bigint {
    const bidAmount = BigInt(amountRaw || '0');
    const flatStake = BigInt(flatStakeRaw || '0');
    if (bidAmount <= 0n) return flatStake;
    const revealStakeFloor = bidAmount / 10n;
    const revealRequired = revealStakeFloor > 0n ? revealStakeFloor : 1n;
    return flatStake > revealRequired ? flatStake : revealRequired;
}

export default function VickreyDetailPage({ params }: { params: { auctionId: string } }) {
    const [auction, setAuction] = useState<VickreyDetail | null>(null);
    const [commitAmount, setCommitAmount] = useState('');
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
                if (!cancelled) {
                    setAuction(payload.data);
                    const savedBid = localStorage.getItem(`vickrey_bid_latest_${params.auctionId}`);
                    if (savedBid) {
                        try {
                            const parsed = JSON.parse(savedBid);
                            setRevealBidId(parsed.bidId || '');
                            setRevealSalt(parsed.salt || '');
                            setRevealAmount(parsed.amount || '');
                        } catch {
                            // Ignore malformed local bundle.
                        }
                    }
                }
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
            const commitAmountRaw = toMicroUnits(commitAmount);
            const requiredCommitStake = requiredStakeForBid(commitAmountRaw, auction?.flatStake);
            if (commitAmountRaw === '0') {
                throw new Error('Enter a bid amount greater than zero.');
            }
            const body = {
                bidAmount: commitAmountRaw,
                salt: commitSalt,
                stake: requiredCommitStake.toString(),
            };
            const result = await walletFirstTx(
                `/api/auction/vickrey/${encodeURIComponent(params.auctionId)}/commit`,
                body,
                (prepareData, txHash) => ({ ...body, bidId: prepareData.bidId, txHash }),
            );
            if (result.data.bidId) {
                const bundle = JSON.stringify({
                    bidId: result.data.bidId,
                    salt: commitSalt,
                    amount: commitAmount,
                    savedAt: new Date().toISOString(),
                });
                localStorage.setItem(`vickrey_bid_${result.data.bidId}`, bundle);
                localStorage.setItem(`vickrey_bid_latest_${params.auctionId}`, bundle);
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
            const revealAmountRaw = toMicroUnits(revealAmount);
            if (!revealBidId.trim()) {
                throw new Error('Enter the bid id used during commit.');
            }
            if (revealAmountRaw === '0') {
                throw new Error('Enter the reveal amount greater than zero.');
            }
            const body = { bidId: revealBidId.trim(), amount: revealAmountRaw, salt: revealSalt };
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

    const auctionTokenType = auction.tokenType ?? TOKEN_TYPE.CREDITS;
    const commitAmountRaw = toMicroUnits(commitAmount);
    const requiredCommitStake = requiredStakeForBid(commitAmountRaw, auction.flatStake);
    const requiredCommitStakeDisplay = requiredCommitStake > 0n ? fromMicroUnits(requiredCommitStake.toString()) : '';
    const bidCount = Number(auction.bidCount || '0');
    const revealedCount = Number(auction.revealedCount || '0');
    const finalReady = Boolean(auction.finalWinner && auction.finalPrice);
    const linkedRfqHref = auction.rfqId ? `/buyer/rfqs/${encodeURIComponent(auction.rfqId)}` : null;
    const workflowSteps: WorkflowGuideStep[] = [
        {
            title: 'Auction is created and linked',
            description: 'This auction is now the execution workspace for the linked RFQ.',
            state: 'complete' as const,
            action: null,
        },
        {
            title: 'Vendors commit sealed bids',
            description: 'Vendors submit hidden bids first and must keep their bid id and salt for the reveal phase.',
            state: bidCount > 0 ? 'complete' : ('current' as const),
        },
        {
            title: 'Vendors reveal after bidding closes',
            description: 'Each vendor reveals the same bid id, amount, and salt that was used during commit.',
            state:
                finalReady || (bidCount > 0 && revealedCount === bidCount)
                    ? 'complete'
                    : bidCount > 0
                      ? 'current'
                      : ('upcoming' as const),
        },
        {
            title: 'Buyer finalizes the auction',
            description: 'Once enough reveals are in, finalize here to lock the winner and the second-price settlement amount.',
            state: finalReady ? 'complete' : revealedCount > 0 ? 'current' : ('upcoming' as const),
        },
        {
            title: 'Import the finalized result into the RFQ',
            description: 'After finalization, return the winner and price to the linked RFQ so the winner-response flow can continue.',
            state: finalReady ? 'current' : ('upcoming' as const),
            action:
                finalReady && auction.rfqId ? (
                    <ActionBar>
                        <Button size="sm" onClick={importIntoRfq} isLoading={acting}>
                            Import into RFQ
                        </Button>
                        <Link href={linkedRfqHref}>
                            <Button size="sm" variant="secondary">Open RFQ</Button>
                        </Link>
                    </ActionBar>
                ) : null,
        },
        {
            title: 'Winner responds and buyer funds escrow in the RFQ',
            description: 'The auction is not the end of the workflow. The imported winner still accepts in RFQ, then the buyer funds escrow.',
            state: 'upcoming' as const,
        },
    ];
    if (linkedRfqHref && workflowSteps[0]) {
        workflowSteps[0].action = (
            <ActionBar>
                <Link href={linkedRfqHref}>
                    <Button size="sm" variant="secondary">Open linked RFQ</Button>
                </Link>
            </ActionBar>
        );
    }

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Auctions"
                title={`Vickrey ${params.auctionId}`}
                description={`Commit sealed bids, reveal them, finalize the result, then import it into the linked RFQ. Bid prices use ${tokenLabel(auctionTokenType)}. Stake remains ALEO credits.`}
                actions={<TokenChip tokenType={auction.tokenType} label={auction.tokenSymbol || undefined} />}
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-6">
                    <Panel title="Auction summary">
                        <DataGrid columns={2}>
                            <DataPoint label="Auction id" value={<CopyableText value={params.auctionId} displayValue={truncateMiddle(params.auctionId, 16, 10)} />} />
                            <DataPoint label="RFQ id" value={auction.rfqId ? <CopyableText value={auction.rfqId} displayValue={truncateMiddle(auction.rfqId, 16, 10)} /> : '--'} />
                            <DataPoint label="Creator" value={auction.creator ? <CopyableText value={auction.creator} displayValue={truncateMiddle(auction.creator, 14, 10)} /> : '--'} />
                            <DataPoint label="Bid count" value={auction.bidCount || '0'} />
                            <DataPoint label="Revealed" value={auction.revealedCount || '0'} />
                            <DataPoint label="Minimum stake" value={formatAmount(auction.flatStake, TOKEN_TYPE.CREDITS)} />
                            <DataPoint label="Lowest bid" value={formatAmount(auction.lowestBid, auctionTokenType)} />
                            <DataPoint label="Second price" value={formatAmount(auction.secondLowestBid, auctionTokenType)} />
                            <DataPoint label="Final winner" value={auction.finalWinner || '--'} />
                            <DataPoint label="Final price" value={formatAmount(auction.finalPrice, auctionTokenType)} />
                        </DataGrid>
                    </Panel>

                    <Panel title="Participant actions" subtitle="Commit and reveal fields stay aligned in separate operator panels.">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                                <div className="text-sm font-semibold text-white">Commit bid</div>
                                <Field label={`Commit amount (${tokenLabel(auctionTokenType)})`} hint="Enter a human-readable amount. The form converts it to on-chain micro-units automatically.">
                                    <TextInput type="number" min="0.000001" step="0.000001" value={commitAmount} onChange={(event) => setCommitAmount(event.target.value)} placeholder="1.0" />
                                </Field>
                                <Field label="Required stake (ALEO credits)" hint="Calculated automatically from the higher of the auction minimum stake and 10% of your bid.">
                                    <TextInput value={requiredCommitStakeDisplay} readOnly placeholder="Calculated automatically" />
                                </Field>
                                <Field label="Salt">
                                    <TextInput value={commitSalt} onChange={(event) => setCommitSalt(event.target.value)} />
                                </Field>
                                <Button onClick={commitBid} isLoading={acting}>
                                    Commit bid
                                </Button>
                            </div>

                            <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                                <div className="text-sm font-semibold text-white">Reveal bid</div>
                                <Field label="Bid id">
                                    <TextInput value={revealBidId} onChange={(event) => setRevealBidId(event.target.value)} placeholder="Bid id" />
                                </Field>
                                <Field label={`Reveal amount (${tokenLabel(auctionTokenType)})`} hint="Reveal the same human-readable amount you used during commit.">
                                    <TextInput type="number" min="0.000001" step="0.000001" value={revealAmount} onChange={(event) => setRevealAmount(event.target.value)} placeholder="1.0" />
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
                    <Panel title="Workflow guide" subtitle="This is the full buyer and vendor handoff path for a linked Vickrey RFQ.">
                        <WorkflowGuide steps={workflowSteps} />
                    </Panel>

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
