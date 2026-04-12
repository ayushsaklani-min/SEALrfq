export type DeliveryMilestone = {
    id: string;
    rfqId: string;
    sequence: number;
    title: string;
    description?: string | null;
    targetAmount: string;
    status: 'PLANNED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RELEASED';
    evidenceHash?: string | null;
    evidenceUrl?: string | null;
    evidenceNote?: string | null;
    evidenceSubmittedBy?: string | null;
    evidenceSubmittedAt?: string | null;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewNote?: string | null;
    rejectionReason?: string | null;
    releaseTxId?: string | null;
    createdAt: string;
    updatedAt: string;
};

export type DeliverySummary = {
    milestoneCount: number;
    plannedCount: number;
    submittedCount: number;
    approvedCount: number;
    rejectedCount: number;
    releasedCount: number;
    totalPlanned: string;
    totalApproved: string;
    totalReleased: string;
    coverageRate: number;
    nextActionMilestoneId?: string | null;
    nextActionMilestoneTitle?: string | null;
    planEditable: boolean;
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryMilestone['status'], string> = {
    PLANNED: 'Planned',
    SUBMITTED: 'Evidence submitted',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    RELEASED: 'Released',
};

export function deliveryStatusVariant(status: DeliveryMilestone['status']): 'outline' | 'warning' | 'success' | 'destructive' {
    if (status === 'APPROVED' || status === 'RELEASED') return 'success';
    if (status === 'SUBMITTED') return 'warning';
    if (status === 'REJECTED') return 'destructive';
    return 'outline';
}

export function deliveryStatusHint(status: DeliveryMilestone['status']) {
    if (status === 'PLANNED') return 'Waiting for vendor evidence.';
    if (status === 'SUBMITTED') return 'Buyer review is required.';
    if (status === 'APPROVED') return 'Ready to drive a guarded escrow release.';
    if (status === 'REJECTED') return 'Vendor should resubmit evidence.';
    return 'This milestone has already been linked to payment release.';
}
