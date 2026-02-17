'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function EscrowDashboardPage() {
    const router = useRouter();
    const [rfqId, setRfqId] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleOpenEscrow = (e: FormEvent) => {
        e.preventDefault();
        const trimmed = rfqId.trim();
        if (!trimmed) {
            setError('Enter an RFQ ID to open escrow.');
            return;
        }
        setError(null);
        router.push(`/escrow/${encodeURIComponent(trimmed)}`);
    };

    return (
        <div className="max-w-3xl mx-auto py-12 px-4">
            <h1 className="text-4xl font-bold font-display mb-4">Escrow Dashboard</h1>
            <p className="text-gray-400 mb-8">
                Open escrow details by RFQ ID. This view shows funded, released, and remaining balances.
            </p>

            <div className="glass p-6 rounded-2xl border border-white/10">
                <form onSubmit={handleOpenEscrow} className="space-y-4">
                    <div>
                        <label htmlFor="rfqId" className="block text-sm text-gray-300 mb-2">
                            RFQ ID
                        </label>
                        <input
                            id="rfqId"
                            type="text"
                            value={rfqId}
                            onChange={(e) => setRfqId(e.target.value)}
                            placeholder="e.g. 1708123456789field"
                            className="w-full p-3 rounded-xl bg-black/40 border border-white/10"
                        />
                    </div>

                    {error && <p className="text-sm text-red-400">{error}</p>}

                    <button
                        type="submit"
                        className="w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-medium"
                    >
                        Open Escrow
                    </button>
                </form>
            </div>
        </div>
    );
}
