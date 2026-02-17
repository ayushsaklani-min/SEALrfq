import { handleReleasePayment } from '@/api/escrow/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: { rfqId: string } }) {
    return handleReleasePayment(request, params.rfqId);
}
