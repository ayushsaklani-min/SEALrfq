'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import { TIMING } from '@/lib/sealProtocol';

const ALEO_RPC = process.env.NEXT_PUBLIC_ALEO_RPC_URL || 'https://api.explorer.provable.com/v1';
const ALEO_NETWORK = process.env.NEXT_PUBLIC_ALEO_NETWORK || 'testnet';

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
        } catch { /* try next */ }
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
    deadlineBlock: number;
    label: string;
    passedLabel?: string;
    onDeadlineReached?: () => void;
    urgentWithinBlocks?: number;
}

export default function DeadlineCountdown({
    deadlineBlock,
    label,
    passedLabel = 'Deadline reached',
    onDeadlineReached,
    urgentWithinBlocks = TIMING.SNIPE_WINDOW_BLOCKS,
}: Props) {
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [error, setError] = useState(false);

    const poll = useCallback(async () => {
        const h = await fetchBlockHeight();
        if (h !== null) { setCurrentBlock(h); setError(false); } else { setError(true); }
    }, []);

    useEffect(() => {
        poll();
        const id = setInterval(poll, 15_000);
        return () => clearInterval(id);
    }, [poll]);

    useEffect(() => {
        if (currentBlock !== null && currentBlock >= deadlineBlock) onDeadlineReached?.();
    }, [currentBlock, deadlineBlock, onDeadlineReached]);

    if (currentBlock === null) {
        return (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                <Clock className="w-4 h-4 animate-pulse" />
                {error ? 'Unable to fetch block height' : 'Loading...'}
            </div>
        );
    }

    const blocksRemaining = deadlineBlock - currentBlock;
    const isPassed = blocksRemaining <= 0;
    const isUrgent = !isPassed && blocksRemaining <= urgentWithinBlocks;
    const secondsRemaining = Math.round((blocksRemaining * TIMING.BLOCK_MS) / 1000);

    if (isPassed) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-sm text-emerald-300">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">{passedLabel}</span>
            </div>
        );
    }

    return (
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            isUrgent
                ? 'border-amber-500/25 bg-amber-500/8 text-amber-300'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
        }`}>
            {isUrgent ? <AlertTriangle className="w-4 h-4 shrink-0 animate-pulse" /> : <Clock className="w-4 h-4 shrink-0" />}
            <span>{label}</span>
            <span className="font-mono font-semibold text-white">~{formatTimeRemaining(secondsRemaining)}</span>
            <span className="text-xs opacity-60">({blocksRemaining} blocks)</span>
        </div>
    );
}
