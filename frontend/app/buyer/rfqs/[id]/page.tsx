'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/lib/authFetch';
import { executeAndReportTx } from '@/lib/walletTx';
import { TxStatusView } from '@/components/TxStatus';

type RFQ = {
    id: string;
    buyer: string;
    status: 'OPEN' | 'CLOSED' | 'WINNER_SELECTED' | 'ESCROW_FUNDED' | 'COMPLETED' | string;
    biddingDeadline: number;
    revealDeadline: number;
    minBid: string;
    createdAt?: string;
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

export default function BuyerRFQDetailPage({ params }: { params: { id: string } }) {
    const rfqId = params.id;
    const [rfq, setRfq] = useState<RFQ | null>(null);
    const [bids, setBids] = useState<Bid[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [closing, setClosing] = useState(false);
    const [closeTxKey, setCloseTxKey] = useState<string | null>(null);

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
        setClosing(true);
        setError(null);
        try {
            const res = await authenticatedFetch(`/api/rfq/${rfqId}/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const json = await res.json();
            if (!res.ok) {
                throw new Error(json?.error?.message || 'Failed to close bidding');
            }

            await executeAndReportTx(json.data.tx.idempotencyKey, json.data.tx.request);
            setCloseTxKey(json.data.tx.idempotencyKey);
            setRfq((prev) => (prev ? { ...prev, status: 'CLOSED' } : prev));
        } catch (e: any) {
            setError(e?.message || 'Failed to close bidding');
            setClosing(false);
        }
    };

    if (loading) return <div className="max-w-5xl mx-auto p-8 text-gray-400">Loading RFQ...</div>;
    if (error) return <div className="max-w-5xl mx-auto p-8 text-red-400">{error}</div>;
    if (!rfq) return <div className="max-w-5xl mx-auto p-8 text-red-400">RFQ not found</div>;

    return (
        <div className="max-w-5xl mx-auto py-10 px-4">
            <div className="flex items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-3xl font-bold">RFQ Details</h1>
                    <p className="text-gray-400 text-sm mt-1">ID: {rfq.id}</p>
                </div>
                <span className="px-3 py-1 rounded-full text-sm border border-white/15 bg-white/5">
                    {rfq.status}
                </span>
            </div>

            <div className="glass p-6 rounded-2xl border border-white/10 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                        <div className="text-gray-400">Buyer</div>
                        <div className="break-all">{rfq.buyer}</div>
                    </div>
                    <div>
                        <div className="text-gray-400">Minimum Bid</div>
                        <div>{rfq.minBid}</div>
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

            <div className="glass p-6 rounded-2xl border border-white/10 mb-6">
                <h2 className="text-xl font-semibold mb-3">Bidding Control</h2>
                <p className="text-sm text-gray-400 mb-4">
                    Close bidding to open the vendor reveal window.
                </p>
                <button
                    onClick={handleCloseBidding}
                    disabled={rfq.status !== 'OPEN' || closing}
                    className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {closing ? 'Submitting...' : rfq.status === 'OPEN' ? 'Close Bidding' : 'Bidding Closed'}
                </button>
                {closeTxKey && (
                    <div className="mt-4">
                        <TxStatusView idempotencyKey={closeTxKey} showHistory={true} compact={true} />
                    </div>
                )}
            </div>

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
                                <p className="text-sm text-gray-300">Bid ID: {bid.id}</p>
                                <p className="text-sm text-gray-300">Vendor: {bid.vendor}</p>
                                <p className="text-sm text-gray-300">
                                    Status: {bid.isRevealed ? 'Revealed' : 'Committed'}
                                    {bid.isWinner ? ' (Winner)' : ''}
                                </p>
                                {bid.revealedAmount && (
                                    <p className="text-sm text-primary-300">Amount: {bid.revealedAmount}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

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
        </div>
    );
}
