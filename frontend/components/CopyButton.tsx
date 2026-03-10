'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
    text: string;
    /** If provided, show this truncated label instead of full text */
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
            // fallback for older browsers
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
                    'inline-flex items-center justify-center w-6 h-6 rounded-md text-white/40 hover:text-cyan-400 hover:bg-white/5 transition-colors',
                    copied && 'text-green-400',
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
                'text-white/70 hover:text-cyan-400 hover:bg-white/5 border border-transparent hover:border-white/10',
                'transition-all duration-150',
                copied && 'text-green-400 border-green-500/20 bg-green-500/5',
                className,
            )}
        >
            <span>{copied ? 'Copied!' : display}</span>
            {copied ? <Check className="w-3 h-3 flex-shrink-0" /> : <Copy className="w-3 h-3 flex-shrink-0" />}
        </button>
    );
}
