'use client';

import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Button } from '@/components/ui/Button';
import {
    ActionBar,
    CopyableText,
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
    TextAreaInput,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { calculateFee, formatAmount, netAfterFee, randomField, TOKEN_TYPE } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { executeWithAdapter, requestCreditsRecord, submitTrackedResult, walletFirstTx } from '@/lib/walletTx';
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
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [invoiceRecord, setInvoiceRecord] = useState('');
    const [receiptNonce] = useState(() => randomField());

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

    const payInvoice = async () => {
        if (!escrow || acting) return;
        setActing(true);
        setError(null);
        try {
            // Step 1: get the credits record plaintext from Shield wallet
            let recordToUse = invoiceRecord.trim();
            if (!recordToUse) {
                recordToUse = await requestCreditsRecord(Number(escrow.winningAmount));
            }

            // Step 2: get prepare data from backend (returns 5 inputs, record injected client-side)
            const { authenticatedFetch } = await import('@/lib/authFetch');
            const prepareRes = await authenticatedFetch(
                `/api/escrow/${encodeURIComponent(escrow.rfqId)}/pay-invoice`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ paymentRecord: recordToUse, receiptNonce }),
                },
            );
            const prepareJson = await prepareRes.json();
            if (!prepareRes.ok) throw new Error(prepareJson?.error?.message || 'Prepare failed');

            const { idempotencyKey, request: txRequest } = prepareJson.data.tx;

            // Step 3: inject record as input[5] (credits.record position in pay_invoice)
            const inputs = [...txRequest.inputs];
            inputs.splice(5, 0, recordToUse);

            // Step 4: execute via ShieldWalletAdapter directly (NullPay pattern — handles records properly)
            let txResult: any;
            try {
                txResult = await executeWithAdapter({
                    program: txRequest.program,
                    function: txRequest.function,
                    inputs,
                    fee: Number(txRequest.fee) || 1_000_000,
                });
            } catch (walletErr: any) {
                await submitTrackedResult(idempotencyKey, {
                    txHash: `wallet_rejected_${Date.now()}`,
                    status: 'rejected',
                    error: walletErr?.message || 'Wallet rejected',
                    rawResponse: { error: walletErr?.message },
                }).catch(() => {});
                throw walletErr;
            }

            const txHash = txResult?.transactionId || txResult?.txId || txResult?.id || txResult?.hash || '';
            if (!txHash) throw new Error('Wallet did not return a transaction id');

            await submitTrackedResult(idempotencyKey, { txHash, status: 'submitted', rawResponse: txResult });

            // Step 5: confirm with backend
            const confirmRes = await authenticatedFetch(
                `/api/escrow/${encodeURIComponent(escrow.rfqId)}/pay-invoice`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ txHash, receiptNonce }),
                },
            );
            const confirmJson = await confirmRes.json();
            if (!confirmRes.ok) throw new Error(confirmJson?.error?.message || 'Confirmation failed');

            const result = { idempotencyKey, txHash, data: confirmJson.data };
            addRecord({
                id: `${escrow.rfqId}:invoice`,
                type: 'InvoiceReceipt',
                rfqId: escrow.rfqId,
                owner: walletAddress || escrow.creator || 'unknown',
                payload: { receiptNonce },
                createdAt: new Date().toISOString(),
            });
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Invoice payment failed.');
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
                description="Manage public releases, view settlement status, and handle timeout protection actions from one place."
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
                            <DataPoint label="RFQ id" value={<CopyableText value={escrow.rfqId} displayValue={truncateMiddle(escrow.rfqId, 16, 10)} />} />
                            <DataPoint label="Winning amount" value={formatAmount(escrow.winningAmount, escrow.tokenType)} />
                            <DataPoint label="Released so far" value={formatAmount(escrow.releasedAmount, escrow.tokenType)} />
                            <DataPoint label="Remaining" value={formatAmount(escrow.remainingAmount, escrow.tokenType)} />
                            <DataPoint label="Current block" value={escrow.currentBlock} />
                            <DataPoint label="Recovery block" value={escrow.recoveryBlock} subtle="Winner claim opens after this block if unpaid." />
                            <DataPoint label="Escrow timeout" value={escrow.timeoutBlock} subtle="Creator timeout and cancel logic uses this window." />
                        </DataGrid>
                    </Panel>

                    <Panel title="Path A: public releases" subtitle="Use this when paying openly from escrow.">
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

                    {escrow.tokenType === TOKEN_TYPE.CREDITS ? (
                        <Panel
                            title="Path B: private invoice"
                            subtitle="Pay privately using a credits record from your wallet. The buyer's escrow record is not consumed — payment goes directly to the winner."
                        >
                            <div className="space-y-4">
                                <Notice tone="warning" title="Save your receipt nonce">
                                    This nonce is generated once per page load. Copy and save it before submitting — you will need it to prove payment on-chain later.
                                </Notice>
                                <DataGrid columns={2}>
                                    <DataPoint
                                        label="Receipt nonce (save this)"
                                        value={<CopyableText value={receiptNonce} displayValue={receiptNonce.slice(0, 20) + '...'} mono breakAll={false} />}
                                    />
                                    <DataPoint label="Invoice amount" value={formatAmount(escrow.winningAmount, escrow.tokenType)} />
                                </DataGrid>
                                <Field
                                    label="Credits record (auto-detected)"
                                    hint="Shield wallet will automatically provide your private credits record. Only paste manually below if auto-detection fails."
                                >
                                    <TextAreaInput
                                        value={invoiceRecord}
                                        onChange={(e) => setInvoiceRecord(e.target.value)}
                                        placeholder="Leave empty for auto-detection, or paste plaintext record manually: { owner: aleo1....private, microcredits: ...u64.private, _nonce: ...public }"
                                        className="min-h-[80px] font-mono text-xs"
                                    />
                                </Field>
                                <ActionBar>
                                    <Button
                                        disabled={!isCreator || escrow.paid || acting || escrow.settlementPathLocked === 'PARTIAL_RELEASES'}
                                        isLoading={acting}
                                        onClick={payInvoice}
                                    >
                                        Pay invoice privately
                                    </Button>
                                    <div className="text-sm text-white/55">
                                        {escrow.paid
                                            ? 'Invoice already paid.'
                                            : escrow.settlementPathLocked === 'PARTIAL_RELEASES'
                                              ? 'Cannot use Path B after public releases.'
                                              : 'Auto-detects your credits record from Shield wallet.'}
                                    </div>
                                </ActionBar>
                            </div>
                        </Panel>
                    ) : (
                        <Panel title="Path B: private invoice" subtitle="Not available for this token type.">
                            <Notice tone="neutral" title="USDCX / USAD invoice">
                                Private invoice settlement for USDCX and USAD requires compliance MerkleProof records from the token issuer. Use Path A (public releases) for now.
                            </Notice>
                        </Panel>
                    )}
                </div>

                <div className="space-y-6">
                    <Panel title="Roles and timeout actions">
                        <InfoList>
                            <InfoRow
                                label="Creator"
                                value={escrow.creator ? <CopyableText value={escrow.creator} displayValue={truncateMiddle(escrow.creator, 14, 10)} /> : '--'}
                            />
                            <InfoRow
                                label="Winner"
                                value={escrow.winner ? <CopyableText value={escrow.winner} displayValue={truncateMiddle(escrow.winner, 14, 10)} /> : '--'}
                            />
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
                                    <div key={payment.id} className="rounded-xl border border-white/12 bg-white/[0.05] p-4">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="text-sm font-semibold text-white">{payment.isFinal ? 'Final' : 'Partial'} release</div>
                                            <div className="text-sm font-bold text-emerald-300">{formatAmount(payment.amount, escrow.tokenType)}</div>
                                        </div>
                                        <div className="mt-1.5 text-xs text-white/50">
                                            {new Date(payment.releasedAt).toLocaleString()} · {payment.recipient}
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
