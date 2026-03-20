'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/authFetch';
import { useWallet } from '@/contexts/WalletContext';
import { Notice, PageHeader, PageShell, Panel, CardSkeleton } from '@/components/protocol/ProtocolPrimitives';
import { Plus, FileText, Gavel, ShieldCheck, ArrowRight } from 'lucide-react';

type PlatformSummary = {
    feeBps: number;
    paused: boolean;
    initialized: boolean;
    isAdmin: boolean;
};

const buyerActions = [
    { title: 'Create RFQ', href: '/buyer/create-rfq', description: 'Start a new sealed-bid request.', icon: Plus },
    { title: 'My RFQs', href: '/buyer/rfqs', description: 'Manage your active and past requests.', icon: FileText },
    { title: 'Auctions', href: '/auctions', description: 'Run Vickrey or Dutch auctions.', icon: Gavel },
];

const vendorActions = [
    { title: 'Browse RFQs', href: '/buyer/rfqs', description: 'Find open requests and submit bids.', icon: FileText },
    { title: 'My Bids', href: '/vendor/my-bids', description: 'Track your bids, reveals, and awards.', icon: ShieldCheck },
    { title: 'Auctions', href: '/auctions', description: 'Participate in live auctions.', icon: Gavel },
];

export default function Dashboard() {
    const { role } = useWallet();
    const [platform, setPlatform] = useState<PlatformSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        authenticatedFetch('/api/platform/config')
            .then((res) => res.json())
            .then((payload) => { if (!cancelled && payload?.data) setPlatform(payload.data); })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const actions = role === 'VENDOR' ? vendorActions : buyerActions;

    return (
        <PageShell className="space-y-6">
            <PageHeader
                title={role === 'VENDOR' ? 'Vendor Dashboard' : 'Buyer Dashboard'}
                description={role === 'VENDOR' ? 'Browse open RFQs, manage bids, and participate in auctions.' : 'Create RFQs, manage bids, select winners, and settle payments.'}
                actions={platform?.isAdmin ? (
                    <Link href="/admin" className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm text-[hsl(var(--muted-foreground))] hover:text-white hover:bg-white/5 transition-colors">
                        Admin Panel
                    </Link>
                ) : undefined}
            />

            {!loading && !platform?.initialized ? (
                <Notice tone="warning" title="Platform not initialized">
                    The admin needs to configure the platform before RFQs can be created.
                </Notice>
            ) : null}

            {platform?.paused ? (
                <Notice tone="warning" title="Platform paused">
                    New RFQ creation is paused. Existing settlements remain available.
                </Notice>
            ) : null}

            {loading ? (
                <div className="grid gap-4 md:grid-cols-3"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>
            ) : (
                <div className="grid gap-4 md:grid-cols-3">
                    {actions.map((action) => (
                        <Link key={action.title} href={action.href} className="group rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 transition hover:border-[hsl(var(--primary)/0.3)] hover:bg-[hsl(var(--primary)/0.04)]">
                            <div className="flex items-start justify-between">
                                <div className="w-10 h-10 rounded-lg bg-[hsl(var(--primary)/0.12)] flex items-center justify-center">
                                    <action.icon className="h-5 w-5 text-[hsl(var(--primary))]" />
                                </div>
                                <ArrowRight className="h-4 w-4 text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))] transition-colors" />
                            </div>
                            <h3 className="mt-4 text-lg font-semibold text-white">{action.title}</h3>
                            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{action.description}</p>
                        </Link>
                    ))}
                </div>
            )}

            {!loading && platform ? (
                <div className="grid gap-4 sm:grid-cols-3">
                    {[
                        { label: 'Platform', value: platform.initialized ? 'Active' : 'Not initialized' },
                        { label: 'Status', value: platform.paused ? 'Paused' : 'Running' },
                        { label: 'Fee', value: `${(platform.feeBps / 100).toFixed(2)}%` },
                    ].map((item) => (
                        <div key={item.label} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                            <div className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{item.label}</div>
                            <div className="mt-1 text-sm font-medium text-white">{item.value}</div>
                        </div>
                    ))}
                </div>
            ) : null}
        </PageShell>
    );
}
