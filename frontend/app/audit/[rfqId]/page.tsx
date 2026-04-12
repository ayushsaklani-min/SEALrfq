'use client';

import { useEffect, useMemo, useState } from 'react';
import { CounterpartyProfileCard, type BuyerProfileSummary, type VendorProfileSummary } from '@/components/CounterpartyProfileCard';
import { DeliveryMilestoneCard } from '@/components/DeliveryMilestoneCard';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyInlineButton,
    CopyableText,
    DataGrid,
    DataPoint,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    SelectInput,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { type DeliveryMilestone, type DeliverySummary } from '@/lib/deliveryAssurance';
import { analyzeWinnerSelection, buildProcurementPacketMarkdown } from '@/lib/procurementIntelligence';
import { formatAmount, pricingLabel, STATUS_LABELS, tokenLabel } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';

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

type AuditRfqDetail = {
    id: string;
    buyer: string;
    itemName?: string | null;
    description?: string | null;
    status: string;
    tokenType: number;
    pricingMode: number;
    biddingDeadline: number;
    revealDeadline: number;
    winningVendor?: string | null;
    winningBidId?: string | null;
    winningBidAmount?: string | null;
    winnerAccepted?: boolean;
    paid?: boolean;
    buyerProfile?: BuyerProfileSummary | null;
};

type AuditBid = {
    id: string;
    vendor: string;
    isRevealed: boolean;
    isWinner?: boolean;
    revealedAmount?: string | null;
    vendorProfile?: VendorProfileSummary | null;
};

type AuditMilestonePayload = {
    milestones: DeliveryMilestone[];
    summary: DeliverySummary;
};

function short(value?: string, n = 12): string {
    if (!value) return '-';
    if (value.length <= n) return value;
    return `${value.substring(0, n)}...`;
}

