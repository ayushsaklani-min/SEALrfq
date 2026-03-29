'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DeadlineCountdown from '@/components/DeadlineCountdown';
import { TxStatusView } from '@/components/TxStatus';
import { ConfirmModal, type ConfirmDetail } from '@/components/ConfirmModal';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    EmptyState,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    PricingChip,
    RecordsPanel,
    StatusChip,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useToast } from '@/components/Toast';
import { authenticatedFetch } from '@/lib/authFetch';
import { fetchCurrentBlockHeight } from '@/lib/aleoClient';
import { formatAmount, PRICING_MODE, TIMING } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';
import { useProtocolStore } from '@/stores/protocolStore';

type VendorBid = {
    id: string;
    rfqId: string;
    stake: string;
    isWinner?: boolean;
    isRevealed: boolean;
    isRefunded?: boolean;
    revealedAmount?: string | null;
    rfqStatus?: string | null;
    revealDeadline?: number | null;
    biddingDeadline?: number | null;
    tokenType?: number;
    pricingMode?: number;
    paid?: boolean;
    winnerAccepted?: boolean;
};

type OpenRfq = {
    id: string;
    itemName?: string | null;
    status: string;
    tokenType: number;
    pricingMode: number;
    minBid: string;
    biddingDeadline: number;
};

function biddingOpen(deadline: number | null | undefined, currentBlock: number | null) {
    return currentBlock !== null && deadline !== null && deadline !== undefined && currentBlock < deadline;
}

function revealOpen(
    biddingDeadline: number | null | undefined,
    revealDeadline: number | null | undefined,
    currentBlock: number | null,
) {
    return (
        currentBlock !== null &&
        biddingDeadline !== null &&
        biddingDeadline !== undefined &&
        revealDeadline !== null &&
        revealDeadline !== undefined &&
        currentBlock >= biddingDeadline &&
        currentBlock < revealDeadline
    );
}

function canClaimStake(bid: VendorBid, currentBlock: number | null) {
    if (bid.isRefunded) return false;
    if (bid.rfqStatus === 'CANCELLED') return true;
    if (bid.isWinner) return false;
    if (bid.rfqStatus === 'WINNER_SELECTED' || bid.rfqStatus === 'ESCROW_FUNDED' || bid.rfqStatus === 'COMPLETED' || bid.rfqStatus === 'WINNER_DECLINED') {
        return true;
    }
    if (bid.rfqStatus === 'REVEAL' && currentBlock !== null && bid.revealDeadline && currentBlock > bid.revealDeadline + TIMING.SLASH_WINDOW) {
        return true;
    }
    return false;
}

// ── UI-only state for confirmation modal ──────────────────────────────────────
type PendingConfirm =
    | { kind: 'accept';  bid: VendorBid }
    | { kind: 'decline'; bid: VendorBid }
    | { kind: 'claim';   bid: VendorBid };

