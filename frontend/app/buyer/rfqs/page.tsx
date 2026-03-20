'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    DataGrid,
    DataPoint,
    EmptyState,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    PricingChip,
    SelectInput,
    StatusChip,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { formatAmount, pricingLabel, tokenLabel } from '@/lib/sealProtocol';

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
    paid?: boolean;
    auctionSource?: string | null;
};

function nextActionLabel(rfq: RfqListItem) {
    if (rfq.pricingMode !== 0 && !rfq.auctionSource) return 'Import auction result';
    if (rfq.status === 'REVEAL') return 'Select winner';
    if (rfq.status === 'WINNER_SELECTED') return 'Wait for winner response';
    if (rfq.status === 'ESCROW_FUNDED') return 'Manage settlement';
    if (rfq.status === 'OPEN') return 'Collect bids';
    return 'Open RFQ';
}

export default function BuyerRfqsPage() {
    const [rfqs, setRfqs] = useState<RfqListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [tokenFilter, setTokenFilter] = useState('ALL');
    const [pricingFilter, setPricingFilter] = useState('ALL');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await authenticatedFetch('/api/rfq/my-rfqs');
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload?.error?.message || 'Failed to load RFQs.');
                }
                if (!cancelled) setRfqs(payload.data || []);
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load RFQs.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const filtered = useMemo(
        () =>
            rfqs.filter((rfq) => {
                if (statusFilter !== 'ALL' && rfq.status !== statusFilter) return false;
                if (tokenFilter !== 'ALL' && String(rfq.tokenType) !== tokenFilter) return false;
                if (pricingFilter !== 'ALL' && String(rfq.pricingMode) !== pricingFilter) return false;
                return true;
            }),
        [pricingFilter, rfqs, statusFilter, tokenFilter],
    );

    const openCount = rfqs.filter((rfq) => rfq.status === 'OPEN').length;
    const settlementCount = rfqs.filter((rfq) => rfq.status === 'ESCROW_FUNDED').length;
    const importCount = rfqs.filter((rfq) => rfq.pricingMode !== 0 && !rfq.auctionSource).length;

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Buyer"
                title="My RFQs"
                description="A compact view of every RFQ you created, with the next action for each."
                actions={
                    <ActionBar>
                        <Link href="/buyer/create-rfq">
                            <Button>Create RFQ</Button>
                        </Link>
                        <Link href="/auctions">
                            <Button variant="secondary">Auctions</Button>
                        </Link>
                    </ActionBar>
                }
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <DataGrid columns={3}>
                <DataPoint label="Total RFQs" value={rfqs.length} />
                <DataPoint label="Open for bids" value={openCount} />
                <DataPoint label="Need auction import" value={importCount} subtle="Vickrey or Dutch RFQs still waiting for a result" />
                <DataPoint label="In settlement" value={settlementCount} />
            </DataGrid>

            <Panel title="Filters">
                <div className="grid gap-4 md:grid-cols-3">
                    <Field label="Status">
                        <SelectInput value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                            <option value="ALL">All statuses</option>
                            <option value="OPEN">Accepting bids</option>
                            <option value="REVEAL">Reveal phase</option>
                            <option value="WINNER_SELECTED">Awaiting winner response</option>
                            <option value="ESCROW_FUNDED">In delivery</option>
                            <option value="COMPLETED">Completed</option>
                            <option value="CANCELLED">Cancelled</option>
                            <option value="WINNER_DECLINED">Winner declined</option>
                        </SelectInput>
                    </Field>
                    <Field label="Token">
                        <SelectInput value={tokenFilter} onChange={(event) => setTokenFilter(event.target.value)}>
                            <option value="ALL">All tokens</option>
                            <option value="0">{tokenLabel(0)}</option>
                            <option value="1">{tokenLabel(1)}</option>
                            <option value="2">{tokenLabel(2)}</option>
                        </SelectInput>
                    </Field>
                    <Field label="Pricing mode">
                        <SelectInput value={pricingFilter} onChange={(event) => setPricingFilter(event.target.value)}>
                            <option value="ALL">All pricing modes</option>
                            <option value="0">{pricingLabel(0)}</option>
                            <option value="1">{pricingLabel(1)}</option>
                            <option value="2">{pricingLabel(2)}</option>
                        </SelectInput>
                    </Field>
                </div>
            </Panel>

            {loading ? (
                <Panel title="Loading">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching RFQs.</div>
                </Panel>
            ) : filtered.length === 0 ? (
                <EmptyState
                    title="No RFQs match these filters"
                    description="Try a wider filter set or create a new RFQ."
                    actionHref="/buyer/create-rfq"
                    actionLabel="Create RFQ"
                />
            ) : (
                <div className="space-y-4">
                    {filtered.map((rfq) => (
                        <Link
                            key={rfq.id}
                            href={`/buyer/rfqs/${encodeURIComponent(rfq.id)}`}
                            className="block rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 transition hover:border-[hsl(var(--primary)/0.3)] hover:bg-[hsl(var(--primary)/0.04)]"
                        >
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <StatusChip status={rfq.status} />
                                        <TokenChip tokenType={rfq.tokenType} />
                                        <PricingChip pricingMode={rfq.pricingMode} />
                                    </div>
                                    <div className="mt-3 text-lg font-semibold text-white">{rfq.itemName || 'Untitled RFQ'}</div>
                                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{rfq.id}</div>
                                    {rfq.description ? (
                                        <p className="mt-3 max-w-3xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">
                                            {rfq.description}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="text-sm text-[hsl(var(--muted-foreground))] lg:text-right">
                                    <div className="font-medium text-white">{nextActionLabel(rfq)}</div>
                                    <div className="mt-1">Bid close: block {rfq.biddingDeadline}</div>
                                    <div>Reveal close: block {rfq.revealDeadline}</div>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-4">
                                <DataPoint label="Minimum bid" value={formatAmount(rfq.minBid, rfq.tokenType)} />
                                <DataPoint label="Bid count" value={`${rfq.bidCount ?? '0'} / ${rfq.minBidCount ?? '1'}`} />
                                <DataPoint label="Quantity" value={rfq.quantity ? `${rfq.quantity} ${rfq.unit || ''}`.trim() : '--'} />
                                <DataPoint label="Settlement" value={rfq.paid ? 'Paid privately' : rfq.auctionSource ? 'Auction imported' : 'Pending'} />
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </PageShell>
    );
}
