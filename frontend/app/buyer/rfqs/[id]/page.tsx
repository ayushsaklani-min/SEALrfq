'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/authFetch';
import { walletFirstTx } from '@/lib/walletTx';
import { TxStatusView } from '@/components/TxStatus';
import DeadlineCountdown from '@/components/DeadlineCountdown';
import ConfirmDialog from '@/components/ConfirmDialog';
import CopyButton from '@/components/CopyButton';

type RFQ = {
    id: string;
    buyer: string;
    status: 'OPEN' | 'CLOSED' | 'WINNER_SELECTED' | 'ESCROW_FUNDED' | 'COMPLETED' | string;
    biddingDeadline: number;
    revealDeadline: number;
    minBid: string;
    createdAt?: string;
    // Product details (stored by backend alongside metadataHash)
    itemName?: string;
    description?: string;
    quantity?: string;
    unit?: string;
    metadataHash?: string;
};

type Bid = {
    id: string;
    vendor: string;
    isRevealed: boolean;
    isWinner?: boolean;
    revealedAmount: string | null;
    stake: string;
};

function formatDeadline(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '-';
    if (value >= 1_000_000_000) {
        return `${new Date(value * 1000).toLocaleString()} (${value})`;
    }
    return `Block ${value}`;
}

/** Convert microcredits string/bigint to a display string in ALEO. */
function microToAleo(microcredits: string | bigint): string {
    try {
        const n = typeof microcredits === 'bigint' ? microcredits : BigInt(microcredits);
        const whole = n / 1_000_000n;
        const frac = n % 1_000_000n;
        if (frac === 0n) return `${whole} ALEO`;
        const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
        return `${whole}.${fracStr} ALEO`;
    } catch {
        return microcredits.toString();
    }
}

