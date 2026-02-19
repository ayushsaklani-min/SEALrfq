"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useWallet } from "@/contexts/WalletContext";
import { ArrowRight, Wallet } from "lucide-react";

export default function VideoGate() {
    const { connectWallet, connecting } = useWallet();
    const beforeLines = useMemo(
        () => ["Admin can see bids", "Vendors collude", "Corruption risk"],
        []
    );
    const withLines = useMemo(
        () => ["Bids hidden by ZK", "Lowest bid auto-wins", "Payment auto-escrowed", "Everyone can verify"],
        []
    );
    const [typedBefore, setTypedBefore] = useState<string[]>(() => beforeLines.map(() => ""));
    const [typedWith, setTypedWith] = useState<string[]>(() => withLines.map(() => ""));
    const [cursor, setCursor] = useState<{ section: "before" | "with" | null; line: number }>({
        section: null,
        line: -1,
    });

    useEffect(() => {
        let cancelled = false;
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        const typeLine = async (section: "before" | "with", lineIndex: number, text: string) => {
            if (cancelled) return;
            setCursor({ section, line: lineIndex });
            for (let charIndex = 1; charIndex <= text.length; charIndex += 1) {
                if (cancelled) return;
                const nextChunk = text.slice(0, charIndex);
                if (section === "before") {
                    setTypedBefore((prev) => {
                        const next = [...prev];
                        next[lineIndex] = nextChunk;
                        return next;
                    });
                } else {
                    setTypedWith((prev) => {
                        const next = [...prev];
                        next[lineIndex] = nextChunk;
                        return next;
                    });
                }
                await sleep(28);
            }
        };

        const runTyping = async () => {
            await sleep(1200);
            for (let i = 0; i < beforeLines.length; i += 1) {
                await typeLine("before", i, beforeLines[i]);
                await sleep(220);
            }
            await sleep(450);
            for (let i = 0; i < withLines.length; i += 1) {
                await typeLine("with", i, withLines[i]);
                await sleep(220);
            }
            if (!cancelled) {
                setCursor({ section: null, line: -1 });
            }
        };

        runTyping();

        return () => {
            cancelled = true;
        };
    }, [beforeLines, withLines]);

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
                    className="w-full max-w-4xl flex flex-col items-center gap-8"
                >
                    <div className="w-full bg-black/65 border border-cyan-400/70 rounded-xl p-5 md:p-6 backdrop-blur-sm shadow-[0_0_30px_rgba(34,211,238,0.2)] text-left">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h2 className="text-base md:text-lg font-semibold text-rose-300 tracking-wide mb-3">
                                    Before SealRFQ
                                </h2>
                                <ul className="space-y-2 text-sm md:text-base text-rose-100">
                                    {beforeLines.map((line, index) => (
                                        <li
                                            key={line}
                                            className="relative"
                                        >
                                            <span className="invisible">{`> ${line}`}</span>
                                            <span
                                                className={`absolute inset-0 transition-opacity duration-300 ${
                                                    typedBefore[index] ? "opacity-100" : "opacity-0"
                                                }`}
                                            >
                                                {typedBefore[index] ? `> ${typedBefore[index]}` : "\u00A0"}
                                                {cursor.section === "before" && cursor.line === index ? (
                                                    <motion.span
                                                        animate={{ opacity: [1, 0, 1] }}
                                                        transition={{ duration: 0.9, repeat: Infinity }}
                                                        className="ml-1"
                                                    >
                                                        |
                                                    </motion.span>
                                                ) : null}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div>
                                <h2 className="text-base md:text-lg font-semibold text-emerald-300 tracking-wide mb-3">
                                    With SealRFQ
                                </h2>
                                <ul className="space-y-2 text-sm md:text-base text-emerald-100">
                                    {withLines.map((line, index) => (
                                        <li
                                            key={line}
                                            className="relative"
                                        >
                                            <span className="invisible">{`> ${line}`}</span>
                                            <span
                                                className={`absolute inset-0 transition-opacity duration-300 ${
                                                    typedWith[index] ? "opacity-100" : "opacity-0"
                                                }`}
                                            >
                                                {typedWith[index] ? `> ${typedWith[index]}` : "\u00A0"}
                                                {cursor.section === "with" && cursor.line === index ? (
                                                    <motion.span
                                                        animate={{ opacity: [1, 0, 1] }}
                                                        transition={{ duration: 0.9, repeat: Infinity }}
                                                        className="ml-1"
                                                    >
                                                        |
                                                    </motion.span>
                                                ) : null}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
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
