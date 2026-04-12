import { handleGetDeliveryMilestones, handleUpsertDeliveryMilestones } from '@/api/escrow/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const GET = withRateLimit(async (request: NextRequest, ctx?: any) => {
    return handleGetDeliveryMilestones(request, ctx?.params?.rfqId);
});

export const POST = withRateLimit(async (request: NextRequest, ctx?: any) => {
    return handleUpsertDeliveryMilestones(request, ctx?.params?.rfqId);
});
