import { handleGetMyBids } from '@/api/bid/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return handleGetMyBids(request);
}
