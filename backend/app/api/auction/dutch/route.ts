import { handleCreateDutchAuction, handleListDutchAuctions } from '@/api/auction/routes';
import { withRateLimit } from '@/middleware/withRateLimit';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return handleListDutchAuctions(request);
}

export const POST = withRateLimit(async (request: NextRequest) => {
    return handleCreateDutchAuction(request);
});
