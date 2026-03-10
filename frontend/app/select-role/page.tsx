'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useWallet } from '@/contexts/WalletContext';
import { ShoppingCart, Store, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SelectRolePage() {
    const router = useRouter();
    const { ready, walletAddress, role, switchRole, switchingRole } = useWallet();
    const [selected, setSelected] = useState<'BUYER' | 'VENDOR' | null>(null);

    useEffect(() => {
        if (!ready) return;
        if (!walletAddress) {
            router.replace('/');
            return;
        }
        // Already has a role — skip selection
        if (role && role !== 'NEW_USER') {
            router.replace('/dashboard');
        }
    }, [ready, walletAddress, role, router]);

    const handleSelect = async (chosen: 'BUYER' | 'VENDOR') => {
        setSelected(chosen);
        await switchRole(chosen);
        router.push('/dashboard');
    };

    if (!ready || !walletAddress) {
        return <div className="min-h-screen bg-black" />;
    }

    return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 relative overflow-hidden">
            {/* Background effects */}
            <div className="neon-grid" />
            <div className="fixed inset-0 z-[-1]">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-cyan-500/10 rounded-full blur-[120px] animate-pulse-slow" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-cyan-400/5 rounded-full blur-[120px] animate-pulse-slow" style={{ animationDelay: '2s' }} />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="text-center mb-12"
            >
                <h1 className="text-4xl md:text-5xl font-bold font-display text-glow mb-4">
                    How will you use <span className="text-cyan-400">SealRFQ</span>?
                </h1>
                <p className="text-cyan-300/70 text-lg max-w-xl mx-auto">
                    Choose your role to get started. You can switch anytime from the navbar.
                </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl w-full">
                <RoleCard
                    title="I'm Buying"
                    description="Create RFQs, receive sealed bids, select winners, and manage escrow payments."
                    icon={<ShoppingCart className="w-10 h-10" />}
                    features={['Create RFQ requests', 'Review sealed bids', 'Select winners', 'Fund escrow']}
                    onClick={() => handleSelect('BUYER')}
                    loading={switchingRole && selected === 'BUYER'}
                    disabled={switchingRole}
                    delay={0.1}
                />
                <RoleCard
                    title="I'm Selling"
                    description="Browse open RFQs, submit sealed bids, reveal pricing, and receive payments."
                    icon={<Store className="w-10 h-10" />}
                    features={['Browse open RFQs', 'Submit sealed bids', 'Reveal bid amounts', 'Receive payments']}
                    onClick={() => handleSelect('VENDOR')}
                    loading={switchingRole && selected === 'VENDOR'}
                    disabled={switchingRole}
                    delay={0.2}
                />
            </div>

            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-10 text-cyan-300/40 text-sm"
            >
                Same wallet can act as both buyer and vendor — you just can't bid on your own RFQs.
            </motion.p>
        </div>
    );
}

function RoleCard({
    title,
    description,
    icon,
    features,
    onClick,
    loading,
    disabled,
    delay = 0,
}: {
    title: string;
    description: string;
    icon: React.ReactNode;
    features: string[];
    onClick: () => void;
    loading: boolean;
    disabled: boolean;
    delay?: number;
}) {
    return (
        <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay, duration: 0.5 }}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'group relative p-8 rounded-2xl border-2 border-cyan-400/20 bg-black/80 backdrop-blur-md',
                'text-left transition-all duration-300 cursor-pointer',
                'hover:border-cyan-400/60 hover:bg-cyan-400/5',
                'focus:outline-none focus:ring-2 focus:ring-cyan-400/50',
                'disabled:opacity-50 disabled:cursor-wait',
            )}
            style={{ boxShadow: '0 0 20px rgba(34, 211, 238, 0.1)' }}
        >
            {/* Hover glow */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative z-10 space-y-5">
                <div className="w-16 h-16 bg-cyan-500/10 rounded-xl flex items-center justify-center text-cyan-400 group-hover:scale-110 group-hover:bg-cyan-500/20 transition-all duration-300 neon-border">
                    {icon}
                </div>

                <div>
                    <h2 className="text-2xl font-bold font-display text-glow mb-2">{title}</h2>
                    <p className="text-cyan-300/60 text-sm leading-relaxed">{description}</p>
                </div>

                <ul className="space-y-2">
                    {features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-sm text-cyan-300/70">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60" />
                            {f}
                        </li>
                    ))}
                </ul>

                <div className="flex items-center gap-2 text-cyan-400 font-medium pt-2 group-hover:gap-3 transition-all duration-300">
                    {loading ? (
                        <span className="flex items-center gap-2">
                            <span className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                            Setting up...
                        </span>
                    ) : (
                        <>
                            Get Started <ArrowRight className="w-4 h-4" />
                        </>
                    )}
                </div>
            </div>
        </motion.button>
    );
}
