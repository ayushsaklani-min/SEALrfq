import { handleGetVickreyAuction } from '@/api/auction/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { auctionId: string } }) {
    return handleGetVickreyAuction(request, params.auctionId);
}
