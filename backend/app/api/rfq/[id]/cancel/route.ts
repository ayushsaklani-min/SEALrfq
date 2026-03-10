import { handleCancelRFQ } from '@/api/rfq/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
    return handleCancelRFQ(request, params.id);
}
