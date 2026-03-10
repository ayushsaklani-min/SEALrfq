/**
 * Create RFQ Page
 *
 * Buyer creates a new RFQ with validated inputs.
 * - `minBid` is entered in ALEO and converted to microcredits before submission.
 * - Product details are hashed for on-chain metadata.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TxStatusView } from '@/components/TxStatus';
import { walletFirstTx } from '@/lib/walletTx';
import { authenticatedFetch } from '@/lib/authFetch';
import { z } from 'zod';

const CreateRFQSchema = z
    .object({
        biddingDeadline: z.number().int().positive(),
        revealDeadline: z.number().int().positive(),
        minBid: z.bigint().positive(),
    })
    .refine((data) => data.biddingDeadline < data.revealDeadline, {
        message: 'Bidding deadline must be before reveal deadline',
    });

function toDateTimeLocal(date: Date): string {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function toEpochSeconds(value: string): number {
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) throw new Error('Invalid date/time selected');
    return Math.floor(ts / 1000);
}

function aleoToMicro(aleo: string): bigint | null {
    const n = parseFloat(aleo);
    if (!Number.isFinite(n) || n <= 0) return null;
    return BigInt(Math.round(n * 1_000_000));
}

async function computeMetadataHash(data: object): Promise<string> {
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hashBytes = new Uint8Array(hashBuffer).slice(0, 16);
    let num = BigInt(0);
    for (const b of hashBytes) {
        num = (num << 8n) | BigInt(b);
    }
    return `${num}field`;
}

export default function CreateRFQPage() {
    const [itemName, setItemName] = useState('');
    const [description, setDescription] = useState('');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState('');

    const [biddingDeadline, setBiddingDeadline] = useState('');
    const [revealDeadline, setRevealDeadline] = useState('');
    const [minBid, setMinBid] = useState('');

    const [rfqId, setRfqId] = useState<string | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

    const [submitting, setSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        const now = Date.now();
        setBiddingDeadline(toDateTimeLocal(new Date(now + 10 * 60 * 1000)));
        setRevealDeadline(toDateTimeLocal(new Date(now + 30 * 60 * 1000)));
    }, []);

    const minBidMicro = aleoToMicro(minBid);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting) return;

        setSubmitting(true);
        setValidationError(null);

        try {
            if (!itemName.trim()) throw new Error('Item name is required');
            if (!quantity.trim() || Number.isNaN(Number(quantity)) || Number(quantity) <= 0) {
                throw new Error('Quantity must be a positive number');
            }

            const biddingDeadlineEpoch = toEpochSeconds(biddingDeadline);
            const revealDeadlineEpoch = toEpochSeconds(revealDeadline);

            if (!minBidMicro) throw new Error('Enter a valid minimum bid in ALEO');

            const data = CreateRFQSchema.parse({
                biddingDeadline: biddingDeadlineEpoch,
                revealDeadline: revealDeadlineEpoch,
                minBid: minBidMicro,
            });

            const productDetails = {
                itemName: itemName.trim(),
                description: description.trim(),
                quantity: quantity.trim(),
                unit: unit.trim(),
            };
            const metadataHash = await computeMetadataHash(productDetails);

            const prepareBody = {
                biddingDeadline: data.biddingDeadline,
                revealDeadline: data.revealDeadline,
                minBid: data.minBid.toString(),
                metadataHash,
                ...productDetails,
            };

            const txResult = await walletFirstTx(
                '/api/rfq/create',
                prepareBody,
                (prepareData, txHash) => ({
                    ...prepareBody,
                    txHash,
                    rfqId: prepareData.rfq_id,
                }),
            );

            setRfqId(txResult.data.rfq_id);
            setIdempotencyKey(txResult.idempotencyKey);
        } catch (error: any) {
            setValidationError(error.message);
            setSubmitting(false);
        }
    };

    if (idempotencyKey) {
        return (
            <div className="max-w-3xl mx-auto py-10 px-4">
                <h1 className="text-3xl font-bold mb-4">Creating RFQ</h1>
                <div className="glass p-6 rounded-xl border border-white/10">
                    <p className="text-green-400 mb-3">Wallet transaction submitted and backend tracking started.</p>
                    {rfqId && <p className="text-sm text-gray-300 mb-4">RFQ ID: {rfqId}</p>}
                    <TxStatusView idempotencyKey={idempotencyKey} showHistory={true} />
                    {rfqId && (
                        <Link
                            className="inline-block mt-4 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700"
                            href={`/buyer/rfqs/${encodeURIComponent(rfqId)}`}
                        >
                            View RFQ
                        </Link>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto py-12 px-4">
            <h1 className="text-4xl font-bold font-display mb-8 text-center bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                Create New RFQ
            </h1>

            <div className="glass p-8 rounded-2xl border border-white/5 shadow-2xl">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <h2 className="text-lg font-semibold text-white mb-4">Product Details</h2>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label htmlFor="itemName" className="block text-sm font-medium text-gray-300">
                                    Item Name <span className="text-red-400">*</span>
                                </label>
                                <input
                                    type="text"
                                    id="itemName"
                                    value={itemName}
                                    onChange={(e) => setItemName(e.target.value)}
                                    required
                                    placeholder="e.g., Laptop, Steel Rods, Office Chairs"
                                    className="bg-black/40 border border-white/10 text-white text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block w-full p-4 hover:bg-black/60 transition-colors"
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="description" className="block text-sm font-medium text-gray-300">
                                    Description <span className="text-gray-500">(optional)</span>
                                </label>
                                <textarea
                                    id="description"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    rows={3}
                                    placeholder="Specifications, quality requirements, delivery terms..."
                                    className="bg-black/40 border border-white/10 text-white text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block w-full p-4 hover:bg-black/60 transition-colors resize-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label htmlFor="quantity" className="block text-sm font-medium text-gray-300">
                                        Quantity <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                        type="number"
                                        id="quantity"
                                        value={quantity}
                                        onChange={(e) => setQuantity(e.target.value)}
                                        required
                                        min="1"
                                        placeholder="e.g., 100"
                                        className="bg-black/40 border border-white/10 text-white text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block w-full p-4 hover:bg-black/60 transition-colors"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label htmlFor="unit" className="block text-sm font-medium text-gray-300">
                                        Unit <span className="text-gray-500">(optional)</span>
                                    </label>
                                    <input
                                        type="text"
                                        id="unit"
                                        value={unit}
                                        onChange={(e) => setUnit(e.target.value)}
                                        placeholder="e.g., pcs, kg, boxes"
                                        className="bg-black/40 border border-white/10 text-white text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block w-full p-4 hover:bg-black/60 transition-colors"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-white/10" />

                    <div>
                        <h2 className="text-lg font-semibold text-white mb-4">Bidding Schedule</h2>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label htmlFor="biddingDeadline" className="block text-sm font-medium text-gray-300">
                                    Bidding Deadline <span className="text-gray-500">(date & time)</span>
                                </label>
                                <input
                                    type="datetime-local"
                                    id="biddingDeadline"
                                    value={biddingDeadline}
                                    onChange={(e) => setBiddingDeadline(e.target.value)}
                                    required
                                    className="bg-black/40 border border-white/10 text-white text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block w-full p-4 hover:bg-black/60 transition-colors"
                                />
                                <p className="text-xs text-gray-500">Converted server-side to an approximate future block height.</p>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="revealDeadline" className="block text-sm font-medium text-gray-300">
                                    Reveal Deadline <span className="text-gray-500">(date & time)</span>
                                </label>
                                <input
                                    type="datetime-local"
                                    id="revealDeadline"
                                    value={revealDeadline}
                                    onChange={(e) => setRevealDeadline(e.target.value)}
                                    required
                                    className="bg-black/40 border border-white/10 text-white text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block w-full p-4 hover:bg-black/60 transition-colors"
                                />
                                <p className="text-xs text-gray-500">Converted server-side to an approximate future block height.</p>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-white/10" />

                    <div>
                        <h2 className="text-lg font-semibold text-white mb-4">Pricing</h2>
                        <div className="space-y-2">
                            <label htmlFor="minBid" className="block text-sm font-medium text-gray-300">
                                Minimum Bid <span className="text-gray-500">(ALEO)</span>
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    id="minBid"
                                    value={minBid}
                                    onChange={(e) => setMinBid(e.target.value)}
                                    required
                                    min="0.000001"
                                    step="any"
                                    placeholder="e.g., 50"
                                    className="bg-black/40 border border-white/10 text-white text-sm rounded-xl focus:ring-primary-500 focus:border-primary-500 block w-full p-4 pr-20 hover:bg-black/60 transition-colors"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                                    ALEO
                                </span>
                            </div>
                            <p className="text-xs text-gray-500">
                                {minBidMicro
                                    ? `= ${minBidMicro.toLocaleString()} microcredits (sent on-chain)`
                                    : 'Enter amount - vendors must bid at least this much'}
                            </p>
                        </div>
                    </div>

                    {validationError && (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center">
                            <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path
                                    fillRule="evenodd"
                                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                                    clipRule="evenodd"
                                />
                            </svg>
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
                                <svg
                                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                >
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                    />
                                </svg>
                                Creating...
                            </span>
                        ) : (
                            'Create RFQ'
                        )}
                    </button>
                </form>
            </div>

            <div className="mt-8 p-6 rounded-2xl bg-white/5 border border-white/5">
                <h3 className="text-lg font-bold mb-4 font-display">Guidelines</h3>
                <ul className="space-y-2 text-gray-400 text-sm list-disc pl-5">
                    <li>Item name and quantity are required; description helps vendors understand your needs.</li>
                    <li>Bidding deadline must be in the future; reveal deadline must follow it.</li>
                    <li>Minimum bid is in ALEO and is converted to microcredits on-chain.</li>
                    <li>Product details are hashed and stored on-chain for integrity.</li>
                    <li>All bids remain sealed until the reveal phase opens.</li>
                </ul>
            </div>
        </div>
    );
}
