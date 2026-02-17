'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/authFetch';

type RFQ = {
    id: string;
    status: string;
    minBid: string;
    biddingDeadline: number;
    revealDeadline: number;
    createdAt?: string;
};

function formatDeadline(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '-';
    if (value >= 1_000_000_000) return new Date(value * 1000).toLocaleString();
    return `Block ${value}`;
}

export default function BuyerRfqHomePage() {
    const router = useRouter();
    const [rfqId, setRfqId] = useState('');
    const [rfqs, setRfqs] = useState<RFQ[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await authenticatedFetch('/api/rfq/my-rfqs');
                const json = await res.json();
                if (!res.ok) {
                    throw new Error(json?.error?.message || 'Failed to load RFQs');
                }
                setRfqs(json.data || []);
            } catch (e: any) {
                setError(e?.message || 'Failed to load RFQs');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const openCount = useMemo(() => rfqs.filter((r) => r.status === 'OPEN').length, [rfqs]);

    const openRfq = (e: FormEvent) => {
        e.preventDefault();
        const value = rfqId.trim();
        if (!value) return;
        router.push(`/buyer/rfqs/${encodeURIComponent(value)}`);
    };

    return (
        <div className="max-w-3xl mx-auto py-12 px-4">
            <div className="flex items-center justify-between gap-4 mb-6">
                <h1 className="text-4xl font-bold">Buyer RFQs</h1>
                <Link href="/buyer/create-rfq" className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700">
                    Create RFQ
                </Link>
            </div>
            <p className="text-gray-400 mb-3">Your RFQs: {rfqs.length} total, {openCount} open</p>

            <div className="glass p-6 rounded-2xl border border-white/10 mb-6">
                <h2 className="text-xl font-semibold mb-3">My RFQs</h2>
                {loading ? (
                    <p className="text-gray-400">Loading RFQs...</p>
                ) : error ? (
                    <p className="text-red-400">{error}</p>
                ) : rfqs.length === 0 ? (
                    <p className="text-gray-400">No RFQs created yet.</p>
                ) : (
                    <div className="space-y-3">
                        {rfqs.map((rfq) => (
                            <div
                                key={rfq.id}
                                className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                            >
                                <div className="text-sm">
                                    <p className="text-gray-300">ID: {rfq.id}</p>
                                    <p className="text-gray-400">Status: {rfq.status}</p>
                                    <p className="text-gray-400">Min bid: {rfq.minBid}</p>
                                    <p className="text-gray-400">Bidding deadline: {formatDeadline(rfq.biddingDeadline)}</p>
                                </div>
                                <Link
                                    href={`/buyer/rfqs/${encodeURIComponent(rfq.id)}`}
                                    className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-center"
                                >
                                    View
                                </Link>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="glass p-6 rounded-2xl border border-white/10">
                <h2 className="text-xl font-semibold mb-3">Open By RFQ ID</h2>
                <form onSubmit={openRfq} className="space-y-4">
                    <input
                        type="text"
                        value={rfqId}
                        onChange={(e) => setRfqId(e.target.value)}
                        placeholder="e.g. 1771260740925field"
                        className="w-full p-3 rounded-xl bg-black/40 border border-white/10"
                    />
                    <button className="w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700">
                        Open RFQ
                    </button>
                </form>
            </div>
        </div>
    );
}
