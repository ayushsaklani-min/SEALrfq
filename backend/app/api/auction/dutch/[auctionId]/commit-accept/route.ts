import { handleDutchCommitAccept } from '@/api/auction/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export const POST = withRateLimit(async (request: NextRequest, { params }: { params: { auctionId: string } }) => {
    return handleDutchCommitAccept(request, params.auctionId);
});
