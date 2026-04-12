import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getTestnetInsights } from '@/lib/testnetInsights';

const prisma = new PrismaClient();

export async function GET() {
    try {
        const data = await getTestnetInsights(prisma);
        return NextResponse.json({ status: 'success', data });
    } catch (error) {
        console.error('Analytics error:', error);
        return NextResponse.json(
            {
                status: 'error',
                error: {
                    code: 'ANALYTICS_FAILED',
                    message: 'Failed to fetch analytics',
                },
            },
            { status: 500 },
        );
    }
}
