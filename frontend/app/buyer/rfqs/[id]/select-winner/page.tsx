'use client';

import { useEffect, useMemo, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { executeAndReportTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';

type Bid = {
    id: string;
    vendor: string;
    revealedAmount: string | null;
    stake: string;
    isRevealed: boolean;
};

type RFQ = {
    id: string;
    status: string;
    minBid: string;
};

const toBig = (v: string | null | undefined) => BigInt(v || '0');

export default function SelectWinnerPage({ params }: { params: { id: string } }) {
    const rfqId = params.id;
    const [rfq, setRfq] = useState<RFQ | null>(null);
    const [bids, setBids] = useState<Bid[]>([]);
    const [selectedBid, setSelectedBid] = useState<string | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const [rfqRes, bidsRes] = await Promise.all([
                    authenticatedFetch(`/api/rfq/${rfqId}`),
                    authenticatedFetch(`/api/rfq/${rfqId}/bids`),
                ]);
                const [rfqJson, bidsJson] = await Promise.all([rfqRes.json(), bidsRes.json()]);
                if (!rfqRes.ok || !bidsRes.ok) {
                    throw new Error(rfqJson.error?.message || bidsJson.error?.message || 'Load failed');
                }

                setRfq(rfqJson.data);
                setBids(bidsJson.data);
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [rfqId]);

    const revealedSorted = useMemo(() => {
        return bids
            .filter((b) => b.isRevealed)
            .sort((a, b) => {
                const aAmt = toBig(a.revealedAmount);
                const bAmt = toBig(b.revealedAmount);
                if (aAmt < bAmt) return -1;
                if (aAmt > bAmt) return 1;
                return a.id.localeCompare(b.id);
            });
    }, [bids]);

    useEffect(() => {
        if (!selectedBid && revealedSorted.length > 0) {
            setSelectedBid(revealedSorted[0].id);
        }
    }, [revealedSorted, selectedBid]);

    const submitWinner = async () => {
        if (!selectedBid || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await authenticatedFetch(`/api/rfq/${rfqId}/select-winner`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ winningBidId: selectedBid }),
            });
            const json = await res.json();
            if (!res.ok) {
                throw new Error(json.error?.message || 'Select winner failed');
            }
            await executeAndReportTx(json.data.tx.idempotencyKey, json.data.tx.request);
            setIdempotencyKey(json.data.tx.idempotencyKey);
        } catch (e: any) {
            setError(e.message);
            setSubmitting(false);
        }
    };

    if (loading) return <div className="p-8 text-gray-400">Loading bids...</div>;
    if (error) return <div className="p-8 text-red-400">{error}</div>;
    if (!rfq) return <div className="p-8 text-red-400">RFQ not found</div>;

    if (idempotencyKey) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-4">Selecting Winner</h1>
                <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto py-10 px-4">
            <h1 className="text-3xl font-bold mb-2">Select Winner</h1>
            <p className="text-gray-400 mb-6">RFQ: {rfq.id}</p>

            <div className="glass p-6 rounded-2xl border border-white/10">
                <p className="text-sm text-gray-400">Status: {rfq.status}</p>
                <p className="text-sm text-gray-400 mb-4">Min bid: {rfq.minBid}</p>

                {revealedSorted.length === 0 ? (
                    <p className="text-gray-300">No revealed bids yet.</p>
                ) : (
                    <div className="space-y-3">
                        {revealedSorted.map((bid, i) => (
                            <label
                                key={bid.id}
                                className={`block p-4 rounded-xl border cursor-pointer ${
                                    selectedBid === bid.id
                                        ? 'border-primary-500 bg-primary-900/20'
                                        : 'border-white/10 bg-white/5'
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="winner"
                                    checked={selectedBid === bid.id}
                                    onChange={() => setSelectedBid(bid.id)}
                                    className="mr-3"
                                />
                                <span className="font-semibold mr-2">#{i + 1}</span>
                                <span className="mr-2">{toBig(bid.revealedAmount).toString()} credits</span>
                                <span className="text-gray-400">Bid ID: {bid.id}</span>
                            </label>
                        ))}
                    </div>
                )}

                <button
                    className="mt-6 w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                    disabled={!selectedBid || submitting}
                    onClick={submitWinner}
                >
                    {submitting ? 'Submitting...' : 'Confirm Winner'}
                </button>
            </div>
        </div>
    );
}
