'use client';

import { useEffect, useMemo, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { walletFirstTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';
import ConfirmDialog from '@/components/ConfirmDialog';
import CopyButton from '@/components/CopyButton';

type Bid = {
    id: string;
    vendor: string;
    revealedAmount: string | null;
    stake: string;
    isRevealed: boolean;
};

type RFQ = {
    id: string;
    status: string;
    minBid: string;
};

const toBig = (v: string | null | undefined) => BigInt(v || '0');

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

export default function SelectWinnerPage({ params }: { params: { id: string } }) {
    const rfqId = params.id;
    const [rfq, setRfq] = useState<RFQ | null>(null);
    const [bids, setBids] = useState<Bid[]>([]);
    const [selectedBid, setSelectedBid] = useState<string | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const [rfqRes, bidsRes] = await Promise.all([
                    authenticatedFetch(`/api/rfq/${rfqId}`),
                    authenticatedFetch(`/api/rfq/${rfqId}/bids`),
                ]);
                const [rfqJson, bidsJson] = await Promise.all([rfqRes.json(), bidsRes.json()]);
                if (!rfqRes.ok || !bidsRes.ok) {
                    throw new Error(rfqJson.error?.message || bidsJson.error?.message || 'Load failed');
                }

                setRfq(rfqJson.data);
                setBids(bidsJson.data);
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [rfqId]);

    const revealedSorted = useMemo(() => {
        return bids
            .filter((b) => b.isRevealed)
            .sort((a, b) => {
                const aAmt = toBig(a.revealedAmount);
                const bAmt = toBig(b.revealedAmount);
                if (aAmt < bAmt) return -1;
                if (aAmt > bAmt) return 1;
                return a.id.localeCompare(b.id);
            });
    }, [bids]);

    useEffect(() => {
        if (!selectedBid && revealedSorted.length > 0) {
            setSelectedBid(revealedSorted[0].id);
        }
    }, [revealedSorted, selectedBid]);

    const selectedBidData = useMemo(
        () => revealedSorted.find((b) => b.id === selectedBid) ?? null,
        [revealedSorted, selectedBid],
    );

    const submitWinner = async () => {
        if (!selectedBid || submitting) return;
        setShowConfirm(false);
        setSubmitting(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/rfq/${rfqId}/select-winner`,
                { winningBidId: selectedBid },
                (_prepareData, txHash) => ({ winningBidId: selectedBid, txHash }),
            );
            setIdempotencyKey(result.idempotencyKey);
        } catch (e: any) {
            setError(e.message);
            setSubmitting(false);
        }
    };

    if (loading) return <div className="p-8 text-gray-400">Loading bids...</div>;
    if (error && !submitting) return <div className="p-8 text-red-400">{error}</div>;
    if (!rfq) return <div className="p-8 text-red-400">RFQ not found</div>;

    if (idempotencyKey) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-4">Selecting Winner</h1>
                <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto py-10 px-4">
            <h1 className="text-3xl font-bold mb-2">Select Winner</h1>
            <div className="flex items-center gap-1 mb-6">
                <p className="text-gray-400 text-sm">RFQ:</p>
                <CopyButton text={rfq.id} />
            </div>

            <div className="glass p-6 rounded-2xl border border-white/10">
                <div className="flex items-center gap-4 mb-4 text-sm">
                    <span className="text-gray-400">Status: <span className="text-white">{rfq.status}</span></span>
                    <span className="text-gray-400">Min bid: <span className="text-white font-semibold">{microToAleo(rfq.minBid)}</span></span>
                </div>

                {revealedSorted.length === 0 ? (
                    <p className="text-gray-300">No revealed bids yet.</p>
                ) : (
                    <>
                        <p className="text-xs text-cyan-400/70 mb-3">Lowest bid is pre-selected. Click a row to change selection.</p>
                        <div className="space-y-3">
                            {revealedSorted.map((bid, i) => (
                                <label
                                    key={bid.id}
                                    className={`block p-4 rounded-xl border cursor-pointer transition-colors ${
                                        selectedBid === bid.id
                                            ? 'border-primary-500 bg-primary-900/20'
                                            : 'border-white/10 bg-white/5 hover:border-white/20'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="radio"
                                            name="winner"
                                            checked={selectedBid === bid.id}
                                            onChange={() => setSelectedBid(bid.id)}
                                        />
                                        <span className="text-gray-400 text-sm w-6">#{i + 1}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-semibold text-white">
                                                    {microToAleo(bid.revealedAmount ?? '0')}
                                                </span>
                                                <span className="text-gray-500 text-xs">
                                                    ({Number(bid.revealedAmount).toLocaleString()} microcredits)
                                                </span>
                                                {i === 0 && (
                                                    <span className="px-1.5 py-0.5 rounded text-xs bg-green-500/15 text-green-400 border border-green-500/20">
                                                        Lowest
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                                                <span>Bid ID:</span><CopyButton text={bid.id} />
                                            </div>
                                            <div className="flex items-center gap-1 text-xs text-gray-400">
                                                <span>Vendor:</span><CopyButton text={bid.vendor} />
                                            </div>
                                        </div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </>
                )}

                {error && (
                    <div className="mt-4 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
                        {error}
                    </div>
                )}

                <button
                    className="mt-6 w-full p-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!selectedBid || submitting}
                    onClick={() => setShowConfirm(true)}
                >
                    {submitting ? 'Submitting...' : 'Confirm Winner'}
                </button>
            </div>

            <ConfirmDialog
                open={showConfirm}
                title="Select Winner?"
                description="This is irreversible on-chain. The selected vendor will be awarded the contract and escrow funding will be required."
                details={[
                    { label: 'RFQ ID', value: rfq.id },
                    { label: 'Winning Bid ID', value: selectedBid ?? '' },
                    { label: 'Vendor', value: selectedBidData?.vendor ?? '' },
                    { label: 'Bid Amount', value: selectedBidData ? microToAleo(selectedBidData.revealedAmount ?? '0') : '' },
                ]}
                confirmLabel="Select Winner"
                variant="primary"
                loading={submitting}
                onConfirm={submitWinner}
                onCancel={() => setShowConfirm(false)}
            />
        </div>
    );
}
