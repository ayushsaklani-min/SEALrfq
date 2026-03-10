import { handleWinnerAccept } from '@/api/rfq/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
    return handleWinnerAccept(request, params.id);
}
