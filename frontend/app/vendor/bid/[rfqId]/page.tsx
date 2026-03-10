'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TxStatusView } from '@/components/TxStatus';
import { walletFirstTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';

interface RFQ {
    id: string;
    status: string;
    biddingDeadline: number;
    revealDeadline: number;
    minBid: string;
    buyer: string;
    // Product details
    itemName?: string;
    description?: string;
    quantity?: string;
    unit?: string;
    metadataHash?: string;
}

/** Convert microcredits bigint/string to ALEO display string. */
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

/** Parse ALEO string to microcredits bigint. Returns null on invalid input. */
function aleoToMicro(aleo: string): bigint | null {
    const n = parseFloat(aleo);
    if (!Number.isFinite(n) || n <= 0) return null;
    return BigInt(Math.round(n * 1_000_000));
}

function generateFieldNonce(): string {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const num = BigInt(`0x${hex}`);
    return `${num.toString()}field`;
}

function downloadNonceBundle(payload: {
    bidId: string;
    rfqId: string;
    bidAmount: string;
    nonce: string;
    savedAt: string;
}) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sealrfq_nonce_${payload.bidId}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

export default function SubmitBidPage({ params }: { params: { rfqId: string } }) {
    const router = useRouter();
    const rfqId = params.rfqId;

    const [rfq, setRfq] = useState<RFQ | null>(null);

    // bidAmount and stake are in ALEO (e.g. "50"), converted to microcredits on submit
    const [bidAmount, setBidAmount] = useState('');
    const [stake, setStake] = useState('');

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const [nonce, setNonce] = useState<string | null>(null);
    const [bidId, setBidId] = useState<string | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
    const [showNonceSave, setShowNonceSave] = useState(false);

    const minBidMicro = useMemo(() => {
        try {
            return rfq ? BigInt(rfq.minBid) : 0n;
        } catch {
            return 0n;
        }
    }, [rfq]);
    const flatStakeMicro = useMemo(() => (minBidMicro * 10n) / 100n, [minBidMicro]);

    const bidAmountMicro = useMemo(() => aleoToMicro(bidAmount), [bidAmount]);
    const stakeMicro = useMemo(() => aleoToMicro(stake), [stake]);

    useEffect(() => {
        const fetchRFQ = async () => {
            try {
                const response = await authenticatedFetch(`/api/rfq/${rfqId}`);
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.error?.message || 'Failed to fetch RFQ');
                }

                setRfq(payload.data);

                // The contract requires a flat stake derived from the RFQ minimum bid.
                const minMicro = BigInt(payload.data.minBid);
                const requiredStakeMicro = minMicro / 10n;
                const requiredStakeAleo = Number(requiredStakeMicro) / 1_000_000;
                setStake(requiredStakeAleo > 0 ? requiredStakeAleo.toString() : '0.000001');
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };

        fetchRFQ();
    }, [rfqId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting || !rfq) return;

        if (rfq.status !== 'OPEN') {
            setError(`RFQ is in ${rfq.status} state; bids are closed.`);
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            if (!bidAmountMicro) throw new Error('Enter a valid bid amount in ALEO');
            if (flatStakeMicro <= 0n) throw new Error('RFQ flat stake is invalid');

            if (bidAmountMicro < minBidMicro) {
                throw new Error(`Bid must be at least ${microToAleo(minBidMicro)} (${minBidMicro.toLocaleString()} microcredits)`);
            }

            const generatedNonce = generateFieldNonce();
            setNonce(generatedNonce);

            const prepareBody = {
                rfqId,
                bidAmount: bidAmountMicro.toString(),
                nonce: generatedNonce,
                stake: flatStakeMicro.toString(),
            };

            const result = await walletFirstTx(
                '/api/bid/commit',
                prepareBody,
                (prepareData, txHash) => ({
                    ...prepareBody,
                    txHash,
                    bidId: prepareData.bid_id,
                }),
            );

            setBidId(result.data.bid_id);
            setIdempotencyKey(result.idempotencyKey);
            setShowNonceSave(true);
        } catch (e: any) {
            setError(e.message);
            setSubmitting(false);
        }
    };

    const persistNonce = () => {
        if (!nonce || !bidId) return;
        const payload = {
            bidId,
            rfqId,
            nonce,
            bidAmount: bidAmountMicro?.toString() ?? bidAmount,
            savedAt: new Date().toISOString(),
        };
        localStorage.setItem(`bid_nonce_${bidId}`, JSON.stringify(payload));
        setShowNonceSave(false);
    };

    if (loading) {
        return <div className="p-8 text-gray-400">Loading RFQ...</div>;
    }

    if (showNonceSave && nonce) {
        return (
            <div className="max-w-2xl mx-auto py-10 px-4">
                <div className="glass p-8 rounded-2xl border border-amber-500/30">
                    <h1 className="text-2xl font-bold mb-4">Save Your Nonce</h1>
                    <p className="text-sm text-gray-300 mb-4">
                        You need this nonce to reveal your bid later. If you lose it, you cannot reveal.
                    </p>
                    <code className="block p-4 rounded-xl bg-black/40 break-all text-amber-300 mb-4">{nonce}</code>
                    <div className="flex gap-3">
                        <button
                            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20"
                            onClick={() => navigator.clipboard.writeText(nonce)}
                        >
                            Copy
                        </button>
                        <button
                            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20"
                            onClick={() => {
                                if (!nonce || !bidId) return;
                                downloadNonceBundle({
                                    bidId,
                                    rfqId,
                                    nonce,
                                    bidAmount: bidAmountMicro?.toString() ?? bidAmount,
                                    savedAt: new Date().toISOString(),
                                });
                            }}
                        >
                            Export Nonce Bundle
                        </button>
                        <button
                            className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700"
                            onClick={persistNonce}
                        >
                            I Saved It
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (idempotencyKey) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-4">Submitting Bid</h1>
                <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} />
                {bidId && (
                    <button
                        className="mt-6 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20"
                        onClick={() => router.push(`/vendor/reveal/${bidId}`)}
                    >
                        Go To Reveal Page
                    </button>
                )}
            </div>
        );
    }

    if (!rfq) {
        return <div className="p-8 text-red-400">RFQ not found</div>;
    }

    return (
        <div className="max-w-3xl mx-auto py-10 px-4">
            <h1 className="text-3xl font-bold mb-6">Submit Sealed Bid</h1>

            {/* ── Product Card ────────────────────────────────────── */}
            {(rfq.itemName || rfq.quantity) && (
                <div className="glass p-5 rounded-2xl border border-white/10 mb-6">
                    <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">What you&apos;re bidding on</h2>
                    {rfq.itemName && (
                        <p className="text-xl font-bold text-white mb-1">{rfq.itemName}</p>
                    )}
                    {rfq.quantity && (
                        <p className="text-gray-300 text-sm mb-2">
                            Quantity: <span className="text-white font-medium">{rfq.quantity}{rfq.unit ? ` ${rfq.unit}` : ''}</span>
                        </p>
                    )}
                    {rfq.description && (
                        <p className="text-gray-400 text-sm leading-relaxed">{rfq.description}</p>
                    )}
                    <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-4 text-xs text-gray-500">
                        <span>Min bid: <span className="text-primary-300 font-medium">{microToAleo(rfq.minBid)}</span></span>
                        <span>Buyer: {rfq.buyer.slice(0, 12)}…</span>
                    </div>
                </div>
            )}

            {/* ── Bid Form ────────────────────────────────────────── */}
            <div className="glass p-6 rounded-2xl border border-white/10">
                <p className="text-sm text-gray-400 mb-1">RFQ: {rfq.id}</p>
                <p className="text-sm text-gray-400 mb-6">Status: {rfq.status}</p>

                <form onSubmit={handleSubmit} className="space-y-5">

                    {/* Bid Amount */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Bid Amount <span className="text-gray-500">(ALEO)</span>
                        </label>
                        <div className="relative">
                            <input
                                type="number"
                                className="w-full p-3 pr-16 rounded-xl bg-black/40 border border-white/10 text-white"
                                min={Number(minBidMicro) / 1_000_000}
                                step="any"
                                value={bidAmount}
                                onChange={(e) => setBidAmount(e.target.value)}
                                placeholder={`min ${microToAleo(minBidMicro)}`}
                                required
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">ALEO</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            {bidAmountMicro
                                ? `= ${bidAmountMicro.toLocaleString()} microcredits`
                                : `Minimum: ${microToAleo(minBidMicro)} (${minBidMicro.toLocaleString()} microcredits)`}
                        </p>
                    </div>

                    {/* Stake Amount */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Stake Amount <span className="text-gray-500">(ALEO) — recommended 10% of your bid</span>
                        </label>
                        <div className="relative">
                            <input
                                type="number"
                                className="w-full p-3 pr-16 rounded-xl bg-black/40 border border-white/10 text-white"
                                step="any"
                                min="0.000001"
                                value={stake}
                                readOnly
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">ALEO</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            {flatStakeMicro > 0n
                                ? `Required flat stake: ${flatStakeMicro.toLocaleString()} microcredits`
                                : 'Stake is slashed if you fail to reveal'}
                        </p>
                    </div>

                    {error && <div className="text-red-400 text-sm">{error}</div>}

                    <button
                        type="submit"
                        disabled={submitting || rfq.status !== 'OPEN'}
                        className="w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 font-medium"
                    >
                        {submitting ? 'Submitting…' : 'Commit Sealed Bid on Testnet'}
                    </button>
                </form>
            </div>
        </div>
    );
}
