import { handleGetAuditTrail } from '@/api/escrow/routes';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    return handleGetAuditTrail(request);
}
