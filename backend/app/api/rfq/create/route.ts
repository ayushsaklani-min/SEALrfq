import { handleCreateRFQ } from '@/api/rfq/routes';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
    return handleCreateRFQ(request);
}