export default function BuyerRFQDetailPage({ params }: { params: { id: string } }) {
    const rfqId = params.id;
    const [rfq, setRfq] = useState<RFQ | null>(null);
    const [bids, setBids] = useState<Bid[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [closing, setClosing] = useState(false);
    const [closeTxKey, setCloseTxKey] = useState<string | null>(null);
    const [biddingDeadlineReached, setBiddingDeadlineReached] = useState(false);
    const [revealDeadlineReached, setRevealDeadlineReached] = useState(false);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);

    const onBiddingDeadline = useCallback(() => setBiddingDeadlineReached(true), []);
    const onRevealDeadline = useCallback(() => setRevealDeadlineReached(true), []);

    useEffect(() => {
        const load = async () => {
            try {
                const [rfqRes, bidsRes] = await Promise.all([
                    authenticatedFetch(`/api/rfq/${rfqId}`),
                    authenticatedFetch(`/api/rfq/${rfqId}/bids`),
                ]);
                const [rfqJson, bidsJson] = await Promise.all([rfqRes.json(), bidsRes.json()]);

                if (!rfqRes.ok) {
                    throw new Error(rfqJson?.error?.message || 'Failed to load RFQ');
                }

                setRfq(rfqJson.data);
                setBids(bidsRes.ok ? bidsJson.data || [] : []);
            } catch (e: any) {
                setError(e?.message || 'Failed to load RFQ');
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [rfqId]);

    const revealedCount = useMemo(() => bids.filter((b) => b.isRevealed).length, [bids]);

    const handleCloseBidding = async () => {
        if (!rfq || rfq.status !== 'OPEN' || closing) return;
        setShowCloseConfirm(false);
        setClosing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/rfq/${rfqId}/close`,
                {},
                (_prepareData, txHash) => ({ txHash }),
            );
            setCloseTxKey(result.idempotencyKey);
            setRfq((prev) => (prev ? { ...prev, status: 'CLOSED' } : prev));
        } catch (e: any) {
            setError(e?.message || 'Failed to close bidding');
            setClosing(false);
        }
    };

    if (loading) return <div className="max-w-5xl mx-auto p-8 text-gray-400">Loading RFQ...</div>;
    if (error) return <div className="max-w-5xl mx-auto p-8 text-red-400">{error}</div>;
    if (!rfq) return <div className="max-w-5xl mx-auto p-8 text-red-400">RFQ not found</div>;

    const hasProductDetails = rfq.itemName || rfq.quantity;

    return (
        <div className="max-w-5xl mx-auto py-10 px-4">
            <div className="flex items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-3xl font-bold">RFQ Details</h1>
                    <div className="flex items-center gap-1 mt-1">
                        <p className="text-gray-400 text-sm">ID:</p>
                        <CopyButton text={rfq.id} />
                    </div>
                </div>
                <span className="px-3 py-1 rounded-full text-sm border border-white/15 bg-white/5">
                    {rfq.status}
                </span>
            </div>

            {/* ── Product Details ─────────────────────────────────── */}
            {hasProductDetails && (
                <div className="glass p-6 rounded-2xl border border-white/10 mb-6">
                    <h2 className="text-lg font-semibold mb-4 text-white">Product</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        {rfq.itemName && (
                            <div className="md:col-span-2">
                                <div className="text-gray-400 mb-1">Item Name</div>
                                <div className="text-white text-base font-medium">{rfq.itemName}</div>
                            </div>
                        )}
                        {rfq.quantity && (
                            <div>
                                <div className="text-gray-400 mb-1">Quantity</div>
                                <div>{rfq.quantity}{rfq.unit ? ` ${rfq.unit}` : ''}</div>
                            </div>
                        )}
                        {rfq.description && (
                            <div className={rfq.quantity ? '' : 'md:col-span-2'}>
                                <div className="text-gray-400 mb-1">Description</div>
                                <div className="text-gray-200 leading-relaxed">{rfq.description}</div>
                            </div>
                        )}
                        {rfq.metadataHash && (
                            <div className="md:col-span-2">
                                <div className="text-gray-400 mb-1">Metadata Hash <span className="text-xs">(SHA-256, on-chain)</span></div>
                                <div className="font-mono text-xs text-gray-500 break-all">{rfq.metadataHash}</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── RFQ Info ────────────────────────────────────────── */}
            <div className="glass p-6 rounded-2xl border border-white/10 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                        <div className="text-gray-400">Buyer</div>
                        <div className="break-all">{rfq.buyer}</div>
                    </div>
                    <div>
                        <div className="text-gray-400">Minimum Bid</div>
                        <div className="font-semibold">{microToAleo(rfq.minBid)}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{Number(rfq.minBid).toLocaleString()} microcredits</div>
                    </div>
                    <div>
                        <div className="text-gray-400">Bidding Deadline</div>
                        <div>{formatDeadline(rfq.biddingDeadline)}</div>
                    </div>
                    <div>
                        <div className="text-gray-400">Reveal Deadline</div>
                        <div>{formatDeadline(rfq.revealDeadline)}</div>
                    </div>
                </div>
            </div>

            {/* ── Deadline Timers ────────────────────────────────── */}
            <div className="space-y-3 mb-6">
                {rfq.status === 'OPEN' && (
                    <DeadlineCountdown
                        deadlineBlock={rfq.biddingDeadline}
                        label="Bidding closes in"
                        passedLabel="Bidding deadline reached — you can now close bidding"
                        onDeadlineReached={onBiddingDeadline}
                    />
                )}
                {(rfq.status === 'CLOSED' || rfq.status === 'OPEN') && (
                    <DeadlineCountdown
                        deadlineBlock={rfq.revealDeadline}
                        label="Reveal window closes in"
                        passedLabel="Reveal deadline passed"
                        onDeadlineReached={onRevealDeadline}
                    />
                )}
            </div>

            {/* ── Bidding Control ─────────────────────────────────── */}
            <div className="glass p-6 rounded-2xl border border-white/10 mb-6">
                <h2 className="text-xl font-semibold mb-3">Bidding Control</h2>
                <p className="text-sm text-gray-400 mb-4">
                    {rfq.status === 'OPEN' && !biddingDeadlineReached
                        ? 'Waiting for bidding deadline to pass before you can close bidding.'
                        : 'Close bidding to open the vendor reveal window.'}
                </p>
                <button
                    onClick={() => setShowCloseConfirm(true)}
                    disabled={rfq.status !== 'OPEN' || closing || !biddingDeadlineReached}
                    className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {closing
                        ? 'Submitting...'
                        : rfq.status !== 'OPEN'
                          ? 'Bidding Closed'
                          : !biddingDeadlineReached
                            ? 'Waiting for deadline...'
                            : 'Close Bidding'}
                </button>
                {closeTxKey && (
                    <div className="mt-4">
                        <TxStatusView idempotencyKey={closeTxKey} showHistory={true} compact={true} />
                    </div>
                )}
            </div>

            {/* ── Bids ────────────────────────────────────────────── */}
            <div className="glass p-6 rounded-2xl border border-white/10 mb-6">
                <h2 className="text-xl font-semibold mb-4">Bids</h2>
                <p className="text-sm text-gray-400 mb-3">
                    Total: {bids.length} | Revealed: {revealedCount}
                </p>

                {bids.length === 0 ? (
                    <p className="text-gray-400">No bids yet.</p>
                ) : (
                    <div className="space-y-3">
                        {bids.map((bid) => (
                            <div key={bid.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                                <div className="flex items-center gap-1 text-sm text-gray-300 mb-1">
                                    <span>Bid ID:</span><CopyButton text={bid.id} />
                                </div>
                                <div className="flex items-center gap-1 text-sm text-gray-300 mb-1">
                                    <span>Vendor:</span><CopyButton text={bid.vendor} />
                                </div>
                                <p className="text-sm text-gray-300">
                                    Status: {bid.isRevealed ? 'Revealed' : 'Committed'}
                                    {bid.isWinner ? ' ✓ Winner' : ''}
                                </p>
                                {bid.revealedAmount && (
                                    <p className="text-sm text-primary-300">
                                        Amount: {microToAleo(bid.revealedAmount)}
                                        <span className="text-gray-500 ml-2">({Number(bid.revealedAmount).toLocaleString()} microcredits)</span>
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Actions ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Link
                    href={`/buyer/rfqs/${rfq.id}/select-winner`}
                    className="text-center p-3 rounded-xl bg-primary-600 hover:bg-primary-700"
                >
                    Select Winner
                </Link>
                <Link
                    href={`/buyer/rfqs/${rfq.id}/fund-escrow`}
                    className="text-center p-3 rounded-xl bg-primary-600 hover:bg-primary-700"
                >
                    Fund Escrow
                </Link>
                <Link
                    href={`/escrow/${rfq.id}`}
                    className="text-center p-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15"
                >
                    View Escrow
                </Link>
            </div>

            <ConfirmDialog
                open={showCloseConfirm}
                title="Close Bidding?"
                description="This is irreversible. Once bidding is closed, vendors can no longer submit bids and the reveal window opens."
                details={[
                    { label: 'RFQ ID', value: rfq.id },
                    { label: 'Bids received', value: String(bids.length) },
                    { label: 'Reveal deadline', value: `Block ${rfq.revealDeadline}` },
                ]}
                confirmLabel="Close Bidding"
                variant="warning"
                loading={closing}
                onConfirm={handleCloseBidding}
                onCancel={() => setShowCloseConfirm(false)}
            />
        </div>
    );
}
