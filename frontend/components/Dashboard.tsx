"use client";

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ArrowRight, Shield, CheckCircle, Zap, Lock, Globe, Layers } from 'lucide-react';

export default function Dashboard() {
    return (
        <div className="flex flex-col min-h-screen overflow-hidden bg-black">
            {/* Neon Grid Background */}
            <div className="neon-grid" />
            
            {/* Background Gradients */}
            <div className="fixed inset-0 z-[-1]">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-cyan-500/10 rounded-full blur-[120px] animate-pulse-slow" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-cyan-400/5 rounded-full blur-[120px] animate-pulse-slow" style={{ animationDelay: '2s' }} />
            </div>

            {/* Hero Section */}
            <section className="relative flex flex-col items-center justify-center min-h-screen pt-20 px-4 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="max-w-5xl mx-auto space-y-8"
                >
                    <Badge variant="secondary" className="px-4 py-2 text-sm backdrop-blur-md border-cyan-400/30 text-cyan-300 animate-fade-in neon-border">
                        <span className="flex h-2 w-2 rounded-full bg-cyan-400 mr-2 animate-pulse" style={{ boxShadow: '0 0 10px rgba(34, 211, 238, 0.8)' }} />
                        Live on Aleo Testnet
                    </Badge>

                    <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight font-display text-black text-glow" style={{ WebkitTextStroke: '2px rgba(34, 211, 238, 0.8)' }}>
                        Private Procurement <br />
                        <span className="text-cyan-400">Zero Knowledge.</span>
                    </h1>

                    <p className="text-xl md:text-2xl text-cyan-300/80 max-w-3xl mx-auto leading-relaxed">
                        The first privacy-preserving RFQ platform.
                        Secure bids, verifiable results, and complete confidentiality powered by Aleo.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mt-12">
                        <Link href="/buyer/create-rfq">
                            <Button size="lg" className="w-full sm:w-auto min-w-[200px] h-14 text-lg" rightIcon={<ArrowRight className="w-5 h-5" />}>
                                Start as Buyer
                            </Button>
                        </Link>
                        <Link href="/vendor/my-bids">
                            <Button variant="secondary" size="lg" className="w-full sm:w-auto min-w-[200px] h-14 text-lg">
                                Join as Vendor
                            </Button>
                        </Link>
                    </div>

                    {/* Stats / Trust */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4, duration: 0.8 }}
                        className="pt-16 grid grid-cols-2 md:grid-cols-4 gap-8 opacity-70"
                    >
                        <Stat label="Total Volume" value="$2M+" />
                        <Stat label="RFQs Created" value="500+" />
                        <Stat label="Active Vendors" value="120+" />
                        <Stat label="Privacy Level" value="ZK-Max" />
                    </motion.div>
                </motion.div>
            </section>

            {/* Features Grid */}
            <section className="py-32 px-4 relative">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-20">
                        <h2 className="text-3xl md:text-5xl font-bold font-display mb-6 text-glow">Why SealRFQ?</h2>
                        <p className="text-cyan-300/70 text-lg max-w-2xl mx-auto">
                            Built for enterprises that demand privacy without compromising on transparency.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        <FeatureCard
                            title="Zero Knowledge Secrecy"
                            description="Bids are encrypted and sealed on-chain. Pricing strategy remains confidential until the moment of reveal."
                            icon={<Lock className="w-8 h-8 text-cyan-400" />}
                        />
                        <FeatureCard
                            title="Verifiable Integrity"
                            description="Math doesn't lie. Every transaction and selection process is cryptographically verified on Aleo."
                            icon={<CheckCircle className="w-8 h-8 text-cyan-400" />}
                            delay={0.1}
                        />
                        <FeatureCard
                            title="Instant Settlement"
                            description="Smart contracts automate the entire lifecycle from RFQ creation to final escrow settlement."
                            icon={<Zap className="w-8 h-8 text-cyan-400" />}
                            delay={0.2}
                        />
                    </div>
                </div>
            </section>

            {/* How Matrix */}
            <section className="py-32 px-4 bg-black/90 relative overflow-hidden neon-border" style={{ borderWidth: '1px 0' }}>
                <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />

                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col md:flex-row gap-16 items-center">
                        <div className="md:w-1/2 space-y-8">
                            <h2 className="text-4xl md:text-5xl font-bold font-display text-glow">
                                The Protocol <br />
                                <span className="text-cyan-300/60">Architecture</span>
                            </h2>
                            <p className="text-cyan-300/70 text-lg leading-relaxed">
                                SealRFQ leverages Aleo's Leo language to create a dual-state system.
                                Private state protects sensitive bid data, while public state ensures
                                process integrity and auditability.
                            </p>

                            <div className="space-y-4">
                                <ProtocolStep icon={<Layers />} title="Layer 1: Private Records" desc="Bid amounts encrypted to vendor's key." />
                                <ProtocolStep icon={<Globe />} title="Layer 2: Public Consensus" desc="Proof of validity without revealing data." />
                                <ProtocolStep icon={<Shield />} title="Layer 3: Escrow Logic" desc="Atomic swap upon winner selection." />
                            </div>
                        </div>

                        <div className="md:w-1/2 w-full">
                            <Card className="p-1 h-[400px] flex items-center justify-center bg-black/80 relative group neon-border" gradientBorder>
                                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 to-cyan-400/10 opacity-50 group-hover:opacity-100 transition-opacity duration-500" />
                                <div className="text-center space-y-4 relative z-10">
                                    <div className="w-24 h-24 mx-auto bg-cyan-500/20 rounded-full flex items-center justify-center animate-float neon-border">
                                        <Lock className="w-10 h-10 text-cyan-400" style={{ filter: 'drop-shadow(0 0 10px rgba(34, 211, 238, 0.8))' }} />
                                    </div>
                                    <h3 className="text-2xl font-bold text-glow">ZK-Circuit Active</h3>
                                    <p className="text-sm text-cyan-300/60 font-mono">Proof Generation: Optimized</p>
                                </div>
                            </Card>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="py-32 px-4 relative text-center">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-4xl md:text-6xl font-bold font-display mb-8 text-glow">Ready to deploy?</h2>
                    <p className="text-xl text-cyan-300/70 mb-10 max-w-2xl mx-auto">
                        Join the network of forward-thinking enterprises securing their supply chain on Aleo.
                    </p>
                    <Link href="/buyer/create-rfq">
                        <Button size="lg" className="h-16 px-10 text-xl bg-black border-2 border-cyan-400 text-cyan-400 hover:bg-cyan-400/10 neon-border">
                            Launch App
                        </Button>
                    </Link>
                </div>
            </section>
        </div>
    );
}

