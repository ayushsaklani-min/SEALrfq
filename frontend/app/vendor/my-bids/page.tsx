'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/lib/authFetch';

type Bid = {
    id: string;
    rfqId: string;
    stake: string;
    isRevealed: boolean;
    revealedAmount: string | null;
    createdBlock: number;
    rfqStatus?: string | null;
    revealDeadline?: number | null;
};

export default function VendorMyBidsPage() {
    const router = useRouter();
    const [bids, setBids] = useState<Bid[]>([]);
    const [rfqIdInput, setRfqIdInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [currentRole, setCurrentRole] = useState<string | null>(null);

    useEffect(() => {
        setCurrentRole(localStorage.getItem('role'));
        const load = async () => {
            try {
                const res = await authenticatedFetch('/api/bid/my-bids');
                const text = await res.text();
                let json: any = null;
                try {
                    json = JSON.parse(text);
                } catch {
                    throw new Error('Unexpected non-JSON response from server. Restart frontend/backend dev servers.');
                }
                if (!res.ok) {
                    if (res.status === 403) {
                        setForbidden(true);
                    }
                    throw new Error(json.error?.message || 'Failed to load bids');
                }
                setBids(json.data);
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    if (loading) return <div className="p-8 text-gray-400">Loading bids...</div>;
    if (forbidden) {
        return (
            <div className="max-w-3xl mx-auto py-12 px-4">
                <div className="glass p-6 rounded-2xl border border-red-500/20">
                    <h1 className="text-2xl font-bold mb-3">Vendor Access Required</h1>
                    <p className="text-gray-300 mb-2">
                        This page is only available for wallets with `VENDOR` role.
                    </p>
                    <p className="text-gray-400 mb-5 text-sm">
                        Current role: {currentRole || 'unknown'}
                    </p>
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
    if (error) return <div className="p-8 text-red-400">{error}</div>;

    return (
        <div className="max-w-5xl mx-auto py-10 px-4">
            <h1 className="text-3xl font-bold mb-6">My Bids</h1>

            <div className="glass p-5 rounded-2xl border border-white/10 mb-6">
                <h2 className="text-xl font-semibold mb-3">Submit New Bid</h2>
                <p className="text-sm text-gray-400 mb-4">
                    Enter RFQ ID from the buyer and open the bid submission page.
                </p>
                <div className="flex flex-col md:flex-row gap-3">
                    <input
                        type="text"
                        value={rfqIdInput}
                        onChange={(e) => setRfqIdInput(e.target.value)}
                        placeholder="e.g. 1771260740925field"
                        className="flex-1 p-3 rounded-xl bg-black/40 border border-white/10"
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

            {bids.length === 0 ? (
                <div className="glass p-8 rounded-2xl border border-white/10 text-gray-300">
                    No bids yet.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {bids.map((bid) => (
                        <div key={bid.id} className="glass p-5 rounded-2xl border border-white/10">
                            <p className="text-sm text-gray-400 mb-1">Bid ID: {bid.id}</p>
                            <p className="text-sm text-gray-400 mb-1">RFQ: {bid.rfqId}</p>
                            <p className="text-sm text-gray-200 mb-1">Stake: {bid.stake}</p>
                            <p className="text-sm text-gray-400 mb-1">RFQ Status: {bid.rfqStatus || 'UNKNOWN'}</p>
                            {bid.revealDeadline ? (
                                <p className="text-sm text-gray-400 mb-1">Reveal Deadline: {bid.revealDeadline}</p>
                            ) : null}
                            <p className="text-sm text-gray-200 mb-3">
                                Status: {bid.isRevealed ? 'Revealed' : 'Committed'}
                            </p>
                            {bid.revealedAmount && (
                                <p className="text-sm text-primary-300 mb-3">Amount: {bid.revealedAmount}</p>
                            )}
                            {!bid.isRevealed && (
                                bid.rfqStatus === 'CLOSED' ? (
                                    <button
                                        className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700"
                                        onClick={() => router.push(`/vendor/reveal/${bid.id}`)}
                                    >
                                        Reveal Bid
                                    </button>
                                ) : (
                                    <p className="text-xs text-amber-300">
                                        Reveal locked until buyer closes bidding.
                                    </p>
                                )
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
