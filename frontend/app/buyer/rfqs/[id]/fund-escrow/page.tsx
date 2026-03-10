'use client';

import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { walletFirstTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';
import ConfirmDialog from '@/components/ConfirmDialog';
import CopyButton from '@/components/CopyButton';

type RFQ = {
    id: string;
    status: string;
    winningBidAmount?: string | null;
    winningVendor?: string | null;
    winnerAccepted?: boolean | null;
    estimatedFundEscrowFee?: string | null;
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

export default function FundEscrowPage({ params }: { params: { id: string } }) {
    const rfqId = params.id;
    const [rfq, setRfq] = useState<RFQ | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await authenticatedFetch(`/api/rfq/${rfqId}`);
                const json = await res.json();
                if (!res.ok) {
                    throw new Error(json.error?.message || 'Failed to load RFQ');
                }
                setRfq(json.data);
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [rfqId]);

    const doFundEscrow = async () => {
        if (submitting) return;
        setShowConfirm(false);
        setSubmitting(true);
        setError(null);

        try {
            if (!rfq?.winningBidAmount) {
                throw new Error('Winning bid amount is not available for this RFQ');
            }
            if (rfq.winnerAccepted !== true) {
                throw new Error('The selected vendor must accept the award before escrow can be funded');
            }

            const value = BigInt(rfq.winningBidAmount);
            const result = await walletFirstTx(
                `/api/rfq/${rfqId}/fund-escrow`,
                { amount: value.toString() },
                (_prepareData, txHash) => ({ amount: value.toString(), txHash }),
            );
            setIdempotencyKey(result.idempotencyKey);
        } catch (e: any) {
            setError(e.message);
            setSubmitting(false);
        }
    };

    if (loading) return <div className="p-8 text-gray-400">Loading RFQ...</div>;
    if (!rfq) return <div className="p-8 text-red-400">{error || 'RFQ not found'}</div>;

    const winningBidAmount = rfq.winningBidAmount || '';
    const estimatedFundFee = rfq.estimatedFundEscrowFee || '';
    const winningBidLabel = winningBidAmount ? microToAleo(winningBidAmount) : null;
    const estimatedFeeLabel = estimatedFundFee ? microToAleo(estimatedFundFee) : null;
    const totalRequired =
        winningBidAmount && estimatedFundFee
            ? microToAleo(BigInt(winningBidAmount) + BigInt(estimatedFundFee))
            : null;

    if (idempotencyKey) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-4">Funding Escrow</h1>
                <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} />
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto py-10 px-4">
            <h1 className="text-3xl font-bold mb-6">Fund Escrow</h1>
            <div className="glass p-6 rounded-2xl border border-white/10 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                        <div className="text-gray-400 mb-1">RFQ ID</div>
                        <CopyButton text={rfq.id} />
                    </div>
                    <div>
                        <div className="text-gray-400 mb-1">Status</div>
                        <div className="text-white">{rfq.status}</div>
                    </div>
                    {rfq.winningVendor && (
                        <div className="md:col-span-2">
                            <div className="text-gray-400 mb-1">Winning Vendor</div>
                            <CopyButton text={rfq.winningVendor} />
                        </div>
                    )}
                    <div>
                        <div className="text-gray-400 mb-1">Winner Acceptance</div>
                        <div className={rfq.winnerAccepted === true ? 'text-green-400' : 'text-amber-400'}>
                            {rfq.winnerAccepted === true
                                ? 'Accepted'
                                : rfq.winnerAccepted === false
                                  ? 'Pending vendor acceptance'
                                  : 'Unknown'}
                        </div>
                    </div>
                </div>

                <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-400">Escrow Amount</span>
                        <span className="font-semibold text-white">
                            {winningBidLabel ?? <span className="text-amber-300 text-xs">Not available</span>}
                        </span>
                    </div>
                    {estimatedFeeLabel && (
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Est. network fee</span>
                            <span className="text-gray-400">{estimatedFeeLabel}</span>
                        </div>
                    )}
                    {totalRequired && (
                        <div className="flex justify-between border-t border-white/10 pt-2 text-xs">
                            <span className="text-gray-400">Total wallet balance needed</span>
                            <span className="text-cyan-300 font-semibold">{totalRequired}</span>
                        </div>
                    )}
                </div>

                {rfq.winnerAccepted === false && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                        The selected vendor must accept the award first. Ask the winning vendor to open their dashboard and accept before funding escrow.
                    </div>
                )}

                {error && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                        {error}
                    </div>
                )}

                <button
                    disabled={submitting || !winningBidAmount || rfq.winnerAccepted !== true}
                    onClick={() => setShowConfirm(true)}
                    className="w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {submitting
                        ? 'Submitting...'
                        : rfq.winnerAccepted === true
                          ? 'Fund Escrow'
                          : 'Waiting For Winner Acceptance'}
                </button>
            </div>

            <ConfirmDialog
                open={showConfirm}
                title="Fund Escrow?"
                description="This will lock funds on-chain in the escrow contract. The amount will be released to the vendor upon delivery confirmation."
                details={[
                    { label: 'RFQ ID', value: rfq.id },
                    { label: 'Winning Vendor', value: rfq.winningVendor ?? 'N/A' },
                    { label: 'Escrow Amount', value: winningBidLabel ?? 'N/A' },
                    ...(totalRequired ? [{ label: 'Total Required (incl. fees)', value: totalRequired }] : []),
                ]}
                confirmLabel="Fund Escrow"
                variant="primary"
                loading={submitting}
                onConfirm={doFundEscrow}
                onCancel={() => setShowConfirm(false)}
            />
        </div>
    );
}
