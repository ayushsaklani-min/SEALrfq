import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:4000';

export async function proxyToBackend(
    request: NextRequest,
    backendPath: string,
    method: 'GET' | 'POST'
) {
    try {
        const authHeader = request.headers.get('authorization');
        const body = method === 'POST' ? await request.text() : undefined;
        const incomingUrl = new URL(request.url);
        const targetUrl = `${BACKEND_API_URL}${backendPath}${incomingUrl.search}`;

        const upstream = await fetch(targetUrl, {
            method,
            headers: {
                ...(authHeader ? { Authorization: authHeader } : {}),
                ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
                cookie: request.headers.get('cookie') || '',
            },
            body,
            cache: 'no-store',
        });

        const text = await upstream.text();
        let payload: any = {
            status: 'error',
            error: { code: 'UPSTREAM_ERROR', message: text },
        };

        try {
            payload = JSON.parse(text);
        } catch {
            // Keep fallback payload.
        }

        const response = NextResponse.json(payload, { status: upstream.status });
        const setCookie = upstream.headers.get('set-cookie');
        if (setCookie) {
            response.headers.set('set-cookie', setCookie);
        }
        return response;
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
