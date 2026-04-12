'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CounterpartyProfileCard, type BuyerProfileSummary, type VendorProfileSummary } from '@/components/CounterpartyProfileCard';
import { DeliveryMilestoneCard } from '@/components/DeliveryMilestoneCard';
import { ConfirmModal, type ConfirmDetail } from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
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
    SelectInput,
    StatusChip,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { type DeliveryMilestone, type DeliverySummary } from '@/lib/deliveryAssurance';
import { blockEta, calculateFee, formatAmount, netAfterFee, randomField, TOKEN_TYPE } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { executeWithAdapter, listShieldCreditsRecords, listShieldStablecoinRecords, requestCreditsRecord, requestStablecoinRecord, requestStablecoinRecordWithProofs, submitTrackedResult, type ShieldCreditsRecordSummary, type ShieldStablecoinRecordSummary, walletFirstTx } from '@/lib/walletTx';
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
    milestones: DeliveryMilestone[];
    deliverySummary: DeliverySummary;
    lifecycleBlock?: number | null;
    currentBlock: number;
    recoveryBlock: number;
    timeoutBlock: number;
    winner?: string | null;
    creator?: string | null;
    creatorProfile?: BuyerProfileSummary | null;
    winnerProfile?: VendorProfileSummary | null;
    paid: boolean;
    receiptHash?: string | null;
    feeBps: number;
    settlementPathLocked?: string | null;
    canRecoverBond: boolean;
    canWinnerClaim: boolean;
    canCreatorReclaim: boolean;
    winningAmount: string;
};

type PendingConfirm =
    | { kind: 'releasePartial' }
    | { kind: 'payInvoice' }
    | { kind: 'winnerClaim' }
    | { kind: 'creatorReclaim' }
    | { kind: 'recoverBond' };

