import { handleReleasePayment } from '@/api/escrow/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const POST = withRateLimit(async (request: NextRequest, ctx?: any) => {
    return handleReleasePayment(request, ctx?.params?.rfqId);
});
