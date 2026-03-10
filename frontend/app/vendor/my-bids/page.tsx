'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/authFetch';
import { TxStatusView } from '@/components/TxStatus';
import { walletFirstTx } from '@/lib/walletTx';
import ConfirmDialog from '@/components/ConfirmDialog';
import CopyButton from '@/components/CopyButton';
import DeadlineCountdown from '@/components/DeadlineCountdown';

type Bid = {
    id: string;
    rfqId: string;
    stake: string;
    isWinner?: boolean;
    isRevealed: boolean;
    revealedAmount: string | null;
    createdBlock: number;
    rfqStatus?: string | null;
    revealDeadline?: number | null;
    winnerAccepted?: boolean | null;
};

type OpenRfq = {
    id: string;
    status: string;
    minBid: string;
    biddingDeadline: number;
    revealDeadline: number;
    itemName?: string | null;
    description?: string | null;
    quantity?: string | null;
    unit?: string | null;
};

function microToAleo(microcredits: string): string {
    try {
        const n = BigInt(microcredits);
        const whole = n / 1_000_000n;
        const frac = n % 1_000_000n;
        if (frac === 0n) return `${whole} ALEO`;
        const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
        return `${whole}.${fracStr} ALEO`;
    } catch {
        return microcredits;
    }
}

