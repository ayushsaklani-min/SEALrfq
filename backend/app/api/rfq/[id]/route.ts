import { handleGetRFQ } from '@/api/rfq/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
    return handleGetRFQ(request, params.id);
}
