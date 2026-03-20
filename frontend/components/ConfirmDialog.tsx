'use client';

import { AlertTriangle, X } from 'lucide-react';

interface Props {
    open: boolean;
    title: string;
    description: string;
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
    primary: { border: 'border-[hsl(var(--primary))]/30', icon: 'text-[hsl(var(--primary))]', btn: 'bg-[hsl(var(--primary))] hover:opacity-90 text-[hsl(var(--primary-foreground))]' },
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
    if (!open) return null;

    const s = variantStyles[variant];

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center px-4"
            style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
            onClick={onCancel}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className={`relative w-full max-w-md rounded-xl border-2 bg-[hsl(var(--card))] p-8 shadow-2xl ${s.border}`}
            >
                <button
                    onClick={onCancel}
                    className="absolute top-4 right-4 text-[hsl(var(--muted-foreground))] hover:text-white transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="flex items-start gap-4 mb-6">
                    <div className="mt-0.5 flex-shrink-0">
                        <AlertTriangle className={`w-6 h-6 ${s.icon}`} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white mb-1">{title}</h2>
                        <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{description}</p>
                    </div>
                </div>

                {details && details.length > 0 && (
                    <div className="mb-6 rounded-lg bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
                        {details.map((d) => (
                            <div key={d.label} className="flex justify-between items-center px-4 py-2.5 text-sm">
                                <span className="text-[hsl(var(--muted-foreground))]">{d.label}</span>
                                <span className="text-white font-mono text-right max-w-[60%] truncate" title={d.value}>{d.value}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-3">
                    <button
                        onClick={onCancel}
                        disabled={loading}
                        className="flex-1 py-2.5 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] text-sm transition-colors disabled:opacity-50"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={loading}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-wait ${s.btn}`}
                    >
                        {loading ? (
                            <span className="flex items-center justify-center gap-2">
                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Processing...
                            </span>
                        ) : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
