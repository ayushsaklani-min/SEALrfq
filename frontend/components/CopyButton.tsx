'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
    text: string;
    label?: string;
    className?: string;
    iconOnly?: boolean;
}

export default function CopyButton({ text, label, className, iconOnly = false }: Props) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            const el = document.createElement('textarea');
            el.value = text;
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    if (iconOnly) {
        return (
            <button
                onClick={handleCopy}
                title={copied ? 'Copied!' : `Copy: ${text}`}
                className={cn(
                    'inline-flex items-center justify-center w-6 h-6 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--secondary))] transition-colors',
                    copied && 'text-emerald-400',
                    className,
                )}
            >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
        );
    }

    const display = label ?? `${text.slice(0, 8)}…${text.slice(-6)}`;

    return (
        <button
            onClick={handleCopy}
            title={copied ? 'Copied!' : text}
            className={cn(
                'inline-flex items-center gap-1.5 font-mono text-sm rounded-lg px-2 py-0.5',
                'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--secondary))] border border-transparent hover:border-[hsl(var(--border))]',
                'transition-all duration-150',
                copied && 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5',
                className,
            )}
        >
            <span>{copied ? 'Copied!' : display}</span>
            {copied ? <Check className="w-3 h-3 flex-shrink-0" /> : <Copy className="w-3 h-3 flex-shrink-0" />}
        </button>
    );
}
