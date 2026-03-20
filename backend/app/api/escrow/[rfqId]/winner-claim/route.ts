import { handleWinnerClaimEscrow } from '@/api/escrow/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const POST = withRateLimit(async (request: NextRequest, { params }: { params: { rfqId: string } }) => {
    return handleWinnerClaimEscrow(request, params.rfqId);
});
