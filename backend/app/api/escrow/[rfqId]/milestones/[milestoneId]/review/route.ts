import { handleReviewDeliveryEvidence } from '@/api/escrow/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const POST = withRateLimit(async (request: NextRequest, ctx?: any) => {
    return handleReviewDeliveryEvidence(request, ctx?.params?.rfqId, ctx?.params?.milestoneId);
});
