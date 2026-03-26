'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
    DataGrid,
    DataPoint,
    Field,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    StatusChip,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { formatAmount } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { walletFirstTx } from '@/lib/walletTx';

type RFQDetail = {
    id: string;
    itemName?: string | null;
    status: string;
    tokenType: number;
    winnerAccepted?: boolean;
    winningVendor?: string | null;
    winningBidAmount?: string | null;
};

export default function FundEscrowPage({ params }: { params: { id: string } }) {
    const [rfq, setRfq] = useState<RFQDetail | null>(null);
    const [amount, setAmount] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        authenticatedFetch(`/api/rfq/${params.id}`)
            .then((response) => response.json())
            .then((payload) => {
                if (!cancelled) {
                    if (payload?.status !== 'success') {
                        throw new Error(payload?.error?.message || 'Failed to load RFQ.');
                    }
                    setRfq(payload.data);
                    setAmount(payload.data.winningBidAmount || '');
                }
            })
            .catch((caught: any) => {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load fund escrow page.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [params.id]);

    const fundEscrow = async () => {
        if (!rfq || acting) return;

        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/rfq/${encodeURIComponent(rfq.id)}/fund-escrow`,
                { amount },
                (_prepareData, txHash) => ({ amount, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to fund escrow.');
        } finally {
            setActing(false);
        }
    };

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading funding step">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">Fetching the winning amount and current RFQ state.</div>
                </Panel>
            </PageShell>
        );
    }

    if (!rfq) {
        return (
            <PageShell>
                <Notice tone="danger">{error || 'RFQ not found.'}</Notice>
            </PageShell>
        );
    }

    const canFundEscrow = rfq.status === 'WINNER_SELECTED' && rfq.winnerAccepted && Boolean(rfq.winningBidAmount);

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Buyer"
                title={`Fund escrow for ${rfq.itemName || rfq.id}`}
                description="Move the winning amount into escrow once the vendor has accepted the award."
                actions={
                    <ActionBar>
                        <StatusChip status={rfq.status} />
                        <TokenChip tokenType={rfq.tokenType} />
                    </ActionBar>
                }
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {!canFundEscrow ? (
                <Notice tone="warning" title="Escrow funding unavailable">
                    Escrow can be funded only after a winner has been selected and accepted the award.
                </Notice>
            ) : null}

            <Panel title="Funding form">
                <div className="space-y-4">
                    <DataGrid columns={2}>
                        <DataPoint label="RFQ id" value={<CopyableText value={rfq.id} displayValue={truncateMiddle(rfq.id, 16, 10)} />} />
                        <DataPoint
                            label="Winner"
                            value={rfq.winningVendor ? <CopyableText value={rfq.winningVendor} displayValue={truncateMiddle(rfq.winningVendor, 14, 10)} /> : '--'}
                        />
                        <DataPoint label="Winning amount" value={rfq.winningBidAmount ? formatAmount(rfq.winningBidAmount, rfq.tokenType) : '--'} />
                        <DataPoint label="Status" value={rfq.status} />
                    </DataGrid>
                    <Field label="Escrow amount" hint="This is pre-filled with the winning amount in raw micro-units.">
                        <TextInput value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Winning amount in micro-units" />
                    </Field>
                    <ActionBar>
                        <Button disabled={!canFundEscrow || acting} isLoading={acting} onClick={fundEscrow}>
                            Fund escrow
                        </Button>
                        <Link href={`/buyer/rfqs/${encodeURIComponent(rfq.id)}`}>
                            <Button variant="secondary">Back to RFQ</Button>
                        </Link>
                        {rfq.status === 'ESCROW_FUNDED' ? (
                            <Link href={`/escrow/${encodeURIComponent(rfq.id)}`}>
                                <Button variant="secondary">Go to escrow</Button>
                            </Link>
                        ) : null}
                    </ActionBar>
                </div>
            </Panel>

            {txKey ? (
                <Panel title="Latest transaction">
                    <TxStatusView idempotencyKey={txKey} compact={true} />
                </Panel>
            ) : null}
        </PageShell>
    );
}
