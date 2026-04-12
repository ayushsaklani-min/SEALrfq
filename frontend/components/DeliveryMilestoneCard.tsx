'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { CopyableText, InfoList, InfoRow } from '@/components/protocol/ProtocolPrimitives';
import { DeliveryMilestone, DELIVERY_STATUS_LABELS, deliveryStatusHint, deliveryStatusVariant } from '@/lib/deliveryAssurance';
import { formatAmount } from '@/lib/sealProtocol';
import { truncateMiddle } from '@/lib/utils';

export function DeliveryMilestoneCard({
    milestone,
    tokenType,
    actions,
}: {
    milestone: DeliveryMilestone;
    tokenType: number;
    actions?: ReactNode;
}) {
    return (
        <div className="rounded-xl border border-white/12 bg-white/[0.05] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold text-white">
                        {milestone.sequence}. {milestone.title}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-white/50">{deliveryStatusHint(milestone.status)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={deliveryStatusVariant(milestone.status)}>{DELIVERY_STATUS_LABELS[milestone.status]}</Badge>
                    <Badge variant="secondary">{formatAmount(milestone.targetAmount, tokenType)}</Badge>
                </div>
            </div>

            {milestone.description ? (
                <div className="mt-3 text-sm leading-6 text-white/65">{milestone.description}</div>
            ) : null}

            <InfoList className="mt-4">
                <InfoRow label="Evidence hash" value={milestone.evidenceHash ? <CopyableText value={milestone.evidenceHash} displayValue={truncateMiddle(milestone.evidenceHash, 16, 10)} /> : '--'} />
                <InfoRow label="Evidence link" value={milestone.evidenceUrl ? <a href={milestone.evidenceUrl} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">{truncateMiddle(milestone.evidenceUrl, 18, 12)}</a> : '--'} />
                <InfoRow label="Submitted" value={milestone.evidenceSubmittedAt ? new Date(milestone.evidenceSubmittedAt).toLocaleString() : '--'} />
                <InfoRow label="Reviewed" value={milestone.reviewedAt ? new Date(milestone.reviewedAt).toLocaleString() : '--'} />
                <InfoRow label="Release tx" value={milestone.releaseTxId ? <CopyableText value={milestone.releaseTxId} displayValue={truncateMiddle(milestone.releaseTxId, 16, 10)} /> : '--'} />
            </InfoList>

            {milestone.evidenceNote ? (
                <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-white/70">
                    {milestone.evidenceNote}
                </div>
            ) : null}

            {milestone.reviewNote || milestone.rejectionReason ? (
                <div className="mt-3 rounded-lg border border-amber-200/20 bg-amber-400/[0.06] p-3 text-sm leading-6 text-amber-50/90">
                    {milestone.reviewNote ? <div>{milestone.reviewNote}</div> : null}
                    {milestone.rejectionReason ? <div>{milestone.rejectionReason}</div> : null}
                </div>
            ) : null}

            {actions ? <div className="mt-4">{actions}</div> : null}
        </div>
    );
}
