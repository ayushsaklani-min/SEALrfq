'use client';

import { useEffect, useState } from 'react';
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
    StatusChip,
    TextInput,
    TokenChip,
} from '@/components/protocol/ProtocolPrimitives';
import { useWallet } from '@/contexts/WalletContext';
import { authenticatedFetch } from '@/lib/authFetch';
import { calculateFee, formatAmount, netAfterFee, randomField, TOKEN_TYPE } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';
import { executeWithAdapter, listShieldCreditsRecords, listShieldStablecoinRecords, requestCreditsRecord, requestStablecoinRecord, submitTrackedResult, type ShieldCreditsRecordSummary, type ShieldStablecoinRecordSummary, walletFirstTx } from '@/lib/walletTx';
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

    const payInvoice = async () => {
        if (!escrow || acting) return;
        setActing(true);
        setError(null);
        try {
            // Step 1: get the token record plaintext from Shield wallet
            let recordToUse = invoiceRecord.trim();
            if (!recordToUse) {
                if (escrow.tokenType === TOKEN_TYPE.CREDITS) {
                    recordToUse = await requestCreditsRecord(escrow.winningAmount);
                } else {
                    const programId = escrow.tokenType === TOKEN_TYPE.USDCX
                        ? 'test_usdcx_stablecoin.aleo'
                        : 'test_usad_stablecoin.aleo';
                    recordToUse = await requestStablecoinRecord(programId, escrow.winningAmount);
                }
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
    const releasedSoFar = BigInt(escrow.releasedAmount);
    const requiredPrivateAmount = BigInt(escrow.winningAmount);
    // Normalize record balance field — credits use `microcredits`, stablecoins use `amount`
    const getRecordBalance = (record: any): bigint | null =>
        record.microcredits ?? record.amount ?? null;
    const getRecordText = (record: any): string | null =>
        record.plaintext ?? null;

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
                {/* ── Left column ── */}
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

                    {/* Settlement paths — tabbed */}
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
                                    <Button disabled={!isCreator || escrow.paid || acting} isLoading={acting} onClick={() => setConfirm({ kind: 'releasePartial' })}>
                                        Release payment
                                    </Button>
                                    <div className="text-sm text-[hsl(var(--muted-foreground))]">
                                        {escrow.paid ? 'Private payment is already recorded.' : 'Use this only if you are staying on the public release path.'}
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
                                            <div className="text-sm font-semibold text-white">Shield private credits</div>
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
                                        <div className="mt-4 text-sm text-white/60">No unspent private records found in Shield for this wallet.</div>
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
                </div>

                {/* ── Right column ── */}
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
                            <InfoRow label="Private payment" value={escrow.paid ? 'Complete' : 'Pending'} />
                            <InfoRow label="Settlement mode" value={settlementActionMode} />
                        </InfoList>
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
                            {escrow.paid
                                ? 'Winner was paid privately. Recover the remaining escrow bond from this panel.'
                                : 'Use winner claim or creator reclaim only when the invoice path has not been used.'}
                        </div>
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

                    <Panel title="Milestones">
                        {escrow.payments.length === 0 ? (
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">No settlement milestones recorded yet.</div>
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
