import { handleListAllRFQs } from '@/api/rfq/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return handleListAllRFQs(request);
}
