'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface Props {
    open: boolean;
    title: string;
    description: string;
    /** Extra detail rows — shown as a small summary card before the buttons */
    details?: { label: string; value: string }[];
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'primary';
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const variantStyles = {
    danger:  { border: 'border-red-500/30',    icon: 'text-red-400',    btn: 'bg-red-600 hover:bg-red-700 text-white' },
    warning: { border: 'border-amber-500/30',  icon: 'text-amber-400',  btn: 'bg-amber-600 hover:bg-amber-700 text-white' },
    primary: { border: 'border-cyan-400/30',   icon: 'text-cyan-400',   btn: 'bg-cyan-600 hover:bg-cyan-700 text-white' },
};

export default function ConfirmDialog({
    open,
    title,
    description,
    details,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'warning',
    loading = false,
    onConfirm,
    onCancel,
}: Props) {
    const s = variantStyles[variant];

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="confirm-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[200] flex items-center justify-center px-4"
                    style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
                    onClick={onCancel}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 12 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        onClick={(e) => e.stopPropagation()}
                        className={`relative w-full max-w-md rounded-2xl border-2 bg-black p-8 shadow-2xl ${s.border}`}
                    >
                        <button
                            onClick={onCancel}
                            className="absolute top-4 right-4 text-white/30 hover:text-white/70 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <div className="flex items-start gap-4 mb-6">
                            <div className="mt-0.5 flex-shrink-0">
                                <AlertTriangle className={`w-6 h-6 ${s.icon}`} />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-white mb-1">{title}</h2>
                                <p className="text-sm text-white/60 leading-relaxed">{description}</p>
                            </div>
                        </div>

                        {details && details.length > 0 && (
                            <div className="mb-6 rounded-xl bg-white/5 border border-white/10 divide-y divide-white/10">
                                {details.map((d) => (
                                    <div key={d.label} className="flex justify-between items-center px-4 py-2.5 text-sm">
                                        <span className="text-white/50">{d.label}</span>
                                        <span className="text-white font-mono text-right max-w-[60%] truncate" title={d.value}>{d.value}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={onCancel}
                                disabled={loading}
                                className="flex-1 py-2.5 rounded-xl border border-white/15 text-white/70 hover:bg-white/5 text-sm transition-colors disabled:opacity-50"
                            >
                                {cancelLabel}
                            </button>
                            <button
                                onClick={onConfirm}
                                disabled={loading}
                                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-wait ${s.btn}`}
                            >
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Processing...
                                    </span>
                                ) : confirmLabel}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
