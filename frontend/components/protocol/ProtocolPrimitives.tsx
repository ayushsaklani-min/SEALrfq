'use client';

import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { pricingLabel, STATUS_LABELS, tokenLabel, TOKEN_TYPE } from '@/lib/sealProtocol';
import { cn } from '@/lib/utils';

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8', className)}>{children}</div>;
}

export function PageHeader({
    eyebrow,
    title,
    description,
    actions,
}: {
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: ReactNode;
}) {
    return (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
                {eyebrow ? (
                    <div className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--primary))]">{eyebrow}</div>
                ) : null}
                <h1 className="text-2xl font-bold text-white sm:text-3xl">{title}</h1>
                {description ? <p className="text-sm text-[hsl(var(--muted-foreground))] max-w-2xl">{description}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
    );
}

export function Panel({
    title,
    subtitle,
    children,
    className,
}: {
    title?: string;
    subtitle?: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section className={cn('rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5', className)}>
            {title || subtitle ? (
                <header className="mb-4 space-y-0.5">
                    {title ? <h2 className="text-base font-semibold text-white">{title}</h2> : null}
                    {subtitle ? <p className="text-sm text-[hsl(var(--muted-foreground))]">{subtitle}</p> : null}
                </header>
            ) : null}
            {children}
        </section>
    );
}

export function DataGrid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 | 4 }) {
    const gridClass =
        columns === 4
            ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4'
            : columns === 3
              ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
              : 'grid gap-3 sm:grid-cols-2';
    return <div className={gridClass}>{children}</div>;
}

export function DataPoint({ label, value, subtle }: { label: string; value: ReactNode; subtle?: ReactNode }) {
    return (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-3">
            <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</div>
            <div className="mt-1.5 text-sm font-medium text-white">{value}</div>
            {subtle ? <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{subtle}</div> : null}
        </div>
    );
}

export function Field({
    label,
    hint,
    children,
    className,
}: {
    label: string;
    hint?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <label className={cn('space-y-1.5 text-sm text-slate-300', className)}>
            <div className="font-medium text-white">{label}</div>
            {hint ? <div className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</div> : null}
            {children}
        </label>
    );
}

const inputBaseClass =
    'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-[hsl(var(--primary)/0.45)] focus:ring-2 focus:ring-[hsl(var(--ring)/0.2)] placeholder:text-slate-500';

export function TextInput({ className, ...props }: ComponentProps<'input'>) {
    return <input className={cn(inputBaseClass, className)} {...props} />;
}

export function TextAreaInput({ className, ...props }: ComponentProps<'textarea'>) {
    return <textarea className={cn(inputBaseClass, 'min-h-[110px] resize-y', className)} {...props} />;
}

export function SelectInput({ className, children, ...props }: ComponentProps<'select'>) {
    return (
        <select className={cn(inputBaseClass, className)} {...props}>
            {children}
        </select>
    );
}

export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('flex flex-wrap items-center gap-2.5', className)}>{children}</div>;
}

export function InfoList({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('space-y-2.5 text-sm', className)}>{children}</div>;
}

export function InfoRow({
    label,
    value,
    className,
}: {
    label: string;
    value: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('flex items-start justify-between gap-4 border-b border-white/5 pb-2 text-sm last:border-b-0 last:pb-0', className)}>
            <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
            <span className="text-right font-medium text-white">{value}</span>
        </div>
    );
}

export function Notice({
    tone = 'neutral',
    title,
    children,
}: {
    tone?: 'neutral' | 'success' | 'warning' | 'danger';
    title?: string;
    children: ReactNode;
}) {
    const toneClass =
        tone === 'success'
            ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-200'
            : tone === 'warning'
              ? 'border-amber-500/25 bg-amber-500/8 text-amber-200'
              : tone === 'danger'
                ? 'border-red-500/25 bg-red-500/8 text-red-200'
                : 'border-blue-500/25 bg-blue-500/8 text-blue-200';
    return (
        <div className={cn('rounded-lg border p-3.5 text-sm', toneClass)}>
            {title ? <div className="mb-1 font-medium">{title}</div> : null}
            <div className="text-sm opacity-90">{children}</div>
        </div>
    );
}

export function StatusChip({ status }: { status: string }) {
    const label = STATUS_LABELS[status] || status;
    const tone =
        status === 'COMPLETED'
            ? 'success'
            : status === 'CANCELLED' || status === 'WINNER_DECLINED'
              ? 'destructive'
              : status === 'REVEAL'
                ? 'warning'
                : 'default';
    return <Badge variant={tone as 'default' | 'warning' | 'destructive' | 'success'}>{label}</Badge>;
}

export function TokenChip({ tokenType, label }: { tokenType?: number | null; label?: string }) {
    const value = label ?? tokenLabel(tokenType);
    const variant =
        tokenType === TOKEN_TYPE.USDCX ? 'success' : tokenType === TOKEN_TYPE.USAD ? 'warning' : 'default';
    return <Badge variant={variant as 'default' | 'success' | 'warning'}>{value}</Badge>;
}

export function PricingChip({ pricingMode }: { pricingMode?: number | null }) {
    return <Badge variant="outline">{pricingLabel(pricingMode)}</Badge>;
}

export function InlineMeta({ children }: { children: ReactNode }) {
    return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

export function EmptyState({
    title,
    description,
    actionHref,
    actionLabel,
}: {
    title: string;
    description: string;
    actionHref?: string;
    actionLabel?: string;
}) {
    return (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-8 text-center">
            <div className="text-base font-semibold text-white">{title}</div>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
            {actionHref && actionLabel ? (
                <Link
                    href={actionHref}
                    className="mt-4 inline-flex rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:opacity-90"
                >
                    {actionLabel}
                </Link>
            ) : null}
        </div>
    );
}

export function RecordsPanel({
    records,
    emptyLabel = 'No records cached in this browser yet.',
}: {
    records: Array<{ id: string; type: string; rfqId: string; createdAt: string }>;
    emptyLabel?: string;
}) {
    if (records.length === 0) {
        return <div className="text-sm text-[hsl(var(--muted-foreground))]">{emptyLabel}</div>;
    }
    return (
        <div className="space-y-2">
            {records.map((record) => (
                <div key={record.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-3">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="text-sm font-medium text-white">{record.type}</div>
                            <div className="text-xs text-[hsl(var(--muted-foreground))]">RFQ {record.rfqId.slice(0, 12)}...</div>
                        </div>
                        <div className="text-xs text-[hsl(var(--muted-foreground))]">{new Date(record.createdAt).toLocaleDateString()}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export function Skeleton({ className }: { className?: string }) {
    return <div className={cn('skeleton', className)} />;
}

export function CardSkeleton() {
    return (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 space-y-3">
            <div className="skeleton h-5 w-1/3" />
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-4 w-1/2" />
        </div>
    );
}
