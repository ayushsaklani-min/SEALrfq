import { handleGetEscrow } from '@/api/escrow/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { rfqId: string } }) {
    return handleGetEscrow(request, params.rfqId);
}
