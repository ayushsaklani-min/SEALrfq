import { handleGetMyRFQs } from '@/api/rfq/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return handleGetMyRFQs(request);
}