function Stat({ label, value }: { label: string, value: string }) {
    return (
        <div className="flex flex-col items-center">
            <span className="text-2xl md:text-3xl font-bold text-cyan-400 font-display text-glow">{value}</span>
            <span className="text-xs md:text-sm text-cyan-300/60 uppercase tracking-wider">{label}</span>
        </div>
    );
}

function FeatureCard({ title, description, icon, delay = 0 }: { title: string, description: string, icon: React.ReactNode, delay?: number }) {
    return (
        <Card className="hover:bg-cyan-400/5 transition-colors duration-300 group neon-border">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay, duration: 0.5 }}
                className="p-2"
            >
                <div className="w-14 h-14 bg-black/60 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-cyan-500/20 transition-all duration-300 neon-border">
                    {icon}
                </div>
                <h3 className="text-2xl font-bold mb-3 font-display text-glow">{title}</h3>
                <p className="text-cyan-300/70 leading-relaxed">{description}</p>
            </motion.div>
        </Card>
    );
}

function ProtocolStep({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
    return (
        <div className="flex items-start gap-4 p-4 rounded-xl hover:bg-cyan-400/5 transition-colors cursor-default neon-border" style={{ borderWidth: '1px' }}>
            <div className="mt-1 text-cyan-400">{icon}</div>
            <div>
                <h4 className="font-bold text-cyan-400 text-glow">{title}</h4>
                <p className="text-sm text-cyan-300/60">{desc}</p>
            </div>
        </div>
    );
}
