'use client';

/**
 * Authenticated fetch utility.
 *
 * Auth tokens are stored exclusively in httpOnly cookies set by the server.
 * They are sent automatically on every same-origin request — no manual
 * Authorization header injection needed.
 *
 * On 401: attempt a silent token refresh (server rotates the cookie),
 * then retry the original request once. If the refresh also fails,
 * clear non-sensitive UI state so the user sees the login screen.
 */

export const AUTH_STATE_CLEARED_EVENT = 'sealrfq:auth-state-cleared';
export const ROLE_SWITCH_REQUIRED_EVENT = 'sealrfq:role-switch-required';

function clearLocalUiState(): void {
    localStorage.removeItem('walletAddress');
    localStorage.removeItem('role');
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(AUTH_STATE_CLEARED_EVENT));
    }
}

async function tryRefreshAccessToken(): Promise<boolean> {
    const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Empty body — server reads refresh token from httpOnly cookie.
        body: JSON.stringify({}),
    });
    return response.ok;
}

export async function authenticatedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<Response> {
    // Cookies are sent automatically for same-origin requests.
    let response = await fetch(input, { ...init });

    if (response.status === 403 && typeof window !== 'undefined') {
        try {
            const payload = await response.clone().json();
            if (payload?.error?.code === 'AUTH_ERROR') {
                const currentPath = `${window.location.pathname}${window.location.search}`;
                window.dispatchEvent(
                    new CustomEvent(ROLE_SWITCH_REQUIRED_EVENT, {
                        detail: {
                            from: currentPath,
                        },
                    }),
                );
                window.location.assign(`/unauthorized?from=${encodeURIComponent(currentPath)}`);
            }
        } catch {
            // Ignore non-JSON responses and preserve the original response.
        }
    }

    if (response.status !== 401) {
        return response;
    }

    // Access token expired — try a silent refresh (server sets new cookies).
    const refreshed = await tryRefreshAccessToken();
    if (!refreshed) {
        clearLocalUiState();
        return response;
    }

    // Retry original request with the new cookie.
    response = await fetch(input, { ...init });
    if (response.status === 401) {
        clearLocalUiState();
    }
    return response;
}
