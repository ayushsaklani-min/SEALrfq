import { handleFundEscrow } from '@/api/rfq/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
    return handleFundEscrow(request, params.id);
}
