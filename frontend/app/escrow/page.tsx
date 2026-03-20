'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ActionBar, Field, Notice, PageHeader, PageShell, Panel, TextInput } from '@/components/protocol/ProtocolPrimitives';

export default function EscrowHubPage() {
    const router = useRouter();
    const [rfqId, setRfqId] = useState('');

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Settlement"
                title="Escrow"
                description="Open a settlement workspace for an RFQ, then manage releases, private invoice payment, or timeout protection actions."
            />

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <Panel title="Open settlement" subtitle="Every escrow action is keyed by RFQ id.">
                    <div className="space-y-4">
                        <Field label="RFQ id" hint="Use a v15 RFQ id. The same workspace handles funding, releases, private payment, and timeout claims.">
                            <TextInput value={rfqId} onChange={(event) => setRfqId(event.target.value)} placeholder="123field" />
                        </Field>
                        <ActionBar>
                            <Button onClick={() => router.push(`/escrow/${encodeURIComponent(rfqId)}`)} disabled={!rfqId.trim()}>
                                Open settlement
                            </Button>
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">Paste the RFQ id exactly as stored on-chain.</div>
                        </ActionBar>
                    </div>
                </Panel>

                <div className="space-y-6">
                    <Panel title="Quick links">
                        <div className="space-y-3">
                            <Link
                                href="/buyer/rfqs"
                                className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-4 text-sm text-white transition hover:border-[hsl(var(--primary)/0.3)]"
                            >
                                <span>Creator dashboard</span>
                                <span className="text-[hsl(var(--muted-foreground))]">Fund escrow and manage releases</span>
                            </Link>
                            <Link
                                href="/vendor/my-bids"
                                className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-4 text-sm text-white transition hover:border-[hsl(var(--primary)/0.3)]"
                            >
                                <span>Vendor dashboard</span>
                                <span className="text-[hsl(var(--muted-foreground))]">Claim stake or escrow</span>
                            </Link>
                        </div>
                    </Panel>

                    <Notice title="Settlement paths">
                        Path A uses public partial releases. Path B uses private invoice payment followed by creator bond recovery. Once one path starts, the other is locked.
                    </Notice>
                </div>
            </div>
        </PageShell>
    );
}
