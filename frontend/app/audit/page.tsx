'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell, PageHeader, Panel } from '@/components/protocol/ProtocolPrimitives';

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
        <PageShell>
            <PageHeader
                title="Audit Trail"
                description="Enter an RFQ ID to inspect the event trail and export it as CSV."
            />
            <Panel>
                <form onSubmit={openAudit} className="space-y-4">
                    <input
                        type="text"
                        value={rfqId}
                        onChange={(e) => setRfqId(e.target.value)}
                        placeholder="e.g. 1771260740925field"
                        className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-white placeholder:text-[hsl(var(--muted-foreground))]"
                    />
                    <button
                        type="submit"
                        className="w-full rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:opacity-90"
                    >
                        Open Audit View
                    </button>
                </form>
            </Panel>
        </PageShell>
    );
}
