'use client';

import { useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/lib/authFetch';
import { useRouter } from 'next/navigation';

type EscrowData = {
    id: string;
    rfqId: string;
    totalAmount: string;
    releasedAmount: string;
    remainingAmount: string;
    payments: Array<{
        id: string;
        amount: string;
        isFinal: boolean;
        releasedAt: string;
        recipient: string;
    }>;
    isReconciled: boolean;
    pendingTx: number;
};

export default function EscrowViewPage({ params }: { params: { rfqId: string } }) {
    const router = useRouter();
    const rfqId = params.rfqId;
    const [escrow, setEscrow] = useState<EscrowData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
        const id = setInterval(load, 5000);
        return () => clearInterval(id);
    }, [rfqId]);

    const invariantOk = useMemo(() => {
        if (!escrow) return true;
        const total = BigInt(escrow.totalAmount);
        const released = BigInt(escrow.releasedAmount);
        const remaining = BigInt(escrow.remainingAmount);
        return total === released + remaining;
    }, [escrow]);

    if (loading) return <div className="p-8 text-gray-400">Loading escrow...</div>;
    if (error) return <div className="p-8 text-red-400">{error}</div>;
    if (!escrow) return <div className="p-8 text-red-400">Escrow not found</div>;

    return (
        <div className="max-w-4xl mx-auto py-10 px-4">
            <h1 className="text-3xl font-bold mb-6">Escrow Overview</h1>
            <div className="glass p-6 rounded-2xl border border-white/10">
                <p className="text-sm text-gray-400 mb-1">RFQ: {escrow.rfqId}</p>
                <p className="text-sm text-gray-400 mb-4">
                    Sync: {escrow.isReconciled ? 'Reconciled' : `Pending (${escrow.pendingTx})`}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="bg-white/5 rounded-xl p-4">
                        <p className="text-xs text-gray-400">Total</p>
                        <p>{escrow.totalAmount}</p>
                    </div>
                    <div className="bg-white/5 rounded-xl p-4">
                        <p className="text-xs text-gray-400">Released</p>
                        <p>{escrow.releasedAmount}</p>
                    </div>
                    <div className="bg-white/5 rounded-xl p-4">
                        <p className="text-xs text-gray-400">Remaining</p>
                        <p>{escrow.remainingAmount}</p>
                    </div>
                </div>

                <p className={`text-sm mb-4 ${invariantOk ? 'text-green-400' : 'text-red-400'}`}>
                    {invariantOk ? 'Invariant OK: total = released + remaining' : 'Invariant mismatch detected'}
                </p>

                <button
                    className="w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700"
                    onClick={() => router.push(`/escrow/${rfqId}/release`)}
                    disabled={BigInt(escrow.remainingAmount) === BigInt(0)}
                >
                    Release Payment
                </button>
            </div>

            <div className="mt-6 glass p-6 rounded-2xl border border-white/10">
                <h2 className="text-xl font-semibold mb-3">Payment History</h2>
                {escrow.payments.length === 0 ? (
                    <p className="text-gray-400">No payments released yet.</p>
                ) : (
                    <div className="space-y-3">
                        {escrow.payments.map((p) => (
                            <div key={p.id} className="p-3 rounded-xl bg-white/5 border border-white/10">
                                <p className="text-sm">Amount: {p.amount}</p>
                                <p className="text-xs text-gray-400">
                                    {p.isFinal ? 'Final' : 'Partial'} to {p.recipient}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
