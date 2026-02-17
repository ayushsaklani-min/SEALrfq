import { handleGetBid } from '@/api/bid/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
    return handleGetBid(request, params.id);
}
