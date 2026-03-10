'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from '@/contexts/WalletContext';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, WifiOff, XCircle, X, ExternalLink } from 'lucide-react';

const SHIELD_STORE_URL = 'https://chromewebstore.google.com/detail/shield-wallet/hhddpjpacfjaakjioinajgmhlbhfchao';

export default function WalletErrorModal() {
    const { connectionError, clearConnectionError, connectWallet, connecting } = useWallet();

    const handleRetry = async () => {
        clearConnectionError();
        await connectWallet();
    };

    const icon = {
        NOT_INSTALLED: <WifiOff className="w-8 h-8 text-yellow-400" />,
        LOCKED: <AlertTriangle className="w-8 h-8 text-orange-400" />,
        REJECTED: <XCircle className="w-8 h-8 text-cyan-400" />,
        UNKNOWN: <AlertTriangle className="w-8 h-8 text-red-400" />,
    } as const;

    const color = {
        NOT_INSTALLED: 'border-yellow-400/30 shadow-yellow-400/10',
        LOCKED: 'border-orange-400/30 shadow-orange-400/10',
        REJECTED: 'border-cyan-400/30 shadow-cyan-400/10',
        UNKNOWN: 'border-red-400/30 shadow-red-400/10',
    } as const;

    if (!connectionError) return null;

    const type = connectionError.type;

    return (
        <AnimatePresence>
            <motion.div
                key="wallet-error-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center px-4"
                style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
                onClick={clearConnectionError}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 12 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    onClick={(e) => e.stopPropagation()}
                    className={`relative w-full max-w-md rounded-2xl border-2 bg-black p-8 shadow-2xl ${color[type]}`}
                    style={{ boxShadow: `0 0 40px rgba(0,0,0,0.6)` }}
                >
                    {/* Close */}
                    <button
                        onClick={clearConnectionError}
                        className="absolute top-4 right-4 text-white/30 hover:text-white/70 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    {/* Icon + title */}
                    <div className="flex flex-col items-center text-center gap-4 mb-6">
                        <div className="w-16 h-16 rounded-full flex items-center justify-center bg-white/5 border border-white/10">
                            {icon[type]}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white mb-1">{connectionError.title}</h2>
                            <p className="text-sm text-white/50 leading-relaxed">{connectionError.hint}</p>
                        </div>
                    </div>

                    {/* Steps for locked */}
                    {type === 'LOCKED' && (
                        <div className="mb-6 space-y-2 text-sm text-white/60 bg-white/5 rounded-xl p-4 border border-white/10">
                            <p className="text-white/80 font-medium mb-2">Quick fix:</p>
                            <Step n={1} text="Click the Shield wallet icon in your browser toolbar" />
                            <Step n={2} text="Enter your password to unlock the wallet" />
                            <Step n={3} text='Click "Try Again" below' />
                        </div>
                    )}

                    {/* Steps for not installed */}
                    {type === 'NOT_INSTALLED' && (
                        <div className="mb-6 space-y-2 text-sm text-white/60 bg-white/5 rounded-xl p-4 border border-white/10">
                            <p className="text-white/80 font-medium mb-2">Quick fix:</p>
                            <Step n={1} text="Install Shield wallet from the Chrome Web Store" />
                            <Step n={2} text="Create or import your Aleo wallet" />
                            <Step n={3} text="Reload this page and connect again" />
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-col gap-3">
                        {type === 'NOT_INSTALLED' ? (
                            <>
                                <a
                                    href={SHIELD_STORE_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center gap-2 w-full h-11 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-400 text-sm font-medium hover:bg-cyan-500/30 transition-colors"
                                >
                                    Install Shield Wallet
                                    <ExternalLink className="w-4 h-4" />
                                </a>
                                <Button variant="secondary" size="sm" onClick={clearConnectionError} className="w-full">
                                    Dismiss
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    size="sm"
                                    onClick={handleRetry}
                                    isLoading={connecting}
                                    className="w-full"
                                >
                                    {connecting ? 'Connecting...' : 'Try Again'}
                                </Button>
                                <Button variant="secondary" size="sm" onClick={clearConnectionError} className="w-full">
                                    Dismiss
                                </Button>
                            </>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}

function Step({ n, text }: { n: number; text: string }) {
    return (
        <div className="flex items-start gap-2.5">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 text-white/60 text-xs flex items-center justify-center font-medium mt-0.5">
                {n}
            </span>
            <span>{text}</span>
        </div>
    );
}