export default function VendorMyBidsPage() {
    const router = useRouter();
    const [bids, setBids] = useState<Bid[]>([]);
    const [openRfqs, setOpenRfqs] = useState<OpenRfq[]>([]);
    const [rfqIdInput, setRfqIdInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [currentRole, setCurrentRole] = useState<string | null>(null);
    const [acceptingBidId, setAcceptingBidId] = useState<string | null>(null);
    const [acceptTxKeys, setAcceptTxKeys] = useState<Record<string, string>>({});
    const [confirmAcceptBid, setConfirmAcceptBid] = useState<Bid | null>(null);

    useEffect(() => {
        setCurrentRole(localStorage.getItem('role'));

        const load = async () => {
            try {
                const [bidsRes, openRfqsRes] = await Promise.all([
                    authenticatedFetch('/api/bid/my-bids'),
                    authenticatedFetch('/api/rfq/open'),
                ]);

                const [bidsJson, openRfqsJson] = await Promise.all([
                    bidsRes.json(),
                    openRfqsRes.json(),
                ]);

                if (!bidsRes.ok) {
                    if (bidsRes.status === 401) {
                        localStorage.removeItem('walletAddress');
                        localStorage.removeItem('role');
                        router.push('/');
                        return;
                    }
                    if (bidsRes.status === 403) {
                        setForbidden(true);
                    }
                    throw new Error(bidsJson?.error?.message || 'Failed to load bids');
                }

                if (!openRfqsRes.ok) {
                    throw new Error(openRfqsJson?.error?.message || 'Failed to load open RFQs');
                }

                setBids(bidsJson.data || []);
                setOpenRfqs(openRfqsJson.data || []);
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [router]);

    const handleAcceptAward = async (bid: Bid) => {
        if (acceptingBidId === bid.id) return;
        setConfirmAcceptBid(null);
        setAcceptingBidId(bid.id);
        setError(null);

        try {
            const result = await walletFirstTx(
                `/api/rfq/${encodeURIComponent(bid.rfqId)}/winner-accept`,
                {},
                (_prepareData, txHash) => ({ txHash }),
            );
            setAcceptTxKeys((prev) => ({ ...prev, [bid.id]: result.idempotencyKey }));
        } catch (e: any) {
            setError(e?.message || 'Failed to accept award');
        } finally {
            setAcceptingBidId((current) => (current === bid.id ? null : current));
        }
    };

    if (loading) return <div className="p-8 text-gray-400">Loading vendor dashboard...</div>;

    if (forbidden) {
        return (
            <div className="max-w-3xl mx-auto py-12 px-4">
                <div className="glass p-6 rounded-2xl border border-red-500/20">
                    <h1 className="text-2xl font-bold mb-3">Vendor Access Required</h1>
                    <p className="text-gray-300 mb-2">This page is only available for wallets with `VENDOR` role.</p>
                    <p className="text-gray-400 mb-5 text-sm">Current role: {currentRole || 'unknown'}</p>
                    <button
                        className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700"
                        onClick={() => router.push('/buyer/rfqs')}
                    >
                        Go To Buyer Dashboard
                    </button>
                </div>
            </div>
        );
    }

    if (error && bids.length === 0 && openRfqs.length === 0) {
        return <div className="p-8 text-red-400">{error}</div>;
    }

    return (
        <div className="max-w-6xl mx-auto py-10 px-4 space-y-6">
            {error ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                    {error}
                </div>
            ) : null}
            <div>
                <h1 className="text-3xl font-bold mb-2">Vendor Dashboard</h1>
                <p className="text-gray-400">
                    Browse open RFQs and manage the bids you have already committed.
                </p>
            </div>

            {/* ── Open RFQs ─────────────────────────────────────── */}
            <div className="glass p-5 rounded-2xl border border-white/10">
                <h2 className="text-xl font-semibold mb-3">Open RFQs</h2>
                <p className="text-sm text-gray-400 mb-4">
                    Browse and bid on live procurement requests below.
                </p>

                {openRfqs.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-gray-300">
                        No open RFQs are available right now.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {openRfqs.map((rfq) => (
                            <div key={rfq.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <div className="min-w-0">
                                        <p className="text-lg font-semibold text-white">
                                            {rfq.itemName || 'Untitled RFQ'}
                                        </p>
                                        <div className="flex items-center gap-1 mt-0.5">
                                            <CopyButton text={rfq.id} />
                                        </div>
                                    </div>
                                    <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                                        {rfq.status}
                                    </span>
                                </div>

                                <div className="space-y-1.5 text-sm text-gray-300 mb-3">
                                    {rfq.quantity && (
                                        <p>Qty: {rfq.quantity}{rfq.unit ? ` ${rfq.unit}` : ''}</p>
                                    )}
                                    <p>Min bid: <span className="text-white font-medium">{microToAleo(rfq.minBid)}</span></p>
                                    {rfq.description && (
                                        <p className="text-gray-400 line-clamp-2">{rfq.description}</p>
                                    )}
                                </div>

                                <div className="mb-3 space-y-2">
                                    <DeadlineCountdown
                                        deadlineBlock={rfq.biddingDeadline}
                                        label="Bidding closes in"
                                        passedLabel="Bidding deadline passed"
                                    />
                                </div>

                                <button
                                    className="w-full px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-sm"
                                    onClick={() => router.push(`/vendor/bid/${encodeURIComponent(rfq.id)}`)}
                                >
                                    Bid On This RFQ
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Open by RFQ ID ───────────────────────────────── */}
            <div className="glass p-5 rounded-2xl border border-white/10">
                <h2 className="text-xl font-semibold mb-3">Open By RFQ ID</h2>
                <p className="text-sm text-gray-400 mb-4">
                    Use this if a buyer shares an RFQ ID directly with you.
                </p>
                <div className="flex flex-col md:flex-row gap-3">
                    <input
                        type="text"
                        value={rfqIdInput}
                        onChange={(e) => setRfqIdInput(e.target.value)}
                        placeholder="e.g. 1773066236219field"
                        className="flex-1 p-3 rounded-xl bg-black/40 border border-white/10 font-mono text-sm"
                    />
                    <button
                        className="px-4 py-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                        disabled={!rfqIdInput.trim()}
                        onClick={() => router.push(`/vendor/bid/${encodeURIComponent(rfqIdInput.trim())}`)}
                    >
                        Open Bid Form
                    </button>
                </div>
            </div>

            {/* ── My Bids ──────────────────────────────────────── */}
            <div className="glass p-5 rounded-2xl border border-white/10">
                <h2 className="text-xl font-semibold mb-3">My Bids</h2>

                {bids.length === 0 ? (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-gray-300">
                        No bids yet.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {bids.map((bid) => (
                            <div key={bid.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                                <div className="space-y-1 mb-3 text-sm">
                                    <div className="flex items-center gap-1 text-gray-400">
                                        <span>Bid ID:</span><CopyButton text={bid.id} />
                                    </div>
                                    <div className="flex items-center gap-1 text-gray-400">
                                        <span>RFQ:</span><CopyButton text={bid.rfqId} />
                                    </div>
                                    <p className="text-gray-200">Stake: {microToAleo(bid.stake)}</p>
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-400">RFQ Status:</span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                                            bid.rfqStatus === 'CLOSED'
                                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                                                : bid.rfqStatus === 'WINNER_SELECTED'
                                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                                  : 'border-white/15 bg-white/5 text-gray-300'
                                        }`}>
                                            {bid.rfqStatus || 'UNKNOWN'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-400">Bid Status:</span>
                                        <span className={bid.isRevealed ? 'text-green-400' : 'text-gray-300'}>
                                            {bid.isRevealed ? 'Revealed' : 'Committed'}
                                        </span>
                                    </div>
                                    {bid.revealedAmount && (
                                        <p className="text-primary-300 font-medium">
                                            Amount: {microToAleo(bid.revealedAmount)}
                                        </p>
                                    )}
                                </div>

                                {/* Reveal countdown */}
                                {bid.revealDeadline && bid.rfqStatus === 'CLOSED' && !bid.isRevealed && (
                                    <div className="mb-3">
                                        <DeadlineCountdown
                                            deadlineBlock={bid.revealDeadline}
                                            label="Reveal closes in"
                                            passedLabel="Reveal deadline passed"
                                        />
                                    </div>
                                )}

                                {/* Winner notice */}
                                {bid.isWinner && bid.rfqStatus === 'WINNER_SELECTED' && (
                                    <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                                        {bid.winnerAccepted
                                            ? 'You accepted this award. The buyer can now fund escrow.'
                                            : acceptTxKeys[bid.id]
                                              ? 'Acceptance submitted — waiting for on-chain confirmation.'
                                              : 'You were selected as the winner! Accept the award to allow the buyer to fund escrow.'}
                                    </div>
                                )}

                                {/* Reveal button */}
                                {!bid.isRevealed &&
                                    (bid.rfqStatus === 'CLOSED' ? (
                                        <button
                                            className="w-full px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-sm"
                                            onClick={() => router.push(`/vendor/reveal/${bid.id}`)}
                                        >
                                            Reveal Bid
                                        </button>
                                    ) : (
                                        <p className="text-xs text-amber-300">
                                            Reveal locked until buyer closes bidding.
                                        </p>
                                    ))}

                                {/* Accept Award button */}
                                {bid.isWinner &&
                                bid.rfqStatus === 'WINNER_SELECTED' &&
                                !bid.winnerAccepted &&
                                !acceptTxKeys[bid.id] ? (
                                    <button
                                        className="w-full px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-sm mt-2"
                                        disabled={acceptingBidId === bid.id}
                                        onClick={() => setConfirmAcceptBid(bid)}
                                    >
                                        {acceptingBidId === bid.id ? 'Submitting...' : 'Accept Award'}
                                    </button>
                                ) : null}

                                {acceptTxKeys[bid.id] ? (
                                    <div className="mt-4">
                                        <TxStatusView idempotencyKey={acceptTxKeys[bid.id]} compact={true} />
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Accept Award confirmation dialog */}
            <ConfirmDialog
                open={confirmAcceptBid !== null}
                title="Accept Award?"
                description="By accepting, you commit to fulfilling this contract. The buyer will then be able to fund the escrow."
                details={confirmAcceptBid ? [
                    { label: 'Bid ID', value: confirmAcceptBid.id },
                    { label: 'RFQ ID', value: confirmAcceptBid.rfqId },
                    { label: 'Your Bid Amount', value: confirmAcceptBid.revealedAmount ? microToAleo(confirmAcceptBid.revealedAmount) : 'N/A' },
                ] : []}
                confirmLabel="Accept Award"
                variant="primary"
                loading={acceptingBidId !== null}
                onConfirm={() => confirmAcceptBid && handleAcceptAward(confirmAcceptBid)}
                onCancel={() => setConfirmAcceptBid(null)}
            />
        </div>
    );
}
