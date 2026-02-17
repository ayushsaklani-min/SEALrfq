/**
 * Create RFQ Page
 * 
 * Buyer creates new RFQ with validated inputs.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TxStatusView } from '@/components/TxStatus';
import { executeAndReportTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';
import { z } from 'zod';

// Validation schema (mirrors contract constraints)
const CreateRFQSchema = z.object({
    biddingDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    minBid: z.bigint().positive(),
}).refine(data => data.biddingDeadline < data.revealDeadline, {
    message: 'Bidding deadline must be before reveal deadline',
});

function toDateTimeLocal(date: Date): string {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function toEpochSeconds(value: string): number {
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) {
        throw new Error('Invalid date/time selected');
    }
    return Math.floor(ts / 1000);
}

function previewEpoch(value: string): string {
    try {
        return value ? toEpochSeconds(value).toString() : '-';
    } catch {
        return '-';
    }
}

export default function CreateRFQPage() {
    // Form state
    const [biddingDeadline, setBiddingDeadline] = useState('');
    const [revealDeadline, setRevealDeadline] = useState('');
    const [minBid, setMinBid] = useState('');

    // Transaction state
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
    const [canonicalKey, setCanonicalKey] = useState<string | null>(null);
    const [rfqId, setRfqId] = useState<string | null>(null);

    // UI state
    const [submitting, setSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        const now = Date.now();
        setBiddingDeadline(toDateTimeLocal(new Date(now + 10 * 60 * 1000)));
        setRevealDeadline(toDateTimeLocal(new Date(now + 30 * 60 * 1000)));
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (submitting) return; // Prevent double-click

        setSubmitting(true);
        setValidationError(null);

        try {
            const biddingDeadlineEpoch = toEpochSeconds(biddingDeadline);
            const revealDeadlineEpoch = toEpochSeconds(revealDeadline);

            // Validate inputs
            const data = CreateRFQSchema.parse({
                biddingDeadline: biddingDeadlineEpoch,
                revealDeadline: revealDeadlineEpoch,
                minBid: BigInt(minBid),
            });

            // Submit to backend
            const response = await authenticatedFetch('/api/rfq/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    biddingDeadline: data.biddingDeadline,
                    revealDeadline: data.revealDeadline,
                    minBid: data.minBid.toString(),
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error.message);
            }

            const result = await response.json();
            await executeAndReportTx(result.data.tx.idempotencyKey, result.data.tx.request);

            // Track transaction
            setIdempotencyKey(result.data.tx.idempotencyKey);
            setCanonicalKey(result.data.tx.canonicalTxKey);
            setRfqId(result.data.rfq_id);

        } catch (error: any) {
            setValidationError(error.message);
            setSubmitting(false);
        }
    };

    // Show transaction status after submission
    if (idempotencyKey) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-4">Creating RFQ</h1>

                <TxStatusView
                    idempotencyKey={idempotencyKey}
                    canonicalTxKey={canonicalKey || undefined}
                    showHistory={true}
                    onRetry={async () => {
                        // Retry would be handled by TxStatus component
                    }}
                />

                {rfqId && (
                    <div className="mt-4 glass p-4 rounded-xl border border-white/10">
                        <p className="text-sm text-gray-300 mb-3">RFQ ID: {rfqId}</p>
                        <Link
                            className="inline-block px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700"
                            href={`/buyer/rfqs/${encodeURIComponent(rfqId)}`}
                        >
                            View RFQ
                        </Link>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto py-12 px-4">
            <h1 className="text-4xl font-bold font-display mb-8 text-center bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Create New RFQ</h1>

            <div className="glass p-8 rounded-2xl border border-white/5 shadow-2xl">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                        <label htmlFor="biddingDeadline" className="block text-sm font-medium text-gray-300">Bidding Deadline <span className="text-gray-500">(date & time)</span></label>
                        <input
                            type="datetime-local"
                            id="biddingDeadline"
                            value={biddingDeadline}
                            onChange={(e) => setBiddingDeadline(e.target.value)}
                            required
                            className="bg-black/40 border border-white/10 text-white text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block w-full p-4 hover:bg-black/60 transition-colors"
                        />
                        <p className="text-xs text-gray-500">
                            Stored on-chain as Unix seconds: {previewEpoch(biddingDeadline)}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="revealDeadline" className="block text-sm font-medium text-gray-300">Reveal Deadline <span className="text-gray-500">(date & time)</span></label>
                        <input
                            type="datetime-local"
                            id="revealDeadline"
                            value={revealDeadline}
                            onChange={(e) => setRevealDeadline(e.target.value)}
                            required
                            className="bg-black/40 border border-white/10 text-white text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block w-full p-4 hover:bg-black/60 transition-colors"
                        />
                        <p className="text-xs text-gray-500">
                            Stored on-chain as Unix seconds: {previewEpoch(revealDeadline)}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="minBid" className="block text-sm font-medium text-gray-300">Minimum Bid <span className="text-gray-500">(credits)</span></label>
                        <input
                            type="number"
                            id="minBid"
                            value={minBid}
                            onChange={(e) => setMinBid(e.target.value)}
                            required
                            min="1"
                            placeholder="e.g., 100000"
                            className="bg-black/40 border border-white/10 text-white text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block w-full p-4 hover:bg-black/60 transition-colors"
                        />
                        <p className="text-xs text-gray-500">Minimum acceptable bid amount</p>
                    </div>

                    {validationError && (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center">
                            <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
                            {validationError}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className={`w-full text-white bg-primary-600 hover:bg-primary-700 focus:ring-4 focus:ring-primary-800 font-medium rounded-xl text-lg px-5 py-4 text-center transition-all shadow-lg shadow-primary-900/20 ${submitting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02]'}`}
                    >
                        {submitting ? (
                            <span className="flex items-center justify-center">
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Creating...
                            </span>
                        ) : 'Create RFQ'}
                    </button>
                </form>
            </div>

            <div className="mt-8 p-6 rounded-2xl bg-white/5 border border-white/5">
                <h3 className="text-lg font-bold mb-4 font-display">Guidelines</h3>
                <ul className="space-y-2 text-gray-400 text-sm list-disc pl-5">
                    <li>Bidding deadline must be in the future</li>
                    <li>Reveal deadline must be after bidding deadline</li>
                    <li>Minimum bid ensures quality responses</li>
                    <li>All bids are sealed until reveal phase</li>
                </ul>
            </div>
        </div>
    );
}
