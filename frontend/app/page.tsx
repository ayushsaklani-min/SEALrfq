'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Gavel, Lock, ArrowRight } from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { Button } from '@/components/ui/Button';

const features = [
    {
        icon: Lock,
        title: 'Sealed Bids',
        description: 'Submit encrypted bid commitments. No one sees your price until the reveal phase.',
    },
    {
        icon: Gavel,
        title: 'Multiple Auction Types',
        description: 'Classic RFQ, Vickrey (second-price), and Dutch (descending-price) auctions.',
    },
    {
        icon: ShieldCheck,
        title: 'On-Chain Settlement',
        description: 'Escrow-backed payments in ALEO, USDCx, or USAD with verifiable fairness.',
    },
];

export default function HomePage() {
    const router = useRouter();
    const { ready, walletAddress, role, connectWallet, connecting } = useWallet();

    useEffect(() => {
        if (!ready || !walletAddress) return;
        if (!role || role === 'NEW_USER') {
            router.replace('/select-role');
            return;
        }
        router.replace('/dashboard');
    }, [ready, walletAddress, role, router]);

    const handleConnect = async () => {
        const connected = await connectWallet();
        if (connected) router.push('/select-role');
    };

    if (ready && walletAddress) {
        return <div className="min-h-screen" />;
    }

    return (
        <div className="min-h-[calc(100vh-4rem)] flex flex-col">
            {/* Hero */}
            <section className="flex-1 flex items-center justify-center px-4 py-20">
                <div className="max-w-3xl mx-auto text-center space-y-8">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary)/0.3)] bg-[hsl(var(--primary)/0.08)] px-4 py-1.5 text-xs font-medium text-[hsl(var(--primary))]">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Built on Aleo
                    </div>

                    <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-tight">
                        Private Procurement,{' '}
                        <span className="text-[hsl(var(--primary))]">On-Chain</span>
                    </h1>

                    <p className="text-lg text-[hsl(var(--muted-foreground))] max-w-xl mx-auto leading-relaxed">
                        Create sealed-bid requests, run auctions, and settle payments with zero-knowledge privacy.
                        Three tokens supported: ALEO, USDCx, and USAD.
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-4">
                        <Button size="lg" onClick={handleConnect} isLoading={connecting}>
                            Connect Wallet
                        </Button>
                        <Button size="lg" variant="secondary" onClick={() => router.push('/privacy')}>
                            How it works
                        </Button>
                    </div>
                </div>
            </section>

            {/* Features */}
            <section className="px-4 pb-20">
                <div className="max-w-5xl mx-auto grid gap-6 md:grid-cols-3">
                    {features.map((feature) => (
                        <div
                            key={feature.title}
                            className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-3"
                        >
                            <div className="w-10 h-10 rounded-lg bg-[hsl(var(--primary)/0.12)] flex items-center justify-center">
                                <feature.icon className="h-5 w-5 text-[hsl(var(--primary))]" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                            <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{feature.description}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* CTA */}
            <section className="px-4 pb-20">
                <div className="max-w-5xl mx-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Ready to get started?</h2>
                        <p className="mt-2 text-[hsl(var(--muted-foreground))]">Connect your wallet and choose a role to begin.</p>
                    </div>
                    <Button size="lg" onClick={handleConnect} isLoading={connecting} rightIcon={<ArrowRight className="h-4 w-4" />}>
                        Enter App
                    </Button>
                </div>
            </section>
        </div>
    );
}
