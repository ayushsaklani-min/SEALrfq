'use client';

import { useEffect, useMemo, useState } from 'react';

type AuditEvent = {
    id: string;
    eventType: string;
    txId: string;
    blockHeight: number;
    eventVersion: number;
    processedAt: string;
    rfqId?: string;
    transition?: string;
    eventData?: any;
};

function short(value?: string, n = 12): string {
    if (!value) return '-';
    if (value.length <= n) return value;
    return `${value.substring(0, n)}...`;
}

function toCsv(events: AuditEvent[]): string {
    const header = ['block_height', 'processed_at', 'event_type', 'tx_id', 'event_version', 'rfq_id', 'transition'];
    const rows = events.map((e) => [
        e.blockHeight,
        e.processedAt,
        e.eventType,
        e.txId,
        e.eventVersion,
        e.rfqId || '',
        e.transition || '',
    ]);
    return [header, ...rows].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
}

export default function AuditTrailPage({ params }: { params: { rfqId?: string } }) {
    const rfqId = params.rfqId;

    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterEventType, setFilterEventType] = useState<string>('ALL');

    useEffect(() => {
        const fetchAuditTrail = async () => {
            try {
                const q = new URLSearchParams();
                if (rfqId) q.append('rfqId', rfqId);
                if (filterEventType !== 'ALL') q.append('eventType', filterEventType);

                const response = await fetch(`/api/audit/trail?${q.toString()}`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
                });

                const json = await response.json();
                if (!response.ok) {
                    throw new Error(json?.error?.message || 'Failed to fetch audit trail');
                }

                setEvents(json.data || []);
            } catch (err: any) {
                setError(err?.message || 'Failed to fetch audit trail');
            } finally {
                setLoading(false);
            }
        };

        fetchAuditTrail();
    }, [rfqId, filterEventType]);

    const eventTypes = useMemo(() => {
        const base = ['ALL'];
        const dynamic = Array.from(new Set(events.map((e) => e.eventType).filter(Boolean))).sort();
        return [...base, ...dynamic];
    }, [events]);

    const exportCsv = () => {
        const csv = toCsv(events);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit_trail_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) return <div className="max-w-6xl mx-auto p-8 text-gray-400">Loading audit trail...</div>;
    if (error) return <div className="max-w-6xl mx-auto p-8 text-red-400">Error: {error}</div>;

    return (
        <div className="max-w-6xl mx-auto py-10 px-4">
            <div className="flex items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Audit Trail</h1>
                    <p className="text-gray-400 text-sm">{rfqId ? `RFQ ${rfqId}` : 'All RFQs'}</p>
                </div>
                <button
                    onClick={exportCsv}
                    className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700"
                >
                    Export CSV
                </button>
            </div>

            <div className="glass p-4 rounded-2xl border border-white/10 mb-4 flex items-center gap-3">
                <label className="text-sm text-gray-300">Event Type</label>
                <select
                    value={filterEventType}
                    onChange={(e) => setFilterEventType(e.target.value)}
                    className="bg-black/40 border border-white/10 rounded-lg px-3 py-2"
                >
                    {eventTypes.map((type) => (
                        <option key={type} value={type}>
                            {type}
                        </option>
                    ))}
                </select>
            </div>

            <div className="glass rounded-2xl border border-white/10 overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                    <thead className="bg-white/5">
                        <tr className="text-left">
                            <th className="p-3">Block</th>
                            <th className="p-3">Processed</th>
                            <th className="p-3">Event Type</th>
                            <th className="p-3">Transition</th>
                            <th className="p-3">Tx</th>
                            <th className="p-3">Version</th>
                            <th className="p-3">RFQ</th>
                        </tr>
                    </thead>
                    <tbody>
                        {events.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="p-4 text-gray-400">
                                    No events found.
                                </td>
                            </tr>
                        ) : (
                            events.map((event) => (
                                <tr key={event.id} className="border-t border-white/5">
                                    <td className="p-3">{event.blockHeight}</td>
                                    <td className="p-3">{new Date(event.processedAt).toLocaleString()}</td>
                                    <td className="p-3">{event.eventType}</td>
                                    <td className="p-3">{event.transition || '-'}</td>
                                    <td className="p-3">
                                        <a
                                            href={`https://explorer.aleo.org/transaction/${event.txId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary-300 hover:text-primary-200"
                                        >
                                            {short(event.txId)}
                                        </a>
                                    </td>
                                    <td className="p-3">{event.eventVersion}</td>
                                    <td className="p-3">{short(event.rfqId, 18)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
