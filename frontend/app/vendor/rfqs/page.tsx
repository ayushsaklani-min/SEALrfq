'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
    CopyableText,
    DataGrid,
    DataPoint,
    EmptyState,
    Field,
    Notice,
    PageHeader,
    PageShell,
    PricingChip,
    SelectInput,
    StatusChip,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { Button } from '@/components/ui/Button';
import { authenticatedFetch } from '@/lib/authFetch';
import { blockEta, formatAmount, pricingLabel, tokenLabel } from '@/lib/sealProtocol';
import { fetchCurrentBlockHeight } from '@/lib/aleoClient';
import { truncateMiddle } from '@/lib/utils';

type RfqListItem = {
    id: string;
    itemName?: string | null;
    description?: string | null;
    quantity?: string | null;
    unit?: string | null;
    status: string;
    tokenType: number;
    pricingMode: number;
    minBid: string;
    biddingDeadline: number;
    revealDeadline: number;
    bidCount?: string | null;
    minBidCount?: string | null;
    buyer?: string | null;
    paid?: boolean;
    winnerAccepted?: boolean;
};

export default function VendorOpenRfqsPage() {
    const [rfqs, setRfqs] = useState<RfqListItem[]>([]);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [tokenFilter, setTokenFilter] = useState('ALL');
    const [pricingFilter, setPricingFilter] = useState('ALL');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [response, blockHeight] = await Promise.all([
                    authenticatedFetch('/api/rfq/all'),
                    fetchCurrentBlockHeight(),
                ]);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load open RFQs.');
                if (!cancelled) {
                    setRfqs(payload.data || []);
                    setCurrentBlock(blockHeight);
                }
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load open RFQs.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        const intervalId = window.setInterval(load, 30000);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, []);

    const filtered = useMemo(() => {
        return rfqs.filter((rfq) => {
            if (statusFilter !== 'ALL' && rfq.status !== statusFilter) return false;
            if (tokenFilter !== 'ALL' && String(rfq.tokenType) !== tokenFilter) return false;
            if (pricingFilter !== 'ALL' && String(rfq.pricingMode) !== pricingFilter) return false;
            if (search.trim()) {
                const q = search.toLowerCase();
                if (
                    !rfq.itemName?.toLowerCase().includes(q) &&
                    !rfq.description?.toLowerCase().includes(q) &&
                    !rfq.id.toLowerCase().includes(q)
                )
                    return false;
            }
            return true;
        });
    }, [rfqs, statusFilter, tokenFilter, pricingFilter, search]);

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Dashboard"
                eyebrowHref="/dashboard"
                title="All RFQs"
                description="Browse all requests for quotation. Open RFQs accept bids — click any card to view details and place a sealed bid."
                actions={
                    <Link href="/vendor/my-bids">
                        <Button variant="secondary">My Bids</Button>
                    </Link>
                }
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <DataGrid columns={4}>
                <DataPoint label="Total" value={rfqs.length} />
                <DataPoint label="Open for bids" value={rfqs.filter((r) => r.status === 'OPEN').length} />
                <DataPoint label="Completed" value={rfqs.filter((r) => r.status === 'COMPLETED').length} />
                <DataPoint label="In settlement" value={rfqs.filter((r) => r.status === 'ESCROW_FUNDED').length} />
            </DataGrid>

            <div className="grid gap-4 md:grid-cols-4">
                <Field label="Search">
                    <TextInput
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Item name, description, or RFQ ID..."
                    />
                </Field>
                <Field label="Status">
                    <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                        <option value="ALL">All statuses</option>
                        <option value="OPEN">Open — accepting bids</option>
                        <option value="REVEAL">Reveal phase</option>
                        <option value="WINNER_SELECTED">Winner selected</option>
                        <option value="ESCROW_FUNDED">In settlement</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="CANCELLED">Cancelled</option>
                    </SelectInput>
                </Field>
                <Field label="Token">
                    <SelectInput value={tokenFilter} onChange={(e) => setTokenFilter(e.target.value)}>
                        <option value="ALL">All tokens</option>
                        <option value="0">{tokenLabel(0)}</option>
                        <option value="1">{tokenLabel(1)}</option>
                        <option value="2">{tokenLabel(2)}</option>
                    </SelectInput>
                </Field>
                <Field label="Pricing mode">
                    <SelectInput value={pricingFilter} onChange={(e) => setPricingFilter(e.target.value)}>
                        <option value="ALL">All pricing modes</option>
                        <option value="0">{pricingLabel(0)}</option>
                        <option value="1">{pricingLabel(1)}</option>
                        <option value="2">{pricingLabel(2)}</option>
                    </SelectInput>
                </Field>
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="rounded-2xl border border-white/12 bg-white/[0.04] p-5 space-y-3">
                            <div className="skeleton h-5 w-1/4 rounded-lg" />
                            <div className="skeleton h-6 w-1/3 rounded-lg" />
                            <div className="skeleton h-4 w-2/3 rounded-lg" />
                            <div className="grid gap-3 md:grid-cols-4 mt-4">
                                {[1, 2, 3, 4].map((j) => (
                                    <div key={j} className="skeleton h-16 rounded-xl" />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState
                    title="No open RFQs"
                    description={rfqs.length > 0 ? 'No RFQs match your filters.' : 'There are no active RFQs right now. Check back soon.'}
                />
            ) : (
                <div className="space-y-4">
                    {filtered.map((rfq) => (
                        <Link
                            key={rfq.id}
                            href={`/vendor/bid/${encodeURIComponent(rfq.id)}`}
                            className="group block rounded-2xl border border-white/12 bg-white/[0.04] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-200/30 hover:bg-white/[0.07] hover:shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
                        >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <StatusChip status={rfq.status} />
                                        <TokenChip tokenType={rfq.tokenType} />
                                        <PricingChip pricingMode={rfq.pricingMode} />
                                    </div>
                                    <div className="mt-3 text-lg font-semibold text-white group-hover:text-amber-50 transition-colors">
                                        {rfq.itemName || 'Untitled RFQ'}
                                    </div>
                                    <div className="mt-2 max-w-fit">
                                        <CopyableText value={rfq.id} displayValue={truncateMiddle(rfq.id, 16, 10)} />
                                    </div>
                                    {rfq.description ? (
                                        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">{rfq.description}</p>
                                    ) : null}
                                </div>

                                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3 lg:min-w-[200px]">
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300/70">Bid window</div>
                                    <div className="mt-2 space-y-1 text-xs text-white/55">
                                        <div>
                                            Bid close: <span className="font-medium text-white/80">{blockEta(rfq.biddingDeadline, currentBlock)}</span>
                                        </div>
                                        <div>
                                            Reveal close: <span className="font-medium text-white/80">{blockEta(rfq.revealDeadline, currentBlock)}</span>
                                        </div>
                                    </div>
                                    {rfq.status === 'OPEN' && (
                                        <div className="mt-3">
                                            <span className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                                                Place bid →
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-4">
                                <DataPoint label="Minimum bid" value={formatAmount(rfq.minBid, rfq.tokenType)} />
                                <DataPoint label="Bids so far" value={`${rfq.bidCount ?? '0'} / ${rfq.minBidCount ?? '1'}`} />
                                <DataPoint label="Quantity" value={rfq.quantity ? `${rfq.quantity} ${rfq.unit || ''}`.trim() : '--'} />
                                <DataPoint label="Buyer" value={rfq.buyer ? truncateMiddle(rfq.buyer, 10, 6) : '--'} />
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </PageShell>
    );
}
