"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/contexts/WalletContext";
import { ArrowRight, Wallet } from "lucide-react";

export default function VideoGate() {
    const { connectWallet, connecting } = useWallet();

    return (
        <div className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden">
            {/* Background Video */}
            <div className="fixed inset-0 z-0 bg-black">
                <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="absolute top-0 left-0 w-full h-full object-fill"
                    style={{ filter: 'none', transform: 'translateZ(0)' }}
                >
                    <source src="/bg.mp4" type="video/mp4" />
                </video>
                {/* Removed overlay for maximum visibility */}
            </div>

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center justify-center min-h-screen text-center p-4">
                {/* SEALRFQ Branding */}
                <motion.div
                    initial={{ opacity: 0, y: -30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                    className="mb-24 -mt-16"
                >
                    <h1 
                        className="text-6xl md:text-8xl font-bold text-black tracking-wider"
                        style={{
                            fontFamily: 'system-ui, -apple-system, sans-serif',
                            textShadow: '0 0 20px rgba(34, 211, 238, 0.8), 0 0 40px rgba(34, 211, 238, 0.4)',
                            filter: 'drop-shadow(0 0 10px rgba(34, 211, 238, 0.6))',
                            WebkitTextStroke: '2px rgba(34, 211, 238, 0.8)'
                        }}
                    >
                        SEALRFQ
                    </h1>
                    <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 0.8, delay: 0.8 }}
                        className="h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent mx-auto mt-4"
                        style={{ 
                            width: '200px',
                            boxShadow: '0 0 10px rgba(34, 211, 238, 0.8)'
                        }}
                    />
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, delay: 1.0 }}
                    className="flex justify-center"
                >
                    <button
                        onClick={connectWallet}
                        disabled={connecting}
                        className="h-16 px-8 text-lg bg-black border-2 border-cyan-400 text-cyan-400 font-semibold flex items-center justify-center gap-3 transition-all duration-300 hover:bg-cyan-400/10 hover:text-cyan-300 hover:border-cyan-300"
                        style={{ 
                            fontFamily: 'system-ui, -apple-system, sans-serif',
                            textShadow: '0 0 10px rgba(34, 211, 238, 0.8)',
                            backfaceVisibility: 'hidden',
                            transform: 'translateZ(0)',
                            boxShadow: '0 0 20px rgba(34, 211, 238, 0.5), inset 0 0 20px rgba(34, 211, 238, 0.1)'
                        }}
                    >
                        <Wallet className="w-5 h-5" style={{ filter: 'drop-shadow(0 0 5px rgba(34, 211, 238, 0.8))' }} />
                        CONNECT WALLET
                        <ArrowRight className="w-5 h-5" style={{ filter: 'drop-shadow(0 0 5px rgba(34, 211, 238, 0.8))' }} />
                    </button>
                </motion.div>
            </div>


        </div>
    );
}