export default function VendorMyBidsPage() {
    const records = useProtocolStore((state) => state.records);
    const winnerCertificate = useProtocolStore((state) => state.winnerCertificate);
    const toast = useToast();

    const [bids, setBids] = useState<VendorBid[]>([]);
    const [openRfqs, setOpenRfqs] = useState<OpenRfq[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [txKey, setTxKey] = useState<string | null>(null);
    const [proofMessage, setProofMessage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [acting, setActing] = useState(false);

    // UI-only modal state — does NOT affect any existing logic
    const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

    // ── Data fetching — unchanged ─────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [bidsResponse, openRfqsResponse, blockHeight] = await Promise.all([
                    authenticatedFetch('/api/bid/my-bids'),
                    authenticatedFetch('/api/rfq/open'),
                    fetchCurrentBlockHeight(),
                ]);
                const bidsPayload = await bidsResponse.json();
                const openRfqsPayload = await openRfqsResponse.json().catch(() => ({ data: [] }));

                if (!bidsResponse.ok) {
                    throw new Error(bidsPayload?.error?.message || 'Failed to load bids.');
                }
                if (!cancelled) {
                    setBids(bidsPayload.data || []);
                    setOpenRfqs((openRfqsPayload.data || []).filter((rfq: OpenRfq) => biddingOpen(rfq.biddingDeadline, blockHeight)));
                    setCurrentBlock(blockHeight);
                }
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load vendor workspace.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        const intervalId = window.setInterval(load, 15000);
        return () => { cancelled = true; window.clearInterval(intervalId); };
    }, []);

    // ── Action functions — logic unchanged, only added toast.error ────────────
    const respondToAward = async (bid: VendorBid, accept: boolean) => {
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/rfq/${encodeURIComponent(bid.rfqId)}/winner-respond`,
                { accept },
                (_prepareData, txHash) => ({ accept, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            const msg = caught?.message || 'Failed to submit winner response.';
            setError(msg);
            toast.error(msg);
        } finally {
            setActing(false);
        }
    };

    const claimStake = async (bid: VendorBid) => {
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/rfq/${encodeURIComponent(bid.rfqId)}/claim-stake`,
                { bidId: bid.id, stake: bid.stake },
                (_prepareData, txHash) => ({ bidId: bid.id, stake: bid.stake, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            const msg = caught?.message || 'Failed to claim stake.';
            setError(msg);
            toast.error(msg);
        } finally {
            setActing(false);
        }
    };

    const proveWin = (bid: VendorBid) => {
        const localCertificate =
            records.find((record) => record.type === 'WinnerCertificate' && record.rfqId === bid.rfqId) ||
            (winnerCertificate as { rfqId?: string } | null);

        if (localCertificate && 'rfqId' in localCertificate && localCertificate.rfqId === bid.rfqId) {
            setProofMessage(`Local proof check succeeded for RFQ ${bid.rfqId}.`);
            return;
        }
        setProofMessage('No local WinnerCertificate is cached for this RFQ yet.');
    };

    // ── Confirm modal handler — just dispatches to existing functions ─────────
    const handleConfirm = () => {
        if (!confirm) return;
        setConfirm(null);
        if (confirm.kind === 'accept')  respondToAward(confirm.bid, true);
        if (confirm.kind === 'decline') respondToAward(confirm.bid, false);
        if (confirm.kind === 'claim')   claimStake(confirm.bid);
    };

    // ── Derived counts — unchanged ────────────────────────────────────────────
    const wonCount = useMemo(() => bids.filter((bid) => bid.isWinner).length, [bids]);
    const revealCount = useMemo(
        () => bids.filter((bid) => !bid.isRevealed && revealOpen(bid.biddingDeadline, bid.revealDeadline, currentBlock)).length,
        [bids, currentBlock],
    );
    const refundCount = useMemo(() => bids.filter((bid) => canClaimStake(bid, currentBlock)).length, [bids, currentBlock]);

    // ── Confirm modal details ─────────────────────────────────────────────────
    const confirmDetails: ConfirmDetail[] = confirm
        ? confirm.kind === 'accept'
            ? [
                { label: 'Action',         value: 'Accept award' },
                { label: 'RFQ',            value: truncateMiddle(confirm.bid.rfqId, 14, 8) },
                { label: 'Stake returned', value: formatAmount(confirm.bid.stake, 0) },
              ]
            : confirm.kind === 'decline'
            ? [
                { label: 'Action', value: 'Decline award' },
                { label: 'RFQ',    value: truncateMiddle(confirm.bid.rfqId, 14, 8) },
              ]
            : [
                { label: 'Action', value: 'Claim stake' },
                { label: 'RFQ',    value: truncateMiddle(confirm.bid.rfqId, 14, 8) },
                { label: 'Amount', value: formatAmount(confirm.bid.stake, 0) },
              ]
        : [];

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading vendor workspace">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching open RFQs and your bids.</div>
                </Panel>
            </PageShell>
        );
    }

    return (
        <PageShell className="space-y-6">
            {/* Confirm modal — pure UI overlay, does not touch any logic */}
            <ConfirmModal
                open={!!confirm}
                title={
                    confirm?.kind === 'accept'  ? 'Accept award'  :
                    confirm?.kind === 'decline' ? 'Decline award' : 'Claim stake'
                }
                description={
                    confirm?.kind === 'accept'  ? 'Your stake will be returned immediately on-chain.' :
                    confirm?.kind === 'decline' ? 'The buyer will need to re-select a winner.' :
                                                  'Your stake will be returned to your wallet on-chain.'
                }
                details={confirmDetails}
                confirmLabel={confirm?.kind === 'decline' ? 'Decline award' : 'Confirm & sign'}
                danger={confirm?.kind === 'decline'}
                loading={acting}
                onConfirm={handleConfirm}
                onCancel={() => setConfirm(null)}
            />

            <PageHeader
                eyebrow="Dashboard"
                eyebrowHref="/dashboard"
                title="My bids"
                description="See what needs action now: commit, reveal, respond, or claim stake."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {proofMessage ? <Notice title="Proof of win">{proofMessage}</Notice> : null}

            <DataGrid columns={4}>
                <DataPoint label="Open RFQs"        value={openRfqs.length} />
                <DataPoint label="Need reveal"       value={revealCount} />
                <DataPoint label="Won"               value={wonCount} />
                <DataPoint label="Claimable stakes"  value={refundCount} />
            </DataGrid>

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-6">

                    {/* Open RFQs — hide panel entirely when empty to reduce clutter */}
                    {openRfqs.length > 0 && (
                        <Panel title="Open RFQs" subtitle="Active auctions accepting bids right now.">
                            <div className="space-y-3">
                                {openRfqs.map((rfq) => (
                                    <div key={rfq.id} className="rounded-xl border border-white/12 bg-white/[0.05] p-4 transition hover:border-white/20 hover:bg-white/[0.07]">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <StatusChip status={rfq.status} />
                                                    <TokenChip tokenType={rfq.tokenType} />
                                                    <PricingChip pricingMode={rfq.pricingMode} />
                                                </div>
                                                <div className="mt-3 text-base font-semibold text-white">{rfq.itemName || 'Untitled RFQ'}</div>
                                                <div className="mt-2 max-w-fit">
                                                    <CopyableText value={rfq.id} displayValue={truncateMiddle(rfq.id, 16, 10)} />
                                                </div>
                                                <div className="mt-2 text-sm text-white/60">{formatAmount(rfq.minBid, rfq.tokenType)} minimum</div>
                                            </div>
                                            <ActionBar>
                                                {rfq.pricingMode === PRICING_MODE.RFQ ? (
                                                    <Link href={`/vendor/bid/${encodeURIComponent(rfq.id)}`}>
                                                        <Button size="sm">Commit bid</Button>
                                                    </Link>
                                                ) : (
                                                    <Link href={rfq.pricingMode === PRICING_MODE.VICKREY ? '/auctions/vickrey' : '/auctions/dutch'}>
                                                        <Button size="sm" variant="secondary">Open auction</Button>
                                                    </Link>
                                                )}
                                            </ActionBar>
                                        </div>
                                        <div className="mt-3">
                                            <DeadlineCountdown deadlineBlock={rfq.biddingDeadline} label="Bidding deadline" passedLabel="Bidding closed" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Panel>
                    )}

                    <Panel title="Your bids">
                        {bids.length === 0 ? (
                            <EmptyState
                                title="No bids yet"
                                description="Commit a sealed bid on an open RFQ or participate in an auction."
                                actionHref="/auctions"
                                actionLabel="Browse auctions"
                            />
                        ) : (
                            <div className="space-y-3">
                                {bids.map((bid) => (
                                    <div key={bid.id} className="rounded-xl border border-white/12 bg-white/[0.05] p-4 transition hover:border-white/20 hover:bg-white/[0.07]">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {bid.rfqStatus ? <StatusChip status={bid.rfqStatus} /> : null}
                                                    <TokenChip tokenType={bid.tokenType ?? 0} />
                                                    <PricingChip pricingMode={bid.pricingMode ?? 0} />
                                                    {bid.isWinner && (
                                                        <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                                                            Winner
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-3 max-w-fit">
                                                    <CopyableText value={bid.rfqId} displayValue={truncateMiddle(bid.rfqId, 16, 10)} className="text-sm font-semibold" />
                                                </div>
                                                <div className="mt-2 max-w-fit">
                                                    <CopyableText value={bid.id} displayValue={truncateMiddle(bid.id, 14, 8)} />
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-amber-200/20 bg-amber-400/[0.06] px-4 py-3 text-sm lg:min-w-[200px]">
                                                <div className="text-white/60">Stake <span className="font-medium text-white">{formatAmount(bid.stake, 0)}</span></div>
                                                <div className="mt-1 text-white/60">
                                                    {bid.revealedAmount
                                                        ? <>Bid <span className="font-medium text-white">{formatAmount(bid.revealedAmount, bid.tokenType ?? 0)}</span></>
                                                        : bid.isRevealed ? 'Revealed' : 'Not revealed yet'}
                                                </div>
                                            </div>
                                        </div>

                                        {!bid.isRevealed && biddingOpen(bid.biddingDeadline, currentBlock) ? (
                                            <div className="mt-3">
                                                <DeadlineCountdown deadlineBlock={bid.biddingDeadline!} label="Bidding deadline" passedLabel="Bidding closed" />
                                            </div>
                                        ) : null}

                                        {!bid.isRevealed && revealOpen(bid.biddingDeadline, bid.revealDeadline, currentBlock) ? (
                                            <div className="mt-3">
                                                <DeadlineCountdown deadlineBlock={bid.revealDeadline} label="Reveal deadline" passedLabel="Reveal closed" />
                                            </div>
                                        ) : null}

                                        {!bid.isRevealed && biddingOpen(bid.biddingDeadline, currentBlock) ? (
                                            <div className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
                                                Reveal opens after bidding closes.
                                            </div>
                                        ) : null}

                                        <ActionBar className="mt-3">
                                            {!bid.isRevealed && bid.pricingMode === PRICING_MODE.RFQ && revealOpen(bid.biddingDeadline, bid.revealDeadline, currentBlock) ? (
                                                <Link href={`/vendor/reveal/${encodeURIComponent(bid.id)}`}>
                                                    <Button size="sm" variant="secondary">Reveal</Button>
                                                </Link>
                                            ) : null}

                                            {bid.isWinner && bid.rfqStatus === 'WINNER_SELECTED' && !bid.winnerAccepted ? (
                                                <>
                                                    <Button size="sm" onClick={() => setConfirm({ kind: 'accept', bid })} isLoading={acting}>
                                                        Accept
                                                    </Button>
                                                    <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'decline', bid })} isLoading={acting}>
                                                        Decline
                                                    </Button>
                                                </>
                                            ) : null}

                                            {canClaimStake(bid, currentBlock) ? (
                                                <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'claim', bid })} isLoading={acting}>
                                                    Claim stake
                                                </Button>
                                            ) : null}

                                            {bid.isWinner ? (
                                                <>
                                                    <Button size="sm" variant="secondary" onClick={() => proveWin(bid)}>
                                                        Proof of win
                                                    </Button>
                                                    <Link href={`/escrow/${encodeURIComponent(bid.rfqId)}`}>
                                                        <Button size="sm" variant="secondary">Escrow</Button>
                                                    </Link>
                                                </>
                                            ) : null}
                                        </ActionBar>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>

                    {txKey ? (
                        <Panel title="Latest transaction">
                            <TxStatusView
                                idempotencyKey={txKey}
                                compact={true}
                                onConfirmed={() => toast.success('Transaction confirmed on-chain.')}
                            />
                        </Panel>
                    ) : null}
                </div>

                <div className="space-y-6">
                    <Panel title="Saved records">
                        <RecordsPanel
                            records={records.map((record) => ({
                                id: record.id,
                                type: record.type,
                                rfqId: record.rfqId,
                                createdAt: record.createdAt,
                            }))}
                        />
                    </Panel>
                </div>
            </div>
        </PageShell>
    );
}
