'use client';

import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { executeAndReportTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';

type RFQ = {
    id: string;
    status: string;
    winningBidAmount?: string;
    winningVendor?: string;
};

export default function FundEscrowPage({ params }: { params: { id: string } }) {
    const rfqId = params.id;
    const [rfq, setRfq] = useState<RFQ | null>(null);
    const [amount, setAmount] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await authenticatedFetch(`/api/rfq/${rfqId}`);
                const json = await res.json();
                if (!res.ok) {
                    throw new Error(json.error?.message || 'Failed to load RFQ');
                }
                setRfq(json.data);
                if (json.data.winningBidAmount) {
                    setAmount(json.data.winningBidAmount);
                }
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [rfqId]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        setError(null);

        try {
            const value = BigInt(amount);
            const res = await authenticatedFetch(`/api/rfq/${rfqId}/fund-escrow`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ amount: value.toString() }),
            });
            const json = await res.json();
            if (!res.ok) {
                throw new Error(json.error?.message || 'Funding failed');
            }
            await executeAndReportTx(json.data.tx.idempotencyKey, json.data.tx.request);
            setIdempotencyKey(json.data.tx.idempotencyKey);
        } catch (e: any) {
            setError(e.message);
            setSubmitting(false);
        }
    };

    if (loading) return <div className="p-8 text-gray-400">Loading RFQ...</div>;
    if (error && !submitting) return <div className="p-8 text-red-400">{error}</div>;
    if (!rfq) return <div className="p-8 text-red-400">RFQ not found</div>;

    if (idempotencyKey) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-4">Funding Escrow</h1>
                <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} />
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto py-10 px-4">
            <h1 className="text-3xl font-bold mb-6">Fund Escrow</h1>
            <div className="glass p-6 rounded-2xl border border-white/10">
                <p className="text-sm text-gray-400 mb-1">RFQ: {rfq.id}</p>
                <p className="text-sm text-gray-400 mb-4">Status: {rfq.status}</p>

                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <label className="block text-sm mb-2">Escrow Amount</label>
                        <input
                            type="number"
                            className="w-full p-3 rounded-xl bg-black/40 border border-white/10"
                            value={amount}
                            min={rfq.winningBidAmount || '1'}
                            onChange={(e) => setAmount(e.target.value)}
                            required
                        />
                    </div>

                    {error && <div className="text-red-400 text-sm">{error}</div>}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                    >
                        {submitting ? 'Submitting...' : 'Fund Escrow On Testnet'}
                    </button>
                </form>
            </div>
        </div>
    );
}
