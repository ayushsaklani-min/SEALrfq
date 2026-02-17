import { handleCommitBid } from '@/api/bid/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    return handleCommitBid(request);
}
