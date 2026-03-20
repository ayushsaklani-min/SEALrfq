'use client';

const ALEO_RPC = process.env.NEXT_PUBLIC_ALEO_RPC_URL || 'https://api.explorer.provable.com/v1';
const ALEO_NETWORK = process.env.NEXT_PUBLIC_ALEO_NETWORK || 'testnet';

export async function fetchCurrentBlockHeight(): Promise<number | null> {
    const urls = [
        `${ALEO_RPC}/${ALEO_NETWORK}/latest/height`,
        `${ALEO_RPC}/${ALEO_NETWORK}/block/latest`,
    ];

    for (const url of urls) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) continue;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('json')) {
                const payload = await response.json();
                const height = Number(payload?.height ?? payload);
                if (Number.isFinite(height) && height > 0) {
                    return height;
                }
                continue;
            }

            const height = Number((await response.text()).trim());
            if (Number.isFinite(height) && height > 0) {
                return height;
            }
        } catch {
            // Try the next endpoint.
        }
    }

    return null;
}