export default function EscrowDetailPage({ params }: { params: { rfqId: string } }) {
    const { walletAddress } = useWallet();
    const toast = useToast();
    const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
    const addRecord = useProtocolStore((state) => state.addRecord);
    const records = useProtocolStore((state) => state.records);
    const [escrow, setEscrow] = useState<EscrowView | null>(null);
    const [partialAmount, setPartialAmount] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [invoiceRecord, setInvoiceRecord] = useState('');
    const [receiptNonce] = useState(() => randomField());
    const [walletRecords, setWalletRecords] = useState<(ShieldCreditsRecordSummary | ShieldStablecoinRecordSummary)[]>([]);
    const [walletRecordsLoading, setWalletRecordsLoading] = useState(false);
    const [walletRecordsLoaded, setWalletRecordsLoaded] = useState(false);
    const [walletRecordsError, setWalletRecordsError] = useState<string | null>(null);
    const [settlementTab, setSettlementTab] = useState<'pathA' | 'pathB'>('pathA');
    const [selectedMilestoneId, setSelectedMilestoneId] = useState('');
    const [milestoneForms, setMilestoneForms] = useState<Record<string, { evidenceHash: string; evidenceUrl: string; note: string; reviewNote: string; rejectionReason: string }>>({});
    const [milestoneBusyId, setMilestoneBusyId] = useState<string | null>(null);

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

    const stablecoinProgramId = escrow?.tokenType === TOKEN_TYPE.USDCX
        ? 'test_usdcx_stablecoin.aleo'
        : escrow?.tokenType === TOKEN_TYPE.USAD
          ? 'test_usad_stablecoin.aleo'
          : null;

    const loadWalletRecords = async () => {
        if (!walletAddress || !escrow) return;
        setWalletRecordsLoading(true);
        setWalletRecordsError(null);
        try {
            let records: (ShieldCreditsRecordSummary | ShieldStablecoinRecordSummary)[];
            if (escrow.tokenType === TOKEN_TYPE.CREDITS) {
                records = await listShieldCreditsRecords();
            } else {
                const programId = stablecoinProgramId!;
                records = await listShieldStablecoinRecords(programId);
            }
            setWalletRecords(records);
            setWalletRecordsLoaded(true);
        } catch (caught: any) {
            setWalletRecords([]);
            setWalletRecordsLoaded(true);
            setWalletRecordsError(caught?.message || 'Failed to load Shield records.');
        } finally {
            setWalletRecordsLoading(false);
        }
    };

    useEffect(() => {
        if (!walletAddress || !escrow) return;
        void loadWalletRecords();
    }, [walletAddress, escrow?.tokenType]);

    useEffect(() => {
        if (!escrow) return;
        const approvedMilestone = escrow.milestones.find((milestone) => milestone.status === 'APPROVED' && !milestone.releaseTxId);
        if (approvedMilestone && !selectedMilestoneId) {
            setSelectedMilestoneId(approvedMilestone.id);
            setPartialAmount(approvedMilestone.targetAmount);
        }
        setMilestoneForms((current) => {
            const next = { ...current };
            for (const milestone of escrow.milestones) {
                next[milestone.id] = next[milestone.id] || {
                    evidenceHash: milestone.evidenceHash || '',
                    evidenceUrl: milestone.evidenceUrl || '',
                    note: milestone.evidenceNote || '',
                    reviewNote: milestone.reviewNote || '',
                    rejectionReason: milestone.rejectionReason || '',
                };
            }
            return next;
        });
    }, [escrow, selectedMilestoneId]);

    const releasePartial = async () => {
        if (!escrow || acting) return;
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/escrow/${encodeURIComponent(escrow.rfqId)}/release`,
                { amount: partialAmount, milestoneId: selectedMilestoneId || undefined },
                (_prepareData, txHash) => ({ amount: partialAmount, milestoneId: selectedMilestoneId || undefined, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to release partial payment.');
            toast.error(caught?.message || 'Failed to release partial payment.');
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
            toast.error(caught?.message || 'Failed to claim escrow.');
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
            toast.error(caught?.message || 'Failed to reclaim escrow.');
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
            toast.error(caught?.message || 'Failed to recover escrow bond.');
        } finally {
            setActing(false);
        }
    };

    const updateMilestoneForm = (
        milestoneId: string,
        key: 'evidenceHash' | 'evidenceUrl' | 'note' | 'reviewNote' | 'rejectionReason',
        value: string,
    ) => {
        setMilestoneForms((current) => ({
            ...current,
            [milestoneId]: {
                evidenceHash: '',
                evidenceUrl: '',
                note: '',
                reviewNote: '',
                rejectionReason: '',
                ...(current[milestoneId] || {}),
                [key]: value,
            },
        }));
    };

    const submitMilestoneEvidence = async (milestoneId: string) => {
        if (!escrow || milestoneBusyId) return;
        const form = milestoneForms[milestoneId];
        setMilestoneBusyId(milestoneId);
        setError(null);
        try {
            const response = await authenticatedFetch(`/api/escrow/${encodeURIComponent(escrow.rfqId)}/milestones/${encodeURIComponent(milestoneId)}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    evidenceHash: form?.evidenceHash || '',
                    evidenceUrl: form?.evidenceUrl || '',
                    note: form?.note || '',
                }),
            });
            const json = await response.json();
            if (!response.ok) throw new Error(json?.error?.message || 'Failed to submit evidence.');
            const refreshed = await authenticatedFetch(`/api/escrow/${encodeURIComponent(escrow.rfqId)}`);
            const refreshedJson = await refreshed.json().catch(() => null);
            if (refreshed.ok && refreshedJson?.data) {
                setEscrow(refreshedJson.data);
            }
            toast.success('Milestone evidence submitted.');
        } catch (caught: any) {
            setError(caught?.message || 'Failed to submit evidence.');
            toast.error(caught?.message || 'Failed to submit evidence.');
        } finally {
            setMilestoneBusyId(null);
        }
    };

    const reviewMilestoneEvidence = async (milestoneId: string, approve: boolean) => {
        if (!escrow || milestoneBusyId) return;
        const form = milestoneForms[milestoneId];
        setMilestoneBusyId(milestoneId);
        setError(null);
        try {
            const response = await authenticatedFetch(`/api/escrow/${encodeURIComponent(escrow.rfqId)}/milestones/${encodeURIComponent(milestoneId)}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    approve,
                    note: form?.reviewNote || '',
                    rejectionReason: form?.rejectionReason || '',
                }),
            });
            const json = await response.json();
            if (!response.ok) throw new Error(json?.error?.message || 'Failed to review milestone.');
            const refreshed = await authenticatedFetch(`/api/escrow/${encodeURIComponent(escrow.rfqId)}`);
            const refreshedJson = await refreshed.json().catch(() => null);
            if (refreshed.ok && refreshedJson?.data) {
                setEscrow(refreshedJson.data);
            }
            toast.success(approve ? 'Milestone approved.' : 'Milestone rejected.');
        } catch (caught: any) {
            setError(caught?.message || 'Failed to review milestone.');
            toast.error(caught?.message || 'Failed to review milestone.');
        } finally {
            setMilestoneBusyId(null);
        }
    };

    const payInvoice = async () => {
        if (!escrow || acting) return;
        setActing(true);
        setError(null);
        try {
            // Step 1: get the token record (and MerkleProofs for stablecoins) from Shield wallet
            let recordToUse = invoiceRecord.trim();
            let stablecoinProofA: string | null = null;
            let stablecoinProofB: string | null = null;
            if (!recordToUse) {
                if (escrow.tokenType === TOKEN_TYPE.CREDITS) {
                    recordToUse = await requestCreditsRecord(escrow.winningAmount);
                } else {
                    const programId = escrow.tokenType === TOKEN_TYPE.USDCX
                        ? 'test_usdcx_stablecoin.aleo'
                        : 'test_usad_stablecoin.aleo';
                    const { token, proofA, proofB } = await requestStablecoinRecordWithProofs(programId, escrow.winningAmount);
                    recordToUse = token;
                    stablecoinProofA = proofA;
                    stablecoinProofB = proofB;
                }
            }

            // Step 2: get prepare data from backend (returns 5 public inputs; record + proofs injected client-side)
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

            // Step 3: inject record at input[5], then proofs at input[6] for stablecoins
            const inputs = [...txRequest.inputs];
            inputs.splice(5, 0, recordToUse);
            if (stablecoinProofA && stablecoinProofB) {
                inputs.splice(6, 0, `[${stablecoinProofA}, ${stablecoinProofB}]`);
            }

            // Step 4: execute via ShieldWalletAdapter directly with the wallet-provided record plaintext
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
                payload: {
                    receiptNonce,
                    receiptHash: confirmJson?.data?.receiptHash ?? null,
                    txHash,
                },
                createdAt: new Date().toISOString(),
            });
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Invoice payment failed.');
            toast.error(caught?.message || 'Invoice payment failed.');
        } finally {
            setActing(false);
        }
    };

    const handleConfirm = () => {
        if (!confirm) return;
        const kind = confirm.kind;
        setConfirm(null);
        if (kind === 'releasePartial') releasePartial();
        if (kind === 'payInvoice') payInvoice();
        if (kind === 'winnerClaim') winnerClaim();
        if (kind === 'creatorReclaim') creatorReclaim();
        if (kind === 'recoverBond') recoverBond();
    };

    const confirmDetails = (): ConfirmDetail[] => {
        if (!escrow || !confirm) return [];
        if (confirm.kind === 'releasePartial') return [
            { label: 'Action', value: 'Release partial payment (public)' },
            { label: 'Milestone', value: selectedMilestoneId ? escrow.milestones.find((milestone) => milestone.id === selectedMilestoneId)?.title || 'Custom amount' : 'Custom amount' },
            { label: 'Gross amount', value: formatAmount(partialAmount, escrow.tokenType) },
            { label: 'Fee', value: formatAmount(feeAmount.toString(), escrow.tokenType) },
            { label: 'Winner receives', value: formatAmount(netAmount.toString(), escrow.tokenType) },
        ];
        if (confirm.kind === 'payInvoice') return [
            { label: 'Action', value: 'Pay invoice privately (Path B)' },
            { label: 'Invoice amount', value: formatAmount(escrow.winningAmount, escrow.tokenType) },
            { label: 'Path', value: 'Shield private record → winner' },
        ];
        if (confirm.kind === 'winnerClaim') return [
            { label: 'Action', value: 'Claim escrow as winner' },
            { label: 'Remaining escrow', value: formatAmount(escrow.remainingAmount, escrow.tokenType) },
        ];
        if (confirm.kind === 'creatorReclaim') return [
            { label: 'Action', value: 'Creator reclaim escrow' },
            { label: 'Remaining escrow', value: formatAmount(escrow.remainingAmount, escrow.tokenType) },
        ];
        if (confirm.kind === 'recoverBond') return [
            { label: 'Action', value: 'Recover escrow bond' },
            { label: 'Escrow total', value: formatAmount(escrow.totalAmount, escrow.tokenType) },
        ];
        return [];
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
    const approvedMilestones = escrow.milestones.filter((milestone) => milestone.status === 'APPROVED' && !milestone.releaseTxId);
    const selectedMilestone = approvedMilestones.find((milestone) => milestone.id === selectedMilestoneId) ?? null;
    const releasedSoFar = BigInt(escrow.releasedAmount);
    const isFullySettled = escrow.status === 'COMPLETED' || BigInt(escrow.remainingAmount) === 0n;
    const requiredPrivateAmount = BigInt(escrow.winningAmount);
    // Normalize record balance field — credits use `microcredits`, stablecoins use `amount`
    const getRecordBalance = (record: any): bigint | null =>
        record.microcredits ?? record.amount ?? null;
    const getRecordText = (record: any): string | null =>
        record.plaintext ?? null;
    const privateRecordLabel =
        escrow.tokenType === TOKEN_TYPE.CREDITS
            ? 'ALEO credits'
            : escrow.tokenType === TOKEN_TYPE.USDCX
              ? 'USDCx'
              : 'USAD';

    const unspentWalletRecords = walletRecords
        .filter((record) => !record.spent)
        .sort((a, b) => Number((getRecordBalance(b) ?? -1n) - (getRecordBalance(a) ?? -1n)));
    const eligibleWalletRecords = unspentWalletRecords.filter(
        (record) => getRecordBalance(record) !== null && getRecordBalance(record)! >= requiredPrivateAmount
    );
    const hiddenIneligibleRecords = unspentWalletRecords.filter(
        (record) => getRecordBalance(record) !== null && getRecordBalance(record)! < requiredPrivateAmount
    ).length;
    const hiddenUnparsedRecords = unspentWalletRecords.filter((record) => getRecordBalance(record) === null).length;
    const totalPrivateBalance = unspentWalletRecords.reduce((sum, record) => sum + (getRecordBalance(record) ?? 0n), 0n);
    const largestPrivateRecord = unspentWalletRecords.reduce(
        (largest, record) => {
            const bal = getRecordBalance(record);
            return bal !== null && bal > largest ? bal : largest;
        },
        0n
    );
    const settlementActionMode = escrow.paid
        ? 'Private-payment bond recovery'
        : releasedSoFar > 0n
          ? 'Partial-path remainder claim'
          : 'Full unpaid claim';
    const latestInvoiceReceipt = records.find((record) => record.type === 'InvoiceReceipt' && record.rfqId === escrow.rfqId);
    const savedReceiptNonce =
        latestInvoiceReceipt && typeof latestInvoiceReceipt.payload?.receiptNonce === 'string'
            ? latestInvoiceReceipt.payload.receiptNonce
            : null;
    const savedReceiptHash =
        latestInvoiceReceipt && typeof latestInvoiceReceipt.payload?.receiptHash === 'string'
            ? latestInvoiceReceipt.payload.receiptHash
            : escrow.receiptHash || null;
    const savedReceiptTxHash =
        latestInvoiceReceipt && typeof latestInvoiceReceipt.payload?.txHash === 'string'
            ? latestInvoiceReceipt.payload.txHash
            : null;
    const hasReceiptArtifact = Boolean(savedReceiptHash || savedReceiptNonce || savedReceiptTxHash);
    const pathBAvailable = true;

    return (
        <PageShell className="space-y-6">
            <PageHeader
                eyebrow="Settlement"
                eyebrowHref="/escrow"
                title={`Escrow for ${truncateMiddle(escrow.rfqId, 16, 10)}`}
                description={isFullySettled
                    ? 'This escrow has been fully settled. Review the settlement details below.'
                    : 'Manage public releases, view settlement status, and handle timeout protection actions from one place.'}
                actions={
                    <ActionBar>
                        <StatusChip status={escrow.status} />
                        <TokenChip tokenType={escrow.tokenType} label={escrow.tokenSymbol} />
                        <PricingChip pricingMode={escrow.pricingMode} />
                    </ActionBar>
                }
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {isFullySettled ? (
                <Notice tone="success" title="Settlement complete">
                    This escrow has been fully settled. The winner was paid and the escrow bond has been recovered. No further actions are needed.
                </Notice>
            ) : (
                <>
                    {!escrow.paid && escrow.currentBlock < escrow.recoveryBlock ? (
                        <Notice tone="neutral" title="Recovery window not yet open">
                            {escrow.pricingMode !== 0
                                ? `This RFQ used a ${escrow.pricingMode === 1 ? 'Vickrey' : 'Dutch'} auction. After the auction result was imported, the escrow recovery window opens at block ${escrow.recoveryBlock} — ${blockEta(escrow.recoveryBlock, escrow.currentBlock)} from now. Until then, settle via Path A (public release) or Path B (private invoice). Winner claim and creator reclaim unlock after that block.`
                                : `The escrow recovery window opens at block ${escrow.recoveryBlock} — ${blockEta(escrow.recoveryBlock, escrow.currentBlock)} from now. Winner claim and creator reclaim unlock after that block.`}
                        </Notice>
                    ) : null}
                    {escrow.settlementPathLocked ? (
                        <Notice title="Settlement path locked">
                            {escrow.settlementPathLocked === 'PRIVATE_PAYMENT'
                                ? 'Private payment has been made. Complete the escrow bond recovery below to finish settlement.'
                                : 'Public releases have started, so the private invoice path is disabled.'}
                        </Notice>
                    ) : null}
                </>
            )}

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                {/* ── Left column ── */}
                <div className="space-y-6">
                    <Panel title="Settlement summary">
                        <DataGrid columns={3}>
                            <DataPoint label="RFQ id" value={<CopyableText value={escrow.rfqId} displayValue={truncateMiddle(escrow.rfqId, 16, 10)} />} />
                            <DataPoint label="Winning amount" value={formatAmount(escrow.winningAmount, escrow.tokenType)} />
                            <DataPoint label="Released so far" value={formatAmount(escrow.releasedAmount, escrow.tokenType)} />
                            <DataPoint label="Remaining" value={formatAmount(escrow.remainingAmount, escrow.tokenType)} />
                            {!isFullySettled ? (
                                <>
                                    <DataPoint label="Current block" value={escrow.currentBlock} subtle="Live Aleo network block height." />
                                    <DataPoint
                                        label="Recovery window"
                                        value={escrow.currentBlock >= escrow.recoveryBlock ? 'Open now' : blockEta(escrow.recoveryBlock, escrow.currentBlock)}
                                        subtle={`Block ${escrow.recoveryBlock} — winner claim & creator reclaim unlock here.`}
                                    />
                                    <DataPoint
                                        label="Escrow timeout"
                                        value={escrow.currentBlock >= escrow.timeoutBlock ? 'Passed' : blockEta(escrow.timeoutBlock, escrow.currentBlock)}
                                        subtle={`Block ${escrow.timeoutBlock} — cancel-for-missing-escrow window.`}
                                    />
                                </>
                            ) : null}
                        </DataGrid>
                    </Panel>

                    {/* Settlement guide — always visible */}
                    <Panel
                        title="How settlement works"
                        subtitle="Follow these steps to complete settlement and recover your escrow."
                    >
                        <div className="space-y-3">
                            {[
                                {
                                    step: '1',
                                    title: 'Winner is selected',
                                    desc: 'After bidding and reveal close, the buyer selects a winner (or imports the result from a Vickrey / Dutch auction).',
                                    done: true,
                                },
                                {
                                    step: '2',
                                    title: 'Escrow is funded',
                                    desc: 'The buyer funds the winning amount into the on-chain escrow contract.',
                                    done: true,
                                },
                                {
                                    step: '3',
                                    title: 'Pay the winner',
                                    desc: escrow.paid
                                        ? 'Winner was paid via private invoice (Path B). Payment confirmed on-chain.'
                                        : releasedSoFar > 0n
                                          ? 'Partial public releases in progress (Path A).'
                                          : 'Choose Path A (public release) or Path B (private invoice) below to pay the winner.',
                                    done: escrow.paid || isFullySettled,
                                },
                                {
                                    step: '4',
                                    title: 'Recover escrow bond',
                                    desc: escrow.paid
                                        ? isFullySettled
                                            ? 'Escrow bond recovered. Settlement is complete.'
                                            : 'After private payment, use "Recover escrow bond" in the panel on the right to get your locked tokens back.'
                                        : 'After full public release, the escrow closes automatically. Or if unpaid, creator reclaim / winner claim open after the recovery window.',
                                    done: isFullySettled,
                                },
                            ].map((item) => (
                                <div key={item.step} className="flex gap-3">
                                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${item.done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/[0.08] text-white/40'}`}>
                                        {item.done ? '✓' : item.step}
                                    </div>
                                    <div className="min-w-0">
                                        <div className={`text-sm font-medium ${item.done ? 'text-emerald-200' : 'text-white'}`}>{item.title}</div>
                                        <div className="text-xs leading-5 text-white/50">{item.desc}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Panel>

                    {/* Settlement paths — tabbed (hidden when fully settled) */}
                    {!isFullySettled ? (
                    <Panel title="Settlement path">
                        {/* Tab bar */}
                        <div className="mb-5 flex gap-1 rounded-xl bg-white/[0.06] p-1">
                            <button
                                onClick={() => setSettlementTab('pathA')}
                                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                                    settlementTab === 'pathA'
                                        ? 'bg-white/[0.12] text-white'
                                        : 'text-white/50 hover:text-white/80'
                                }`}
                            >
                                Path A — Public release
                            </button>
                            <button
                                onClick={() => setSettlementTab('pathB')}
                                disabled={!pathBAvailable}
                                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${
                                    settlementTab === 'pathB'
                                        ? 'bg-white/[0.12] text-white'
                                        : 'text-white/50 hover:text-white/80'
                                }`}
                            >
                                Path B — Private invoice
                            </button>
                        </div>

                        {/* Path A */}
                        {settlementTab === 'pathA' && (
                            <div className="space-y-4">
                                <div className="text-sm text-white/55">Pay openly from escrow. The release amount is deducted from the escrow balance on-chain.</div>
                                <Field
                                    label="Approved milestone"
                                    hint="Choose an approved milestone to lock the release amount to a reviewed delivery checkpoint."
                                >
                                    <SelectInput
                                        value={selectedMilestoneId}
                                        onChange={(event) => {
                                            const milestoneId = event.target.value;
                                            setSelectedMilestoneId(milestoneId);
                                            const milestone = approvedMilestones.find((item) => item.id === milestoneId);
                                            if (milestone) {
                                                setPartialAmount(milestone.targetAmount);
                                            }
                                        }}
                                    >
                                        <option value="">Custom amount</option>
                                        {approvedMilestones.map((milestone) => (
                                            <option key={milestone.id} value={milestone.id}>
                                                {`${milestone.sequence}. ${milestone.title}`}
                                            </option>
                                        ))}
                                    </SelectInput>
                                </Field>
                                {selectedMilestone ? (
                                    <DeliveryMilestoneCard milestone={selectedMilestone} tokenType={escrow.tokenType} />
                                ) : null}
                                <Field label="Release amount" hint="Enter the gross amount in raw micro-units.">
                                    <TextInput
                                        value={partialAmount}
                                        onChange={(event) => {
                                            setSelectedMilestoneId('');
                                            setPartialAmount(event.target.value);
                                        }}
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
                                    <Button disabled={!isCreator || escrow.paid || acting} isLoading={acting} onClick={() => setConfirm({ kind: 'releasePartial' })}>
                                        Release payment
                                    </Button>
                                    <div className="text-sm text-[hsl(var(--muted-foreground))]">
                                        {escrow.paid
                                            ? 'Private payment is already recorded.'
                                            : selectedMilestone
                                              ? 'This release will be linked to the approved milestone above.'
                                              : 'Use this only if you are staying on the public release path.'}
                                    </div>
                                </ActionBar>
                            </div>
                        )}

                        {/* Path B */}
                        {settlementTab === 'pathB' && pathBAvailable && (
                            <div className="space-y-4">
                                <div className="text-sm text-white/55">
                                    Pay privately using a token record from your Shield wallet. The escrow bond is not consumed — payment goes directly to the winner.
                                </div>
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
                                <DataGrid columns={3}>
                                    <DataPoint label="Unspent records" value={unspentWalletRecords.length} />
                                    <DataPoint
                                        label="Largest record"
                                        value={largestPrivateRecord > 0n ? formatAmount(largestPrivateRecord.toString(), escrow.tokenType) : '--'}
                                    />
                                    <DataPoint
                                        label="Total private balance"
                                        value={totalPrivateBalance > 0n ? formatAmount(totalPrivateBalance.toString(), escrow.tokenType) : '--'}
                                        subtle={
                                            eligibleWalletRecords.length > 0
                                                ? `${eligibleWalletRecords.length} record${eligibleWalletRecords.length === 1 ? '' : 's'} eligible`
                                                : 'One record must individually cover the invoice'
                                        }
                                    />
                                </DataGrid>

                                {/* Shield records */}
                                <div className="rounded-xl border border-white/12 bg-white/[0.04] p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-semibold text-white">{`Shield private ${privateRecordLabel} records`}</div>
                                            <div className="text-xs leading-5 text-white/55">Only records that individually cover the invoice are shown.</div>
                                        </div>
                                        <Button variant="secondary" size="sm" isLoading={walletRecordsLoading} onClick={() => void loadWalletRecords()}>
                                            Refresh records
                                        </Button>
                                    </div>
                                    {walletRecordsError ? (
                                        <div className="mt-4"><Notice tone="danger">{walletRecordsError}</Notice></div>
                                    ) : null}
                                    {!walletRecordsLoading && walletRecordsLoaded && unspentWalletRecords.length === 0 ? (
                                        <div className="mt-4 text-sm text-white/60">{`No unspent private ${privateRecordLabel} records found in Shield for this wallet.`}</div>
                                    ) : null}
                                    {!walletRecordsLoading && walletRecordsLoaded && eligibleWalletRecords.length === 0 && unspentWalletRecords.length > 0 ? (
                                        <div className="mt-4 space-y-3">
                                            <Notice tone="warning" title="No eligible record">
                                                No single Shield record can cover this invoice yet.
                                            </Notice>
                                            <div className="text-xs text-white/55">
                                                Hidden: {hiddenIneligibleRecords} too small, {hiddenUnparsedRecords} unparsed.
                                            </div>
                                        </div>
                                    ) : null}
                                    {walletRecordsLoaded && eligibleWalletRecords.length > 0 ? (
                                        <div className="mt-4 space-y-2">
                                            {eligibleWalletRecords.map((record) => {
                                                const pt = getRecordText(record);
                                                const bal = getRecordBalance(record);
                                                const isSelected = !!pt && invoiceRecord.trim() === pt.trim();
                                                return (
                                                    <div
                                                        key={record.id}
                                                        className={`rounded-xl border p-3 transition-colors ${
                                                            isSelected ? 'border-emerald-300/40 bg-emerald-400/10' : 'border-white/12 bg-white/[0.05]'
                                                        }`}
                                                    >
                                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                                            <div className="space-y-0.5">
                                                                <div className="text-sm font-medium text-white">
                                                                    {bal !== null
                                                                        ? formatAmount(bal.toString(), escrow.tokenType)
                                                                        : 'Unknown balance'}
                                                                </div>
                                                                <div className="text-xs text-white/55">Can cover this invoice</div>
                                                            </div>
                                                            <Button
                                                                variant={isSelected ? 'primary' : 'secondary'}
                                                                size="sm"
                                                                disabled={!pt}
                                                                onClick={() => setInvoiceRecord(pt || '')}
                                                            >
                                                                {isSelected ? 'Selected' : 'Use record'}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {hiddenIneligibleRecords > 0 || hiddenUnparsedRecords > 0 ? (
                                                <div className="pt-1 text-xs text-white/50">
                                                    Hidden: {hiddenIneligibleRecords} too small, {hiddenUnparsedRecords} unparsed.
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>

                                <ActionBar>
                                    <Button
                                        disabled={!isCreator || escrow.paid || acting || escrow.settlementPathLocked === 'PARTIAL_RELEASES'}
                                        isLoading={acting}
                                        onClick={() => setConfirm({ kind: 'payInvoice' })}
                                    >
                                        Pay invoice privately
                                    </Button>
                                    <div className="text-sm text-white/55">
                                        {escrow.paid
                                            ? 'Invoice already paid.'
                                            : escrow.settlementPathLocked === 'PARTIAL_RELEASES'
                                              ? 'Cannot use Path B after public releases.'
                                              : 'Uses a Shield private record for this token.'}
                                    </div>
                                </ActionBar>
                            </div>
                        )}

                    </Panel>
                    ) : null}
                </div>

                {/* ── Right column ── */}
                <div className="space-y-6">
                    <Panel title={isFullySettled ? 'Settlement details' : 'Roles and timeout actions'}>
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
                            <InfoRow label="Private payment" value={escrow.paid ? 'Complete' : 'Pending'} />
                            <InfoRow label="Settlement mode" value={settlementActionMode} />
                        </InfoList>
                        <div className="mt-4 space-y-3">
                            <CounterpartyProfileCard title="Buyer scorecard" profile={escrow.creatorProfile} compact />
                            <CounterpartyProfileCard title="Winner scorecard" profile={escrow.winnerProfile} compact />
                        </div>
                        {!isFullySettled ? (
                            <>
                                <ActionBar className="mt-4">
                                    {escrow.paid ? (
                                        <Button disabled={!isCreator || !escrow.canRecoverBond || acting} isLoading={acting} onClick={() => setConfirm({ kind: 'recoverBond' })}>
                                            Recover escrow bond
                                        </Button>
                                    ) : (
                                        <>
                                            <Button disabled={!isWinner || !escrow.canWinnerClaim || acting} isLoading={acting} onClick={() => setConfirm({ kind: 'winnerClaim' })}>
                                                Claim escrow
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                disabled={!isCreator || !escrow.canCreatorReclaim || acting}
                                                isLoading={acting}
                                                onClick={() => setConfirm({ kind: 'creatorReclaim' })}
                                            >
                                                Creator reclaim
                                            </Button>
                                        </>
                                    )}
                                </ActionBar>
                                <div className="mt-3 text-sm text-white/55">
                                    {escrow.paid && escrow.canRecoverBond
                                        ? 'Private payment confirmed. You can now recover the remaining escrow bond.'
                                        : escrow.paid && !escrow.canRecoverBond
                                          ? 'Private payment recorded, but there is no remaining escrow balance to recover.'
                                          : escrow.currentBlock < escrow.recoveryBlock
                                            ? `Recovery window opens ${blockEta(escrow.recoveryBlock, escrow.currentBlock)} (block ${escrow.recoveryBlock}). Winner claim and creator reclaim unlock after that point.`
                                            : 'Recovery window is open. Use winner claim or creator reclaim — these actions are only available when the private invoice path was not used.'}
                                </div>
                            </>
                        ) : (
                            <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3 text-sm text-emerald-200">
                                All settlement actions are complete. The winner has been paid and the escrow bond has been returned to the creator.
                            </div>
                        )}
                        <ActionBar className="mt-4">
                            <Link href={`/audit/${encodeURIComponent(escrow.rfqId)}`}>
                                <Button variant="secondary">Open audit trail</Button>
                            </Link>
                        </ActionBar>
                    </Panel>

                    {hasReceiptArtifact ? (
                        <Panel
                            title="Private payment receipt"
                            subtitle="Protocol-level receipt — valid even after the escrow bond is recovered."
                        >
                            <DataGrid columns={2}>
                                <DataPoint
                                    label="Receipt hash"
                                    value={
                                        savedReceiptHash ? (
                                            <CopyableText value={savedReceiptHash} displayValue={truncateMiddle(savedReceiptHash, 18, 12)} mono />
                                        ) : '--'
                                    }
                                    subtle="Stored on-chain in the RFQ receipts mapping."
                                />
                                <DataPoint
                                    label="Receipt nonce"
                                    value={
                                        savedReceiptNonce ? (
                                            <CopyableText value={savedReceiptNonce} displayValue={truncateMiddle(savedReceiptNonce, 18, 12)} mono />
                                        ) : '--'
                                    }
                                    subtle={savedReceiptNonce ? 'Saved in this browser.' : 'Not in local browser storage.'}
                                />
                                {savedReceiptTxHash ? (
                                    <DataPoint
                                        label="Invoice tx"
                                        value={<CopyableText value={savedReceiptTxHash} displayValue={truncateMiddle(savedReceiptTxHash, 18, 12)} mono />}
                                    />
                                ) : null}
                            </DataGrid>
                        </Panel>
                    ) : null}

                    <Panel title="Delivery assurance">
                        <DataGrid columns={4}>
                            <DataPoint label="Milestones" value={escrow.deliverySummary?.milestoneCount ?? 0} />
                            <DataPoint label="Submitted" value={escrow.deliverySummary?.submittedCount ?? 0} />
                            <DataPoint label="Approved" value={escrow.deliverySummary?.approvedCount ?? 0} />
                            <DataPoint label="Released" value={escrow.deliverySummary?.releasedCount ?? 0} />
                        </DataGrid>
                        {escrow.milestones.length === 0 ? (
                            <div className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
                                No delivery milestones have been planned yet. Return to the buyer RFQ page to define the release checkpoints.
                            </div>
                        ) : (
                            <div className="mt-4 space-y-3">
                                {escrow.milestones.map((milestone) => {
                                    const form = milestoneForms[milestone.id] || {
                                        evidenceHash: '',
                                        evidenceUrl: '',
                                        note: '',
                                        reviewNote: '',
                                        rejectionReason: '',
                                    };

                                    return (
                                        <DeliveryMilestoneCard
                                            key={milestone.id}
                                            milestone={milestone}
                                            tokenType={escrow.tokenType}
                                            actions={
                                                <div className="space-y-4">
                                                    {isWinner && ['PLANNED', 'REJECTED', 'SUBMITTED'].includes(milestone.status) ? (
                                                        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Vendor evidence</div>
                                                            <div className="grid gap-3 lg:grid-cols-3">
                                                                <Field label="Evidence hash">
                                                                    <TextInput value={form.evidenceHash} onChange={(event) => updateMilestoneForm(milestone.id, 'evidenceHash', event.target.value)} placeholder="ipfs/sha256 hash" />
                                                                </Field>
                                                                <Field label="Evidence link">
                                                                    <TextInput value={form.evidenceUrl} onChange={(event) => updateMilestoneForm(milestone.id, 'evidenceUrl', event.target.value)} placeholder="https://..." />
                                                                </Field>
                                                                <Field label="Delivery note">
                                                                    <TextInput value={form.note} onChange={(event) => updateMilestoneForm(milestone.id, 'note', event.target.value)} placeholder="What was delivered" />
                                                                </Field>
                                                            </div>
                                                            <ActionBar>
                                                                <Button size="sm" isLoading={milestoneBusyId === milestone.id} onClick={() => submitMilestoneEvidence(milestone.id)}>
                                                                    {milestone.status === 'SUBMITTED' ? 'Resubmit evidence' : 'Submit evidence'}
                                                                </Button>
                                                            </ActionBar>
                                                        </div>
                                                    ) : null}

                                                    {isCreator && milestone.status === 'SUBMITTED' ? (
                                                        <div className="space-y-3 rounded-xl border border-blue-300/20 bg-blue-400/[0.06] p-4">
                                                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200/70">Buyer review</div>
                                                            <div className="grid gap-3 lg:grid-cols-2">
                                                                <Field label="Review note">
                                                                    <TextInput value={form.reviewNote} onChange={(event) => updateMilestoneForm(milestone.id, 'reviewNote', event.target.value)} placeholder="Acceptance note" />
                                                                </Field>
                                                                <Field label="Rejection reason">
                                                                    <TextInput value={form.rejectionReason} onChange={(event) => updateMilestoneForm(milestone.id, 'rejectionReason', event.target.value)} placeholder="Only required when rejecting" />
                                                                </Field>
                                                            </div>
                                                            <ActionBar>
                                                                <Button size="sm" isLoading={milestoneBusyId === milestone.id} onClick={() => reviewMilestoneEvidence(milestone.id, true)}>
                                                                    Approve milestone
                                                                </Button>
                                                                <Button size="sm" variant="danger" isLoading={milestoneBusyId === milestone.id} onClick={() => reviewMilestoneEvidence(milestone.id, false)}>
                                                                    Reject milestone
                                                                </Button>
                                                            </ActionBar>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            }
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </Panel>

                    <Panel title="Settlement history">
                        {escrow.payments.length === 0 ? (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">No public settlement releases recorded yet.</div>
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
                            <TxStatusView
                                idempotencyKey={txKey}
                                compact={true}
                                onConfirmed={() => toast.success('Transaction confirmed on-chain.')}
                            />
                        </Panel>
                    ) : null}
                </div>
            </div>

            <ConfirmModal
                open={confirm !== null}
                title="Confirm transaction"
                description="Review the details below before your Shield wallet opens."
                details={confirmDetails()}
                confirmLabel="Confirm & sign"
                loading={acting}
                onConfirm={handleConfirm}
                onCancel={() => setConfirm(null)}
            />
        </PageShell>
    );
}
