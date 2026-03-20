import { handlePayInvoice } from '@/api/escrow/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const POST = withRateLimit(async (request: NextRequest, { params }: { params: { rfqId: string } }) => {
    return handlePayInvoice(request, params.rfqId);
});