function isExplorerTx(value?: string): boolean {
    return Boolean(value && value.startsWith('at1'));
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
    const [rfq, setRfq] = useState<AuditRfqDetail | null>(null);
    const [bids, setBids] = useState<AuditBid[]>([]);
    const [milestonePayload, setMilestonePayload] = useState<AuditMilestonePayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filterEventType, setFilterEventType] = useState<string>('ALL');

    useEffect(() => {
        const fetchAuditTrail = async () => {
            try {
                const q = new URLSearchParams();
                if (rfqId) q.append('rfqId', rfqId);
                if (filterEventType !== 'ALL') q.append('eventType', filterEventType);

                const response = await authenticatedFetch(`/api/audit/trail?${q.toString()}`);

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

    useEffect(() => {
        if (!rfqId) return;

        let cancelled = false;

        const fetchPacketData = async () => {
            try {
                const [rfqResponse, bidsResponse, milestonesResponse] = await Promise.all([
                    authenticatedFetch(`/api/rfq/${rfqId}`),
                    authenticatedFetch(`/api/rfq/${rfqId}/bids`),
                    authenticatedFetch(`/api/escrow/${rfqId}/milestones`),
                ]);
                const rfqJson = await rfqResponse.json();
                const bidsJson = await bidsResponse.json().catch(() => ({ data: [] }));
                const milestonesJson = await milestonesResponse.json().catch(() => ({ data: { milestones: [], summary: null } }));

                if (!rfqResponse.ok) {
                    throw new Error(rfqJson?.error?.message || 'Failed to fetch RFQ packet context');
                }

                if (!cancelled) {
                    setRfq(rfqJson.data || null);
                    setBids(bidsJson.data || []);
                    setMilestonePayload(milestonesJson.data || null);
                }
            } catch (err: any) {
                if (!cancelled) {
                    setError(err?.message || 'Failed to fetch procurement packet context');
                }
            }
        };

        fetchPacketData();
        return () => {
            cancelled = true;
        };
    }, [rfqId]);

    const eventTypes = useMemo(() => {
        const base = ['ALL'];
        const dynamic = Array.from(new Set(events.map((e) => e.eventType).filter(Boolean))).sort();
        return [...base, ...dynamic];
    }, [events]);

    const decision = useMemo(() => analyzeWinnerSelection(bids), [bids]);
    const winningBidProfile = useMemo(() => bids.find((bid) => bid.isWinner)?.vendorProfile ?? null, [bids]);

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

    const exportPacket = () => {
        if (!rfq) return;
        const markdown = buildProcurementPacketMarkdown({ rfq, events, milestones: milestonePayload?.milestones || [], decision });
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sealrfq_procurement_packet_${rfq.id}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading audit trail">
                    <div className="text-sm text-white/55">Fetching indexed events and filters.</div>
                </Panel>
            </PageShell>
        );
    }

    if (error) {
        return (
            <PageShell>
                <Notice tone="danger">{error}</Notice>
            </PageShell>
        );
    }

    const latestBlock = events.reduce((max, event) => Math.max(max, event.blockHeight || 0), 0);

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Audit"
                title="Audit trail"
                description={rfqId ? `Indexed event history for RFQ ${rfqId}.` : 'Indexed event history for all RFQs.'}
                actions={
                    <ActionBar>
                        {rfqId ? <CopyableText value={rfqId} displayValue={truncateMiddle(rfqId, 16, 10)} /> : null}
                        {rfq ? (
                            <Button onClick={exportPacket} disabled={events.length === 0}>
                                Export packet
                            </Button>
                        ) : null}
                        <Button variant="secondary" onClick={exportCsv} disabled={events.length === 0}>
                            Export CSV
                        </Button>
                    </ActionBar>
                }
            />

            <DataGrid columns={3}>
                <DataPoint label="Events" value={events.length} />
                <DataPoint label="Event types" value={eventTypes.length - 1} />
                <DataPoint label="Latest block" value={latestBlock || '--'} />
            </DataGrid>

            {rfq ? (
                <Panel title="Procurement packet" subtitle="A judge-facing summary of counterparties, decision quality, and settlement evidence.">
                    <Notice tone={decision.recommendedBid?.riskLevel === 'low' ? 'success' : 'warning'} title="Packet summary">
                        {decision.recommendedSummary}
                    </Notice>
                    <div className="mt-4">
                        <DataGrid columns={4}>
                            <DataPoint label="Status" value={STATUS_LABELS[rfq.status] || rfq.status} />
                            <DataPoint label="Pricing" value={pricingLabel(rfq.pricingMode)} />
                            <DataPoint label="Token" value={tokenLabel(rfq.tokenType)} />
                            <DataPoint label="Winning bid" value={rfq.winningBidAmount ? formatAmount(rfq.winningBidAmount, rfq.tokenType) : '--'} />
                        </DataGrid>
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <CounterpartyProfileCard title="Buyer scorecard" profile={rfq.buyerProfile} compact />
                        <CounterpartyProfileCard title="Winning supplier" profile={winningBidProfile} compact />
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-emerald-200/20 bg-emerald-400/[0.06] p-4">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/70">Decision basis</div>
                            <div className="mt-2 space-y-2 text-sm leading-6 text-emerald-50/90">
                                {decision.decisionReasons.length ? decision.decisionReasons.map((reason) => <div key={reason}>• {reason}</div>) : <div>• No ranked supplier recommendation yet.</div>}
                            </div>
                        </div>
                        <div className="rounded-xl border border-amber-200/20 bg-amber-400/[0.06] p-4">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/70">Packet watchouts</div>
                            <div className="mt-2 space-y-2 text-sm leading-6 text-amber-50/90">
                                {decision.procurementWarnings.length ? decision.procurementWarnings.map((warning) => <div key={warning}>• {warning}</div>) : <div>• No major indexed procurement warnings.</div>}
                            </div>
                        </div>
                    </div>
                    {milestonePayload ? (
                        <div className="mt-4 space-y-3">
                            <DataGrid columns={4}>
                                <DataPoint label="Milestones" value={milestonePayload.summary?.milestoneCount ?? 0} />
                                <DataPoint label="Submitted" value={milestonePayload.summary?.submittedCount ?? 0} />
                                <DataPoint label="Approved" value={milestonePayload.summary?.approvedCount ?? 0} />
                                <DataPoint label="Released" value={milestonePayload.summary?.releasedCount ?? 0} />
                            </DataGrid>
                            {milestonePayload.milestones.length ? (
                                <div className="space-y-3">
                                    {milestonePayload.milestones.map((milestone) => (
                                        <DeliveryMilestoneCard key={milestone.id} milestone={milestone} tokenType={rfq.tokenType} />
                                    ))}
                                </div>
                            ) : (
                                <div className="text-sm text-white/55">No delivery milestones were configured for this RFQ.</div>
                            )}
                        </div>
                    ) : null}
                </Panel>
            ) : null}

            <Panel title="Filters" subtitle="Narrow the event table before exporting.">
                <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_1fr]">
                    <Field label="Event type">
                        <SelectInput value={filterEventType} onChange={(e) => setFilterEventType(e.target.value)}>
                            {eventTypes.map((type) => (
                                <option key={type} value={type}>
                                    {type}
                                </option>
                            ))}
                        </SelectInput>
                    </Field>
                    <Notice title="Scope">{rfqId ? 'Showing one RFQ audit trail.' : 'Showing all indexed audit events.'}</Notice>
                </div>
            </Panel>

            <Panel title="Events" subtitle="Every processed event is timestamped and exportable.">
                {events.length === 0 ? (
                    <div className="text-sm text-white/55">No events found for the current filter set.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-[980px] w-full text-sm">
                            <thead className="bg-white/[0.04]">
                                <tr className="text-left text-white/50">
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Block</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Processed</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Event type</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Transition</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Tx</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Version</th>
                                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">RFQ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {events.map((event) => (
                                    <tr key={event.id} className="border-t border-white/[0.06] align-top transition hover:bg-white/[0.03]">
                                        <td className="px-4 py-3 font-medium text-white">{event.blockHeight}</td>
                                        <td className="px-4 py-3 text-white/55">{new Date(event.processedAt).toLocaleString()}</td>
                                        <td className="px-4 py-3 font-medium text-white">{event.eventType}</td>
                                        <td className="px-4 py-3 text-white/60">{event.transition || '-'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                {isExplorerTx(event.txId) ? (
                                                    <a
                                                        href={`https://testnet.explorer.provable.com/transaction/${event.txId}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="font-mono text-[13px] text-emerald-300 hover:underline"
                                                    >
                                                        {short(event.txId, 18)}
                                                    </a>
                                                ) : (
                                                    <span className="font-mono text-[13px] text-white/60">{short(event.txId, 18)}</span>
                                                )}
                                                <CopyInlineButton value={event.txId} />
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-white/55">{event.eventVersion}</td>
                                        <td className="px-4 py-3">
                                            {event.rfqId ? (
                                                <CopyableText value={event.rfqId} displayValue={short(event.rfqId, 18)} />
                                            ) : (
                                                <span className="text-white/30">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>
        </PageShell>
    );
}
