import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:4000';

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get('authorization');
        if (!authHeader) {
            return NextResponse.json(
                { status: 'error', error: { code: 'AUTH_ERROR', message: 'Missing authorization header' } },
                { status: 401 }
            );
        }

        const upstream = await fetch(`${BACKEND_API_URL}/api/bid/my-bids`, {
            method: 'GET',
            headers: {
                Authorization: authHeader,
                'Content-Type': 'application/json',
            },
            cache: 'no-store',
        });

        const text = await upstream.text();
        let body: any = { status: 'error', error: { code: 'UPSTREAM_ERROR', message: text } };

        try {
            body = JSON.parse(text);
        } catch {
            // Keep fallback body when upstream returns non-JSON.
        }

        return NextResponse.json(body, { status: upstream.status });
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: {
                    code: 'BACKEND_UNREACHABLE',
                    message: `Could not reach backend at ${BACKEND_API_URL}: ${error.message}`,
                },
            },
            { status: 503 }
        );
    }
}
