'use client';

import { useEffect, useState } from 'react';
import { TxStatusView } from '@/components/TxStatus';
import { Notice, PageHeader, PageShell, Panel } from '@/components/protocol/ProtocolPrimitives';
import { authenticatedFetch } from '@/lib/authFetch';
import { walletFirstTx } from '@/lib/walletTx';

type PlatformConfig = {
    initialized: boolean;
    paused: boolean;
    feeBps: number;
    treasuryCredits: string;
    treasuryUsdcx: string;
    treasuryUsad: string;
    isAdmin: boolean;
};

export default function AdminPage() {
    const [config, setConfig] = useState<PlatformConfig | null>(null);
    const [feeBps, setFeeBps] = useState('50');
    const [paused, setPaused] = useState(false);
    const [withdrawCredits, setWithdrawCredits] = useState('');
    const [withdrawUsdcx, setWithdrawUsdcx] = useState('');
    const [txKey, setTxKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await authenticatedFetch('/api/platform/config');
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload?.error?.message || 'Failed to load platform config.');
                }
                if (!cancelled) {
                    setConfig(payload.data);
                    setFeeBps(String(payload.data.feeBps));
                    setPaused(Boolean(payload.data.paused));
                }
            } catch (caught: any) {
                if (!cancelled) {
                    setError(caught?.message || 'Failed to load platform config.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        load();
        const intervalId = window.setInterval(load, 15000);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, []);

    const configurePlatform = async () => {
        setActing(true);
        setError(null);
        try {
            const feeValue = Number(feeBps);
            const result = await walletFirstTx(
                '/api/platform/config',
                { feeBps: feeValue, paused },
                (_prepareData, txHash) => ({ feeBps: feeValue, paused, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to configure platform.');
        } finally {
            setActing(false);
        }
    };

    const withdraw = async (kind: 'withdraw-credits' | 'withdraw-usdcx', amount: string) => {
        setActing(true);
        setError(null);
        try {
            const result = await walletFirstTx(
                `/api/platform/${kind}`,
                { amount },
                (_prepareData, txHash) => ({ amount, txHash }),
            );
            setTxKey(result.idempotencyKey);
        } catch (caught: any) {
            setError(caught?.message || 'Failed to withdraw fees.');
        } finally {
            setActing(false);
        }
    };

    if (loading) {
        return (
            <PageShell>
                <Panel title="Loading admin dashboard">
                    <div className="text-sm text-slate-400">Fetching platform config and treasury balances.</div>
                </Panel>
            </PageShell>
        );
    }

    if (error && !config) {
        return (
            <PageShell>
                <Notice tone="danger">{error}</Notice>
            </PageShell>
        );
    }

    if (!config?.isAdmin) {
        return (
            <PageShell>
                <Notice tone="danger">Admin access required. Make sure you are signed in with the admin wallet address.</Notice>
            </PageShell>
        );
    }

    return (
        <PageShell className="space-y-8">
            <PageHeader
                eyebrow="Admin"
                title="Platform configuration"
                description="Configure fees, pause state, and manage treasury withdrawals."
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {!config.initialized ? (
                <Notice tone="warning" title="Onboarding required">
                    The platform has not been initialized yet. Click &quot;Configure platform&quot; to bootstrap it.
                </Notice>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <Panel title="Configure platform">
                    <div className="space-y-4">
                        <label className="space-y-2 text-sm text-[hsl(var(--muted-foreground))]">
                            <span>Fee basis points</span>
                            <input
                                type="number"
                                min="0"
                                max="10000"
                                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-white"
                                value={feeBps}
                                onChange={(event) => setFeeBps(event.target.value)}
                            />
                        </label>
                        <label className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                            <input type="checkbox" checked={paused} onChange={(event) => setPaused(event.target.checked)} />
                            Pause new RFQ creation
                        </label>
                        <button
                            type="button"
                            disabled={acting}
                            onClick={configurePlatform}
                            className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:opacity-90 disabled:opacity-50"
                        >
                            Configure platform
                        </button>
                    </div>
                </Panel>

                <Panel title="Treasury balances">
                    <div className="space-y-3 text-sm text-[hsl(var(--muted-foreground))]">
                        <div>Credits: <span className="font-medium text-white">{config.treasuryCredits}</span></div>
                        <div>USDCx: <span className="font-medium text-white">{config.treasuryUsdcx}</span></div>
                        <div>USAD: <span className="font-medium text-white">{config.treasuryUsad}</span></div>
                        <div>Paused: <span className="font-medium text-white">{config.paused ? 'Yes' : 'No'}</span></div>
                        <div>Fee bps: <span className="font-medium text-white">{config.feeBps}</span></div>
                    </div>

                    <div className="mt-5 space-y-4">
                        <div className="space-y-3">
                            <input
                                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-white"
                                value={withdrawCredits}
                                onChange={(event) => setWithdrawCredits(event.target.value)}
                                placeholder="Credits amount"
                            />
                            <button
                                type="button"
                                disabled={acting || !withdrawCredits}
                                onClick={() => withdraw('withdraw-credits', withdrawCredits)}
                                className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-white transition hover:bg-[hsl(var(--secondary))] disabled:opacity-50"
                            >
                                Withdraw credits fees
                            </button>
                        </div>

                        <div className="space-y-3">
                            <input
                                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-white"
                                value={withdrawUsdcx}
                                onChange={(event) => setWithdrawUsdcx(event.target.value)}
                                placeholder="USDCx amount"
                            />
                            <button
                                type="button"
                                disabled={acting || !withdrawUsdcx}
                                onClick={() => withdraw('withdraw-usdcx', withdrawUsdcx)}
                                className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-white transition hover:bg-[hsl(var(--secondary))] disabled:opacity-50"
                            >
                                Withdraw USDCx fees
                            </button>
                        </div>
                    </div>
                </Panel>
            </div>

            {txKey ? (
                <Panel title="Latest transaction">
                    <TxStatusView idempotencyKey={txKey} compact={true} />
                </Panel>
            ) : null}
        </PageShell>
    );
}
