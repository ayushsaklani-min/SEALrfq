import { handleRevealBid } from '@/api/bid/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
    return handleRevealBid(request, params.id);
}
