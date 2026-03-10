'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, CheckCircle, AlertTriangle } from 'lucide-react';

const ALEO_RPC = process.env.NEXT_PUBLIC_ALEO_RPC_URL || 'https://api.explorer.provable.com/v1';
const ALEO_NETWORK = process.env.NEXT_PUBLIC_ALEO_NETWORK || 'testnet';
const APPROX_BLOCK_TIME_S = 5; // ~5 seconds per block on testnet
const POLL_INTERVAL_MS = 15_000; // poll every 15s

async function fetchBlockHeight(): Promise<number | null> {
    const urls = [
        `${ALEO_RPC}/${ALEO_NETWORK}/latest/height`,
        `${ALEO_RPC}/${ALEO_NETWORK}/block/latest`,
    ];
    for (const url of urls) {
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) continue;
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('json')) {
                const json = await res.json();
                const h = Number(json?.height ?? json);
                if (Number.isFinite(h) && h > 0) return h;
            } else {
                const h = Number((await res.text()).trim());
                if (Number.isFinite(h) && h > 0) return h;
            }
        } catch {
            // try next
        }
    }
    return null;
}

function formatTimeRemaining(seconds: number): string {
    if (seconds <= 0) return 'now';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

interface Props {
    /** Target block height (deadline) */
    deadlineBlock: number;
    /** Label shown before the countdown (e.g. "Bidding closes in") */
    label: string;
    /** Label shown when deadline has passed */
    passedLabel?: string;
    /** Called once when deadline is reached */
    onDeadlineReached?: () => void;
}

export default function DeadlineCountdown({
    deadlineBlock,
    label,
    passedLabel = 'Deadline reached',
    onDeadlineReached,
}: Props) {
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [error, setError] = useState(false);

    const poll = useCallback(async () => {
        const h = await fetchBlockHeight();
        if (h !== null) {
            setCurrentBlock(h);
            setError(false);
        } else {
            setError(true);
        }
    }, []);

    useEffect(() => {
        poll();
        const id = setInterval(poll, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [poll]);

    // Fire callback once when deadline is reached
    useEffect(() => {
        if (currentBlock !== null && currentBlock >= deadlineBlock) {
            onDeadlineReached?.();
        }
    }, [currentBlock, deadlineBlock, onDeadlineReached]);

    if (currentBlock === null) {
        return (
            <div className="flex items-center gap-2 text-sm text-gray-500">
                <Clock className="w-4 h-4 animate-pulse" />
                {error ? 'Unable to fetch block height' : 'Loading block height...'}
            </div>
        );
    }

    const blocksRemaining = deadlineBlock - currentBlock;
    const isPassed = blocksRemaining <= 0;
    const isUrgent = !isPassed && blocksRemaining <= 20; // ~100 seconds
    const secondsRemaining = blocksRemaining * APPROX_BLOCK_TIME_S;

    if (isPassed) {
        return (
            <div className="flex items-center gap-2 rounded-xl px-4 py-3 border border-green-500/30 bg-green-500/10 text-green-300 text-sm">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <div>
                    <span className="font-medium">{passedLabel}</span>
                    <span className="text-green-300/60 ml-2">
                        (block {currentBlock.toLocaleString()} / {deadlineBlock.toLocaleString()})
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`flex items-center gap-2 rounded-xl px-4 py-3 border text-sm ${
                isUrgent
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-cyan-400/20 bg-cyan-400/5 text-cyan-300'
            }`}
        >
            {isUrgent ? (
                <AlertTriangle className="w-4 h-4 flex-shrink-0 animate-pulse" />
            ) : (
                <Clock className="w-4 h-4 flex-shrink-0" />
            )}
            <div>
                <span className="font-medium">{label}</span>{' '}
                <span className="font-mono font-bold">
                    ~{formatTimeRemaining(secondsRemaining)}
                </span>
                <span className="opacity-60 ml-2">
                    ({blocksRemaining} blocks remaining — block {currentBlock.toLocaleString()} / {deadlineBlock.toLocaleString()})
                </span>
            </div>
        </div>
    );
}
