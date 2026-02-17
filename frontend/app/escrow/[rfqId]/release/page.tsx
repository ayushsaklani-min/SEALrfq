'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TxStatusView } from '@/components/TxStatus';
import { executeAndReportTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';

type EscrowResponse = {
    id: string;
    rfqId: string;
    totalAmount: string;
    releasedAmount: string;
    remainingAmount: string;
    payments: Array<{ id: string; amount: string; isFinal: boolean }>;
};

export default function ReleasePaymentPage({ params }: { params: { rfqId: string } }) {
    const router = useRouter();
    const rfqId = params.rfqId;

    const [escrow, setEscrow] = useState<EscrowResponse | null>(null);
    const [amount, setAmount] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await authenticatedFetch(`/api/escrow/${rfqId}`);
                const json = await res.json();
                if (!res.ok) {
                    throw new Error(json.error?.message || 'Failed to load escrow');
                }
                setEscrow(json.data);
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [rfqId]);

    const remaining = useMemo(() => BigInt(escrow?.remainingAmount || '0'), [escrow]);
    const released = useMemo(() => BigInt(escrow?.releasedAmount || '0'), [escrow]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const value = BigInt(amount);
            if (value <= BigInt(0) || value > remaining) {
                throw new Error(`Amount must be between 1 and ${remaining.toString()}`);
            }

            const res = await authenticatedFetch(`/api/escrow/${rfqId}/release`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ amount: value.toString() }),
            });
            const json = await res.json();
            if (!res.ok) {
                throw new Error(json.error?.message || 'Release failed');
            }
            await executeAndReportTx(json.data.tx.idempotencyKey, json.data.tx.request);
            setIdempotencyKey(json.data.tx.idempotencyKey);
        } catch (e: any) {
            setError(e.message);
            setSubmitting(false);
        }
    };

    if (loading) return <div className="p-8 text-gray-400">Loading escrow...</div>;
    if (error && !submitting) return <div className="p-8 text-red-400">{error}</div>;
    if (!escrow) return <div className="p-8 text-red-400">Escrow not found</div>;

    if (idempotencyKey) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-4">Releasing Payment</h1>
                <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} />
                <button
                    className="mt-6 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20"
                    onClick={() => router.push(`/escrow/${rfqId}`)}
                >
                    Back To Escrow
                </button>
            </div>
        );
    }

    const entered = amount ? BigInt(amount) : BigInt(0);
    const nextReleased = released + entered;
    const nextRemaining = remaining - entered;

    return (
        <div className="max-w-3xl mx-auto py-10 px-4">
            <h1 className="text-3xl font-bold mb-6">Release Payment</h1>
            <div className="glass p-6 rounded-2xl border border-white/10">
                <p className="text-sm text-gray-400 mb-1">RFQ: {escrow.rfqId}</p>
                <p className="text-sm text-gray-400 mb-4">Remaining: {remaining.toString()} credits</p>

                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <label className="block text-sm mb-2">Amount to release</label>
                        <input
                            type="number"
                            className="w-full p-3 rounded-xl bg-black/40 border border-white/10"
                            min="1"
                            max={remaining.toString()}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            required
                        />
                    </div>

                    <div className="text-sm text-gray-300 bg-white/5 p-3 rounded-xl">
                        <p>After release:</p>
                        <p>Released: {nextReleased.toString()}</p>
                        <p>Remaining: {nextRemaining.toString()}</p>
                    </div>

                    {error && <div className="text-red-400 text-sm">{error}</div>}

                    <button
                        type="submit"
                        disabled={submitting || !amount}
                        className="w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                    >
                        {submitting ? 'Submitting...' : 'Release On Testnet'}
                    </button>
                </form>
            </div>
        </div>
    );
}
