'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TxStatusView } from '@/components/TxStatus';
import { walletFirstTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';
import ConfirmDialog from '@/components/ConfirmDialog';
import CopyButton from '@/components/CopyButton';

type EscrowResponse = {
    id: string;
    rfqId: string;
    totalAmount: string;
    releasedAmount: string;
    remainingAmount: string;
    payments: Array<{ id: string; amount: string; isFinal: boolean }>;
};

function microToAleo(microcredits: string | bigint): string {
    try {
        const n = typeof microcredits === 'bigint' ? microcredits : BigInt(microcredits);
        const whole = n / 1_000_000n;
        const frac = n % 1_000_000n;
        if (frac === 0n) return `${whole} ALEO`;
        const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
        return `${whole}.${fracStr} ALEO`;
    } catch {
        return microcredits.toString();
    }
}

export default function ReleasePaymentPage({ params }: { params: { rfqId: string } }) {
    const router = useRouter();
    const rfqId = params.rfqId;

    const [escrow, setEscrow] = useState<EscrowResponse | null>(null);
    const [amount, setAmount] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await authenticatedFetch(`/api/escrow/${rfqId}`);
                const json = await res.json();
                if (!res.ok) {
                    throw new Error(json.error?.message || 'Failed to load escrow');
                }
                setEscrow(json.data);
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [rfqId]);

    const remaining = useMemo(() => BigInt(escrow?.remainingAmount || '0'), [escrow]);
    const released = useMemo(() => BigInt(escrow?.releasedAmount || '0'), [escrow]);

    const doRelease = async () => {
        if (submitting) return;
        setShowConfirm(false);
        setSubmitting(true);
        setError(null);
        try {
            const value = BigInt(amount);
            if (value <= BigInt(0) || value > remaining) {
                throw new Error(`Amount must be between 1 and ${remaining.toString()}`);
            }

            const result = await walletFirstTx(
                `/api/escrow/${rfqId}/release`,
                { amount: value.toString() },
                (_prepareData, txHash) => ({ amount: value.toString(), txHash }),
            );
            setIdempotencyKey(result.idempotencyKey);
        } catch (e: any) {
            setError(e.message);
            setSubmitting(false);
        }
    };

    if (loading) return <div className="p-8 text-gray-400">Loading escrow...</div>;
    if (error && !submitting) return <div className="p-8 text-red-400">{error}</div>;
    if (!escrow) return <div className="p-8 text-red-400">Escrow not found</div>;

    if (idempotencyKey) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-4">Releasing Payment</h1>
                <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} />
                <button
                    className="mt-6 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20"
                    onClick={() => router.push(`/escrow/${rfqId}`)}
                >
                    Back To Escrow
                </button>
            </div>
        );
    }

    const entered = amount ? BigInt(amount) : BigInt(0);
    const nextReleased = released + entered;
    const nextRemaining = remaining - entered;
    const isFullRelease = entered > 0n && entered === remaining;

    return (
        <div className="max-w-3xl mx-auto py-10 px-4">
            <h1 className="text-3xl font-bold mb-6">Release Payment</h1>
            <div className="glass p-6 rounded-2xl border border-white/10 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                        <div className="text-gray-400 mb-1">RFQ ID</div>
                        <CopyButton text={escrow.rfqId} />
                    </div>
                    <div>
                        <div className="text-gray-400 mb-1">Total Escrowed</div>
                        <div className="font-semibold text-white">{microToAleo(escrow.totalAmount)}</div>
                    </div>
                    <div>
                        <div className="text-gray-400 mb-1">Already Released</div>
                        <div className="text-green-400">{microToAleo(escrow.releasedAmount)}</div>
                    </div>
                    <div>
                        <div className="text-gray-400 mb-1">Remaining</div>
                        <div className="text-cyan-300 font-semibold">{microToAleo(escrow.remainingAmount)}</div>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Amount to release (microcredits)
                    </label>
                    <input
                        type="number"
                        className="w-full p-3 rounded-xl bg-black/40 border border-white/10 font-mono"
                        min="1"
                        max={remaining.toString()}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                        placeholder={`Max: ${remaining.toString()}`}
                    />
                    {amount && entered > 0n && (
                        <p className="mt-1 text-xs text-gray-400">
                            = {microToAleo(entered)}
                            {isFullRelease && <span className="ml-2 text-amber-400">(full release)</span>}
                        </p>
                    )}
                </div>

                {amount && entered > 0n && (
                    <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-sm space-y-1">
                        <p className="text-gray-400">After release:</p>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Released</span>
                            <span className="text-green-400">{microToAleo(nextReleased)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Remaining</span>
                            <span className="text-cyan-300">{microToAleo(nextRemaining)}</span>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                        {error}
                    </div>
                )}

                <button
                    disabled={submitting || !amount || entered <= 0n}
                    onClick={() => setShowConfirm(true)}
                    className="w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {submitting ? 'Submitting...' : 'Release Payment'}
                </button>
            </div>

            <ConfirmDialog
                open={showConfirm}
                title={isFullRelease ? 'Release Full Payment?' : 'Release Partial Payment?'}
                description={
                    isFullRelease
                        ? 'This will release the entire remaining escrow balance to the vendor. This action is irreversible.'
                        : 'This will release funds from the escrow contract to the vendor. This action is irreversible.'
                }
                details={[
                    { label: 'RFQ ID', value: escrow.rfqId },
                    { label: 'Amount to Release', value: entered > 0n ? microToAleo(entered) : '' },
                    { label: 'Remaining After', value: entered > 0n ? microToAleo(nextRemaining) : '' },
                ]}
                confirmLabel="Release Payment"
                variant={isFullRelease ? 'warning' : 'primary'}
                loading={submitting}
                onConfirm={doRelease}
                onCancel={() => setShowConfirm(false)}
            />
        </div>
    );
}
