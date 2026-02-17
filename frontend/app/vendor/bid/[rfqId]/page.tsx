'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TxStatusView } from '@/components/TxStatus';
import { executeAndReportTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';

interface RFQ {
    id: string;
    status: string;
    biddingDeadline: number;
    revealDeadline: number;
    minBid: string;
    buyer: string;
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
    const [bidAmount, setBidAmount] = useState('');
    const [stake, setStake] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const [nonce, setNonce] = useState<string | null>(null);
    const [bidId, setBidId] = useState<string | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
    const [showNonceSave, setShowNonceSave] = useState(false);

    const minBid = useMemo(() => {
        try {
            return rfq ? BigInt(rfq.minBid) : BigInt(0);
        } catch {
            return BigInt(0);
        }
    }, [rfq]);

    useEffect(() => {
        const fetchRFQ = async () => {
            try {
                const response = await authenticatedFetch(`/api/rfq/${rfqId}`);
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.error?.message || 'Failed to fetch RFQ');
                }

                setRfq(payload.data);
                const recommended = BigInt(payload.data.minBid) / BigInt(10);
                setStake(recommended.toString());
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
            const amount = BigInt(bidAmount);
            const stakeAmount = BigInt(stake);
            if (amount < minBid) {
                throw new Error(`Bid must be at least ${minBid.toString()}`);
            }

            const generatedNonce = generateFieldNonce();
            setNonce(generatedNonce);

            const response = await authenticatedFetch('/api/bid/commit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    rfqId,
                    bidAmount: amount.toString(),
                    nonce: generatedNonce,
                    stake: stakeAmount.toString(),
                }),
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error?.message || 'Bid commit failed');
            }

            await executeAndReportTx(payload.data.tx.idempotencyKey, payload.data.tx.request);
            setBidId(payload.data.bid_id);
            setIdempotencyKey(payload.data.tx.idempotencyKey);
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
            bidAmount,
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
                                    bidAmount,
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
            <div className="glass p-6 rounded-2xl border border-white/10">
                <p className="text-sm text-gray-400 mb-1">RFQ: {rfq.id}</p>
                <p className="text-sm text-gray-400 mb-6">Status: {rfq.status}</p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm mb-2">Bid Amount</label>
                        <input
                            type="number"
                            className="w-full p-3 rounded-xl bg-black/40 border border-white/10"
                            min={minBid.toString()}
                            value={bidAmount}
                            onChange={(e) => setBidAmount(e.target.value)}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm mb-2">Stake Amount</label>
                        <input
                            type="number"
                            className="w-full p-3 rounded-xl bg-black/40 border border-white/10"
                            value={stake}
                            onChange={(e) => setStake(e.target.value)}
                            required
                        />
                    </div>

                    {error && <div className="text-red-400 text-sm">{error}</div>}

                    <button
                        type="submit"
                        disabled={submitting || rfq.status !== 'OPEN'}
                        className="w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                    >
                        {submitting ? 'Submitting...' : 'Commit Bid On Testnet'}
                    </button>
                </form>
            </div>
        </div>
    );
}
