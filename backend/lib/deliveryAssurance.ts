import { DeliveryMilestone } from '@prisma/client';
import { z } from 'zod';

export const DELIVERY_MILESTONE_STATUS = {
    PLANNED: 'PLANNED',
    SUBMITTED: 'SUBMITTED',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    RELEASED: 'RELEASED',
} as const;

export const DeliveryPlanSchema = z.object({
    milestones: z.array(
        z.object({
            title: z.string().trim().min(1).max(120),
            description: z.string().trim().max(500).optional().or(z.literal('')),
            amount: z.string().regex(/^\d+$/).transform((value) => BigInt(value)),
        }),
    ).min(1).max(6),
});

export const DeliveryEvidenceSchema = z.object({
    evidenceHash: z.string().trim().min(1).max(255),
    evidenceUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
    note: z.string().trim().max(1_000).optional().or(z.literal('')),
});

export const DeliveryReviewSchema = z
    .object({
        approve: z.boolean(),
        note: z.string().trim().max(1_000).optional().or(z.literal('')),
        rejectionReason: z.string().trim().max(500).optional().or(z.literal('')),
    })
    .superRefine((value, ctx) => {
        if (!value.approve && !value.rejectionReason) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['rejectionReason'],
                message: 'A rejection reason is required when rejecting evidence.',
            });
        }
    });

export function serializeDeliveryMilestone(milestone: DeliveryMilestone) {
    return {
        ...milestone,
        targetAmount: milestone.targetAmount.toString(),
    };
}

export function summarizeDeliveryMilestones(milestones: DeliveryMilestone[], winningAmount: bigint) {
    const totals = {
        totalPlanned: 0n,
        totalReleased: 0n,
        totalApproved: 0n,
        plannedCount: 0,
        submittedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        releasedCount: 0,
    };

    for (const milestone of milestones) {
        totals.totalPlanned += milestone.targetAmount;
        if (milestone.status === DELIVERY_MILESTONE_STATUS.PLANNED) totals.plannedCount += 1;
        if (milestone.status === DELIVERY_MILESTONE_STATUS.SUBMITTED) totals.submittedCount += 1;
        if (milestone.status === DELIVERY_MILESTONE_STATUS.APPROVED) {
            totals.approvedCount += 1;
            totals.totalApproved += milestone.targetAmount;
        }
        if (milestone.status === DELIVERY_MILESTONE_STATUS.REJECTED) totals.rejectedCount += 1;
        if (milestone.status === DELIVERY_MILESTONE_STATUS.RELEASED) {
            totals.releasedCount += 1;
            totals.totalReleased += milestone.targetAmount;
        }
    }

    const nextActionMilestone =
        milestones.find((milestone) => milestone.status === DELIVERY_MILESTONE_STATUS.SUBMITTED) ??
        milestones.find((milestone) => milestone.status === DELIVERY_MILESTONE_STATUS.APPROVED) ??
        milestones.find((milestone) => milestone.status === DELIVERY_MILESTONE_STATUS.PLANNED) ??
        null;

    const coverageRate =
        winningAmount > 0n ? Number((totals.totalPlanned as bigint) * 100n / winningAmount) : 0;

    return {
        milestoneCount: milestones.length,
        plannedCount: totals.plannedCount,
        submittedCount: totals.submittedCount,
        approvedCount: totals.approvedCount,
        rejectedCount: totals.rejectedCount,
        releasedCount: totals.releasedCount,
        totalPlanned: totals.totalPlanned.toString(),
        totalApproved: totals.totalApproved.toString(),
        totalReleased: totals.totalReleased.toString(),
        coverageRate,
        nextActionMilestoneId: nextActionMilestone?.id ?? null,
        nextActionMilestoneTitle: nextActionMilestone?.title ?? null,
        planEditable: milestones.every(
            (milestone) =>
                milestone.status === DELIVERY_MILESTONE_STATUS.PLANNED ||
                milestone.status === DELIVERY_MILESTONE_STATUS.REJECTED,
        ),
    };
}

export function validateMilestoneReleaseSchedule(amounts: bigint[], winningAmount: bigint) {
    let remaining = winningAmount;

    for (let index = 0; index < amounts.length; index += 1) {
        const amount = amounts[index];
        if (amount <= 0n) {
            return `Milestone ${index + 1} must be greater than zero.`;
        }
        if (amount > remaining) {
            return `Milestone ${index + 1} exceeds the remaining escrow balance.`;
        }
        if ((amount * 100n) % remaining !== 0n) {
            return `Milestone ${index + 1} must equal an exact integer percentage of the remaining escrow (${remaining}).`;
        }
        remaining -= amount;
        if (remaining === 0n) {
            break;
        }
    }

    return null;
}
