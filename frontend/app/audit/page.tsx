'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AuditHomePage() {
    const router = useRouter();
    const [rfqId, setRfqId] = useState('');

    const openAudit = (e: FormEvent) => {
        e.preventDefault();
        const value = rfqId.trim();
        if (!value) return;
        router.push(`/audit/${encodeURIComponent(value)}`);
    };

    return (
        <div className="max-w-3xl mx-auto py-12 px-4">
            <h1 className="text-4xl font-bold mb-4">Audit Trail</h1>
            <p className="text-gray-400 mb-6">
                Enter an RFQ ID to inspect the event trail and export it as CSV.
            </p>
            <div className="glass p-6 rounded-2xl border border-white/10">
                <form onSubmit={openAudit} className="space-y-4">
                    <input
                        type="text"
                        value={rfqId}
                        onChange={(e) => setRfqId(e.target.value)}
                        placeholder="e.g. 1771260740925field"
                        className="w-full p-3 rounded-xl bg-black/40 border border-white/10"
                    />
                    <button className="w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700">
                        Open Audit View
                    </button>
                </form>
            </div>
        </div>
    );
}
