'use client';

import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    DataGrid,
    DataPoint,
    Field,
    InfoList,
    InfoRow,
    Notice,
    PageHeader,
    PageShell,
    Panel,
    PricingChip,
    StatusChip,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { calculateFee, formatAmount, netAfterFee, randomField, TOKEN_TYPE } from '@/lib/sealProtocol';
import { walletFirstTx } from '@/lib/walletTx';
import { useProtocolStore } from '@/stores/protocolStore';

type EscrowView = {
    id: string;
    rfqId: string;
    status: string;
    tokenType: number;
    tokenSymbol: string;
    pricingMode: number;
    totalAmount: string;
    releasedAmount: string;
    remainingAmount: string;
    payments: Array<{
        id: string;
        amount: string;
        isFinal: boolean;
        releasedAt: string;
        recipient: string;
    }>;
    lifecycleBlock?: number | null;
    currentBlock: number;
    recoveryBlock: number;
    timeoutBlock: number;
    winner?: string | null;
    creator?: string | null;
    paid: boolean;
    feeBps: number;
    settlementPathLocked?: string | null;
    canRecoverBond: boolean;
    canWinnerClaim: boolean;
    canCreatorReclaim: boolean;
    winningAmount: string;
};

export default function EscrowDetailPage({ params }: { params: { rfqId: string } }) {
    const { walletAddress } = useWallet();
    const addRecord = useProtocolStore((state) => state.addRecord);
    const [escrow, setEscrow] = useState<EscrowView | null>(null);
    const [partialAmount, setPartialAmount] = useState('');
    const [paymentRecord, setPaymentRecord] = useState('');
    const [receiptNonce, setReceiptNonce] = useState(() => randomField());
    const [proofA, setProofA] = useState('');
    const [proofB, setProofB] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await authenticatedFetch(`/api/escrow/${params.rfqId}`);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error?.message || 'Failed to load escrow.');
                if (!cancelled) {
                    setEscrow(payload.data);
                    setPartialAmount((current) => current || payload.data.remainingAmount);
                }
            } catch (caught: any) {
                if (!cancelled) setError(caught?.message || 'Failed to load escrow.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        const intervalId = window.setInterval(load, 15000);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [params.rfqId]);

    const releasePartial = async () => {
        if (!escrow || acting) return;
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/escrow/${encodeURIComponent(escrow.rfqId)}/release`,
                { amount: partialAmount },
                (_prepareData, txHash) => ({ amount: partialAmount, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to release partial payment.');
        } finally {
            setActing(false);
        }
    };

    const payInvoice = async () => {
        if (!escrow || acting) return;
        setActing(true);
        setError(null);
        try {
            const payload = {
                paymentRecord,
                receiptNonce,
                proofA,
                proofB,
            };
            const result = await walletFirstTx(
                `/api/escrow/${encodeURIComponent(escrow.rfqId)}/pay-invoice`,
                payload,
                (_prepareData, txHash) => ({ ...payload, txHash }),
            );
            addRecord({
                id: `${escrow.rfqId}:${receiptNonce}`,
                type: 'InvoiceReceipt',
                rfqId: escrow.rfqId,
                owner: walletAddress || escrow.creator || 'unknown',
                payload: {
                    receiptNonce,
                    paymentRecord,
                },
                createdAt: new Date().toISOString(),
            });
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to pay invoice.');
        } finally {
            setActing(false);
        }
    };

    const recoverBond = async () => {
        if (!escrow || acting) return;
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/escrow/${encodeURIComponent(escrow.rfqId)}/recover-bond`,
                {},
                (_prepareData, txHash) => ({ txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to recover escrow bond.');
        } finally {
            setActing(false);
        }
    };

    const winnerClaim = async () => {
        if (!escrow || acting) return;
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/escrow/${encodeURIComponent(escrow.rfqId)}/winner-claim`,
                {},
                (_prepareData, txHash) => ({ txHash }),
            );
            addRecord({
                id: `${escrow.rfqId}:winner-claim`,
                type: 'WinnerEscrowClaimed',
                rfqId: escrow.rfqId,
                owner: walletAddress || escrow.winner || 'unknown',
                payload: {
                    remainingAmount: escrow.remainingAmount,
                },
                createdAt: new Date().toISOString(),
            });
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to claim escrow.');
        } finally {
            setActing(false);
        }
    };

    const creatorReclaim = async () => {
        if (!escrow || acting) return;
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/escrow/${encodeURIComponent(escrow.rfqId)}/creator-reclaim`,
                {},
                (_prepareData, txHash) => ({ txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to reclaim escrow.');
        } finally {
            setActing(false);
        }
    };

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading settlement">
                    <div className="text-sm text-[hsl(var(--muted-foreground))]">
                        Fetching escrow balances, settlement state, and timeout windows.
                    </div>
                </Panel>
            </PageShell>
        );
    }

    if (!escrow) {
        return (
            <PageShell>
                <Notice tone="danger">{error || 'Escrow not found.'}</Notice>
            </PageShell>
        );
    }

    const partialAmountIsValid = /^\d+$/.test(partialAmount);
    const effectiveFeeBps = escrow.tokenType === TOKEN_TYPE.USAD ? 0 : escrow.feeBps;
    const feeAmount = partialAmountIsValid ? calculateFee(partialAmount, effectiveFeeBps) : 0n;
    const netAmount = partialAmountIsValid ? netAfterFee(partialAmount, effectiveFeeBps) : 0n;
    const isCreator = walletAddress && escrow.creator && walletAddress === escrow.creator;
    const isWinner = walletAddress && escrow.winner && walletAddress === escrow.winner;
    const releasedSoFar = BigInt(escrow.releasedAmount);

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Settlement"
                title={`Escrow for ${escrow.rfqId}`}
                description="Manage public releases, private invoice payment, creator bond recovery, and timeout protection actions from one place."
                actions={
                    <ActionBar>
                        <StatusChip status={escrow.status} />
                        <TokenChip tokenType={escrow.tokenType} label={escrow.tokenSymbol} />
                        <PricingChip pricingMode={escrow.pricingMode} />
                    </ActionBar>
                }
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {escrow.settlementPathLocked ? (
                <Notice title="Settlement path locked">
                    {escrow.settlementPathLocked === 'PRIVATE_PAYMENT'
                        ? 'Private payment has started, so public releases are disabled.'
                        : 'Public releases have started, so the private invoice path is disabled.'}
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-6">
                    <Panel title="Settlement summary">
                        <DataGrid columns={3}>
                            <DataPoint label="Winning amount" value={formatAmount(escrow.winningAmount, escrow.tokenType)} />
                            <DataPoint label="Released so far" value={formatAmount(escrow.releasedAmount, escrow.tokenType)} />
                            <DataPoint label="Remaining" value={formatAmount(escrow.remainingAmount, escrow.tokenType)} />
                            <DataPoint label="Current block" value={escrow.currentBlock} />
                            <DataPoint label="Recovery block" value={escrow.recoveryBlock} subtle="Winner claim opens after this block if unpaid." />
                            <DataPoint label="Escrow timeout" value={escrow.timeoutBlock} subtle="Creator timeout and cancel logic uses this window." />
                        </DataGrid>
                    </Panel>

                    <Panel title="Path A: public releases" subtitle="Use this when paying openly from escrow. Once it starts, the private payment path is locked.">
                        <div className="space-y-4">
                            <Field label="Release amount" hint="Enter the gross amount in raw micro-units.">
                                <TextInput
                                    value={partialAmount}
                                    onChange={(event) => setPartialAmount(event.target.value)}
                                    placeholder="25000000"
                                />
                            </Field>
                            <DataGrid columns={3}>
                                <DataPoint label="Gross release" value={partialAmountIsValid ? formatAmount(partialAmount, escrow.tokenType) : '--'} />
                                <DataPoint
                                    label="Protocol fee"
                                    value={
                                        escrow.tokenType === TOKEN_TYPE.USAD
                                            ? 'No fee for USAD'
                                            : partialAmountIsValid
                                              ? formatAmount(feeAmount.toString(), escrow.tokenType)
                                              : '--'
                                    }
                                    subtle={escrow.tokenType === TOKEN_TYPE.USAD ? undefined : `${effectiveFeeBps} bps`}
                                />
                                <DataPoint label="Winner receives" value={partialAmountIsValid ? formatAmount(netAmount.toString(), escrow.tokenType) : '--'} />
                            </DataGrid>
                            <ActionBar>
                                <Button disabled={!isCreator || escrow.paid || acting} isLoading={acting} onClick={releasePartial}>
                                    Release payment
                                </Button>
                                <div className="text-sm text-[hsl(var(--muted-foreground))]">
                                    {escrow.paid ? 'Private payment is already recorded.' : 'Use this only if you are staying on the public release path.'}
                                </div>
                            </ActionBar>
                        </div>
                    </Panel>

                    <Panel title="Path B: private payment + bond recovery" subtitle="Use this when the winner is paid privately and the creator later recovers the escrow bond.">
                        <div className="space-y-4">
                            <Field label="Shielded payment record" hint="Paste the payment record returned by the wallet or stablecoin program.">
                                <TextInput value={paymentRecord} onChange={(event) => setPaymentRecord(event.target.value)} placeholder="record1..." />
                            </Field>
                            <Field label="Receipt nonce" hint="Used for the payment commitment stored in v16 proofs.">
                                <TextInput value={receiptNonce} onChange={(event) => setReceiptNonce(event.target.value)} placeholder="123field" />
                            </Field>
                            {escrow.tokenType !== TOKEN_TYPE.CREDITS ? (
                                <div className="grid gap-4 md:grid-cols-2">
                                    <Field label="Compliance proof A">
                                        <TextInput value={proofA} onChange={(event) => setProofA(event.target.value)} placeholder="proofA" />
                                    </Field>
                                    <Field label="Compliance proof B">
                                        <TextInput value={proofB} onChange={(event) => setProofB(event.target.value)} placeholder="proofB" />
                                    </Field>
                                </div>
                            ) : null}
                            <ActionBar>
                                <Button
                                    disabled={!isCreator || escrow.paid || releasedSoFar > 0n || acting}
                                    isLoading={acting}
                                    onClick={payInvoice}
                                >
                                    Pay invoice privately
                                </Button>
                                <Button
                                    variant="secondary"
                                    disabled={!isCreator || !escrow.canRecoverBond || acting}
                                    isLoading={acting}
                                    onClick={recoverBond}
                                >
                                    Recover escrow bond
                                </Button>
                            </ActionBar>
                        </div>
                    </Panel>
                </div>

                <div className="space-y-6">
                    <Panel title="Roles and timeout actions">
                        <InfoList>
                            <InfoRow label="Creator" value={escrow.creator || '--'} />
                            <InfoRow label="Winner" value={escrow.winner || '--'} />
                            <InfoRow label="Escrow total" value={formatAmount(escrow.totalAmount, escrow.tokenType)} />
                            <InfoRow label="Private payment complete" value={escrow.paid ? 'Yes' : 'No'} />
                            <InfoRow
                                label="Winner claim mode"
                                value={releasedSoFar > 0n ? 'Partial-path remainder claim' : 'Full unpaid claim'}
                            />
                        </InfoList>
                        <ActionBar className="mt-4">
                            <Button disabled={!isWinner || !escrow.canWinnerClaim || acting} isLoading={acting} onClick={winnerClaim}>
                                Claim escrow
                            </Button>
                            <Button
                                variant="secondary"
                                disabled={!isCreator || !escrow.canCreatorReclaim || acting}
                                isLoading={acting}
                                onClick={creatorReclaim}
                            >
                                Creator reclaim
                            </Button>
                        </ActionBar>
                    </Panel>

                    <Panel title="Milestones">
                        {escrow.payments.length === 0 ? (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">No settlement milestones have been recorded yet.</div>
                        ) : (
                            <div className="space-y-3">
                                {escrow.payments.map((payment) => (
                                    <div key={payment.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4">
                                        <div className="text-sm font-medium text-white">{payment.isFinal ? 'Final' : 'Partial'} release</div>
                                        <div className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                                            {formatAmount(payment.amount, escrow.tokenType)}
                                        </div>
                                        <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                                            {new Date(payment.releasedAt).toLocaleString()} | {payment.recipient}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>

                    {txKey ? (
                        <Panel title="Latest transaction">
                            <TxStatusView idempotencyKey={txKey} compact={true} />
                        </Panel>
                    ) : null}
                </div>
            </div>
        </PageShell>
    );
}
