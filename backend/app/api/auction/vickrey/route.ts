import { handleCreateVickreyAuction, handleListVickreyAuctions } from '@/api/auction/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return handleListVickreyAuctions(request);
}

export const POST = withRateLimit(async (request: NextRequest) => {
    return handleCreateVickreyAuction(request);
});
