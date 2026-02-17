'use client';

async function safeJson(response: Response): Promise<any | null> {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function tryRefreshAccessToken(): Promise<string | null> {
    const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });

    if (!response.ok) {
        return null;
    }

    const payload = await safeJson(response);
    const nextToken = payload?.data?.accessToken;
    if (typeof nextToken !== 'string' || nextToken.length === 0) {
        return null;
    }

    localStorage.setItem('accessToken', nextToken);
    return nextToken;
}

function withAccessTokenHeaders(headers: HeadersInit | undefined, accessToken: string | null): Headers {
    const out = new Headers(headers || {});
    if (accessToken) {
        out.set('Authorization', `Bearer ${accessToken}`);
    }
    return out;
}

export async function authenticatedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<Response> {
    const token = localStorage.getItem('accessToken');
    const firstHeaders = withAccessTokenHeaders(init?.headers, token);
    let response = await fetch(input, { ...init, headers: firstHeaders });

    if (response.status !== 401) {
        return response;
    }

    const refreshed = await tryRefreshAccessToken();
    if (!refreshed) {
        return response;
    }

    const retryHeaders = withAccessTokenHeaders(init?.headers, refreshed);
    response = await fetch(input, { ...init, headers: retryHeaders });
    return response;
}
