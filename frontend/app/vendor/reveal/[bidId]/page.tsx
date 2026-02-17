'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TxStatusView } from '@/components/TxStatus';
import { executeAndReportTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';

interface Bid {
    id: string;
    rfqId: string;
    vendor: string;
    commitmentHash: string;
    stake: string;
    isRevealed: boolean;
    createdBlock: number;
}

interface RFQ {
    id: string;
    status: string;
    biddingDeadline: number;
    revealDeadline: number;
}

export default function RevealBidPage({ params }: { params: { bidId: string } }) {
    const router = useRouter();
    const bidId = params.bidId;

    const [bid, setBid] = useState<Bid | null>(null);
    const [rfq, setRfq] = useState<RFQ | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [bidAmount, setBidAmount] = useState('');
    const [nonce, setNonce] = useState('');
    const [nonceRecovered, setNonceRecovered] = useState(false);
    const [importMessage, setImportMessage] = useState<string | null>(null);

    const [submitting, setSubmitting] = useState(false);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await authenticatedFetch(`/api/bid/${bidId}`);
                if (!response.ok) {
                    const err = await response.json().catch(() => null);
                    throw new Error(err?.error?.message || 'Failed to fetch bid');
                }
                const data = await response.json();
                setBid(data.data);

                const rfqRes = await authenticatedFetch(`/api/rfq/${data.data.rfqId}`);
                if (rfqRes.ok) {
                    const rfqData = await rfqRes.json();
                    setRfq(rfqData.data);
                }

                const nonceKey = `bid_nonce_${bidId}`;
                const savedNonce = localStorage.getItem(nonceKey);
                if (savedNonce) {
                    try {
                        const parsed = JSON.parse(savedNonce);
                        setNonce(parsed.nonce || '');
                        setBidAmount(parsed.bidAmount || '');
                        setNonceRecovered(Boolean(parsed.nonce || parsed.bidAmount));
                    } catch {
                        // Ignore parse failures.
                    }
                }
            } catch (err: any) {
                setError(err.message || 'Failed to load bid details');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [bidId]);

    const handleReveal = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;

        if (rfq?.status !== 'CLOSED') {
            setError(`Cannot reveal bid: RFQ is in ${rfq?.status} state (expected CLOSED)`);
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const amount = BigInt(bidAmount);
            const response = await authenticatedFetch(`/api/bid/${bidId}/reveal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bidAmount: amount.toString(),
                    nonce,
                }),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err?.error?.message || 'Reveal failed');
            }

            const result = await response.json();
            await executeAndReportTx(result.data.tx.idempotencyKey, result.data.tx.request);
            setIdempotencyKey(result.data.tx.idempotencyKey);
        } catch (err: any) {
            setError(err.message || 'Reveal failed');
            setSubmitting(false);
        }
    };

    const handleImportNonceBundle = async (file: File) => {
        setImportMessage(null);
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);

            if (!parsed || typeof parsed !== 'object') {
                throw new Error('Invalid bundle format');
            }
            if (parsed.bidId && String(parsed.bidId) !== String(bidId)) {
                throw new Error('Bundle bid ID does not match this reveal page');
            }
            if (parsed.rfqId && bid && String(parsed.rfqId) !== String(bid.rfqId)) {
                throw new Error('Bundle RFQ ID does not match this bid');
            }
            if (!parsed.nonce || !parsed.bidAmount) {
                throw new Error('Bundle missing nonce or bidAmount');
            }

            setNonce(String(parsed.nonce));
            setBidAmount(String(parsed.bidAmount));
            setNonceRecovered(true);
            setImportMessage('Nonce bundle imported.');
        } catch (err: any) {
            setImportMessage(err?.message || 'Failed to import bundle');
        }
    };

    if (loading) return <div className="max-w-3xl mx-auto p-8 text-gray-400">Loading...</div>;
    if (error && !submitting) return <div className="max-w-3xl mx-auto p-8 text-red-400">Error: {error}</div>;
    if (!bid) return <div className="max-w-3xl mx-auto p-8 text-red-400">Bid not found</div>;

    if (idempotencyKey) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-4">Revealing Bid</h1>
                <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} />
                <div className="mt-4 glass p-4 rounded-xl border border-white/10">
                    <p className="text-green-300 mb-3">Bid revealed successfully.</p>
                    <button
                        className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700"
                        onClick={() => router.push('/vendor/my-bids')}
                    >
                        View My Bids
                    </button>
                </div>
            </div>
        );
    }

    if (bid.isRevealed) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-3">Bid Already Revealed</h1>
                <p className="text-gray-400 mb-4">This bid has already been revealed.</p>
                <button
                    className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700"
                    onClick={() => router.push('/vendor/my-bids')}
                >
                    Back to My Bids
                </button>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto py-10 px-4">
            <h1 className="text-3xl font-bold mb-6">Reveal Bid</h1>

            <div className="glass p-5 rounded-2xl border border-white/10 mb-5">
                <p className="text-sm text-gray-300 mb-1">
                    <strong>Bid ID:</strong> <span className="font-mono break-all">{bidId}</span>
                </p>
                <p className="text-sm text-gray-300 mb-1">
                    <strong>RFQ ID:</strong> <span className="font-mono break-all">{bid.rfqId}</span>
                </p>
                <p className="text-sm text-gray-300 mb-1">
                    <strong>Commitment Hash:</strong> <span className="font-mono break-all">{bid.commitmentHash}</span>
                </p>
                <p className="text-sm text-gray-300 mb-1"><strong>Stake:</strong> {bid.stake} credits</p>
                <p className="text-sm text-gray-300"><strong>Committed At:</strong> {bid.createdBlock}</p>
            </div>

            {rfq && (
                <div className="glass p-5 rounded-2xl border border-white/10 mb-5">
                    <p className="text-sm text-gray-300 mb-1"><strong>RFQ Status:</strong> {rfq.status}</p>
                    <p className="text-sm text-gray-300"><strong>Reveal Deadline:</strong> {rfq.revealDeadline}</p>
                </div>
            )}

            {rfq && rfq.status !== 'CLOSED' && (
                <div className="mb-5 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">
                    Reveal window not yet open. Buyer must close bidding first.
                </div>
            )}

            <form onSubmit={handleReveal} className="glass p-6 rounded-2xl border border-white/10 space-y-5">
                {nonceRecovered && (
                    <div className="p-3 rounded-xl border border-green-500/30 bg-green-500/10 text-green-200 text-sm">
                        Recovered bid amount and nonce from local storage.
                    </div>
                )}

                <div className="p-4 rounded-xl border border-white/10 bg-white/5">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Import Nonce Bundle (.json)
                    </label>
                    <input
                        type="file"
                        accept="application/json,.json"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                                handleImportNonceBundle(file);
                            }
                            e.currentTarget.value = '';
                        }}
                        className="block w-full text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-600 file:px-3 file:py-2 file:text-white hover:file:bg-primary-700"
                    />
                    {importMessage && (
                        <p className="mt-2 text-xs text-gray-300">{importMessage}</p>
                    )}
                </div>

                <div>
                    <label htmlFor="bidAmount" className="block text-sm font-medium text-gray-300 mb-2">
                        Bid Amount (must match commit)
                    </label>
                    <input
                        type="text"
                        inputMode="numeric"
                        id="bidAmount"
                        value={bidAmount}
                        onChange={(e) => setBidAmount(e.target.value)}
                        required
                        placeholder="Enter your original bid amount"
                        className="w-full p-4 rounded-xl bg-black/50 border border-white/15 font-mono text-lg tracking-wide"
                    />
                    <p className="mt-2 text-xs text-gray-400">Must exactly match the amount used during commit.</p>
                </div>

                <div>
                    <label htmlFor="nonce" className="block text-sm font-medium text-gray-300 mb-2">
                        Nonce (from commit phase)
                    </label>
                    <textarea
                        id="nonce"
                        value={nonce}
                        onChange={(e) => setNonce(e.target.value)}
                        required
                        rows={3}
                        placeholder="Paste the exact nonce"
                        className="w-full p-4 rounded-xl bg-black/50 border border-white/15 font-mono text-base break-all resize-y"
                    />
                    <p className="mt-2 text-xs text-gray-400">Paste the full nonce exactly as generated at commit time.</p>
                </div>

                <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-sm">
                    <h3 className="font-semibold mb-2">Important</h3>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>Bid amount and nonce must exactly match commit values.</li>
                        <li>Wrong values will fail the reveal transaction.</li>
                        <li>Missing reveal before deadline can lead to stake slashing.</li>
                    </ul>
                </div>

                {error && (
                    <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={submitting || (rfq && rfq.status !== 'CLOSED')}
                    className="w-full p-4 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {submitting ? 'Revealing Bid...' : 'Reveal Bid'}
                </button>
            </form>

            {!nonceRecovered && (
                <div className="mt-5 p-4 rounded-xl border border-white/10 bg-white/5 text-sm text-gray-300">
                    <h3 className="font-semibold mb-2">Can't find your nonce?</h3>
                    <p className="text-gray-400">
                        Retrieve it from your secure storage. The nonce is required to prove the reveal matches your commit.
                    </p>
                </div>
            )}
        </div>
    );
}
