export interface WalletConnectResult {
    walletAddress: string;
    signature: string;
}

// ============================================================================
// Wallet error classification
// ============================================================================

export type WalletErrorType = 'NOT_INSTALLED' | 'LOCKED' | 'REJECTED' | 'UNKNOWN';

export class WalletError extends Error {
    constructor(
        message: string,
        public readonly errorType: WalletErrorType,
        public readonly userMessage: string,
        public readonly hint: string,
    ) {
        super(message);
        this.name = 'WalletError';
    }
}

function classifyWalletError(raw: string, providerFound: boolean): WalletError {
    const lower = raw.toLowerCase();

    if (!providerFound || lower.includes('not installed') || lower.includes('not detected') || lower.includes('extension not')) {
        return new WalletError(raw, 'NOT_INSTALLED',
            'Shield wallet not found',
            'Install the Shield wallet extension from the Chrome Web Store, then reload this page.',
        );
    }

    const isLocked =
        lower.includes('locked') ||
        lower.includes('unable to read') ||
        lower.includes('wallet is not') ||
        lower.includes('no account') ||
        lower.includes('no active') ||
        lower.includes('not unlocked') ||
        lower.includes('password') ||
        lower.includes('decrypt');

    if (isLocked) {
        return new WalletError(raw, 'LOCKED',
            'Wallet is locked',
            'Open the Shield wallet extension, enter your password to unlock it, then try again.',
        );
    }

    const isRejected =
        lower.includes('reject') ||
        lower.includes('cancel') ||
        lower.includes('denied') ||
        lower.includes('user refused') ||
        lower.includes('user closed');

    if (isRejected) {
        return new WalletError(raw, 'REJECTED',
            'Connection cancelled',
            'You cancelled the connection. Click "Connect Shield" again and approve the request.',
        );
    }

    return new WalletError(raw, 'UNKNOWN',
        'Wallet connection failed',
        raw || 'Something went wrong. Make sure Shield wallet is unlocked and try again.',
    );
}
const DEFAULT_NETWORK = process.env.NEXT_PUBLIC_ALEO_NETWORK || 'testnet';
const DEFAULT_PROGRAM_ID = process.env.NEXT_PUBLIC_ALEO_PROGRAM_ID || 'sealrfq_v17.aleo';
const DEFAULT_VICKREY_PROGRAM_ID =
    process.env.NEXT_PUBLIC_ALEO_VICKREY_PROGRAM_ID || 'sealvickrey_v2.aleo';
const DEFAULT_DUTCH_PROGRAM_ID =
    process.env.NEXT_PUBLIC_ALEO_DUTCH_PROGRAM_ID || 'sealdutch_v4.aleo';
// Shield wallet accepts: "mainnet" | "testnet" | "testnet3" (NOT "testnetbeta")
const SHIELD_CHAIN_ID = DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
const PROGRAM_ALLOWLIST = Array.from(
    new Set([
        DEFAULT_PROGRAM_ID,
        'sealrfq_v17.aleo',
        'sealrfq_v16.aleo',
        'credits.aleo',
        'test_usdcx_stablecoin.aleo',
        'test_usad_stablecoin.aleo',
        DEFAULT_VICKREY_PROGRAM_ID,
        DEFAULT_DUTCH_PROGRAM_ID,
    ])
);

type NativeShield = {
    publicKey?: string;
    getAccount?: () => Promise<any>;
    getAddress?: () => Promise<any>;
    connect?: (...args: any[]) => Promise<{ address?: string } | any>;
    disconnect?: () => Promise<void>;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array | string | any>;
};

type WalletProvider = {
    connect?: (...args: any[]) => Promise<any>;
    getAddress?: () => Promise<string>;
    getAccounts?: () => Promise<any>;
    signMessage?: (message: string) => Promise<string>;
    account?: any;
    selectedAccount?: any;
    accounts?: any;
    request?: (args: { method: string; params?: any[] }) => Promise<any>;
};

function getWindow(): any {
    return window as any;
}

function getNativeShield(): NativeShield | null {
    const w = getWindow();
    const candidates = [w.shield, w.shieldWallet, w.shieldAleo, w.ShieldWallet, w.leoWallet, w.puzzle];
    for (const candidate of candidates) {
        if (candidate) return candidate as NativeShield;
    }
    return null;
}

function getProvider(): WalletProvider | null {
    const w = getWindow();
    const direct = [w.shield, w.shieldWallet, w.ShieldWallet, w.aleoWallet, w.aleo, w.leoWallet, w.puzzle];
    for (const c of direct) {
        if (c) return c as WalletProvider;
    }
    return null;
}

function getConnectCapableClients(): NativeShield[] {
    const w = getWindow();
    const candidates = [w.shield, w.shieldWallet, w.ShieldWallet, w.aleoWallet, w.aleo, w.leoWallet, w.puzzle];
    return candidates.filter((c) => !!c?.connect) as NativeShield[];
}

function extractAddress(value: any): string | null {
    if (!value) return null;
    if (typeof value === 'string' && value.startsWith('aleo1')) return value;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = extractAddress(item);
            if (found) return found;
        }
        return null;
    }
    if (typeof value === 'object') {
        const keys = ['address', 'account', 'owner', 'publicAddress', 'walletAddress', 'publicKey'];
        for (const key of keys) {
            const found = extractAddress((value as any)[key]);
            if (found) return found;
        }
        for (const nested of Object.values(value)) {
            const found = extractAddress(nested);
            if (found) return found;
        }
    }
    return null;
}

async function readAddressFromProvider(provider: WalletProvider): Promise<string> {
    if (provider.getAddress) {
        const extracted = extractAddress(await provider.getAddress());
        if (extracted) return extracted;
    }

    if (provider.getAccounts) {
        const extracted = extractAddress(await provider.getAccounts());
        if (extracted) return extracted;
    }

    const localStateAddress = extractAddress(provider.selectedAccount || provider.account || provider.accounts);
    if (localStateAddress) return localStateAddress;

    if (provider.request) {
        const methods = ['wallet_getAddress', 'aleo_getAddress', 'wallet_getAccounts', 'aleo_getAccounts', 'aleo_account', 'getAccount'];
        for (const method of methods) {
            try {
                let result: any;
                try {
                    result = await provider.request({ method });
                } catch {
                    result = await provider.request({ method, params: [] });
                }
                const extracted = extractAddress(result);
                if (extracted) return extracted;
            } catch {
                // Try next method
            }
        }
    }

    throw new Error('Unable to read wallet address from provider');
}

function encodeUtf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function tryDecodeUtf8(bytes: Uint8Array): string | null {
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
        if (!text || /[\u0000-\u001f]/.test(text)) return null;
        return text;
    } catch {
        return null;
    }
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function normalizeSignature(raw: unknown): string | null {
    if (!raw) return null;

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    if (raw instanceof Uint8Array) {
        return tryDecodeUtf8(raw) || bytesToBase64(raw);
    }

    if (raw instanceof ArrayBuffer) {
        const bytes = new Uint8Array(raw);
        return tryDecodeUtf8(bytes) || bytesToBase64(bytes);
    }

    if (typeof raw === 'object') {
        const signature = (raw as any).signature ?? (raw as any).data ?? (raw as any).value;
        if (signature) return normalizeSignature(signature);
    }

    return null;
}

async function connectKnownShield(client: NativeShield | null, allowlist = PROGRAM_ALLOWLIST): Promise<any> {
    if (!client?.connect) return null;

    // Shield wallet: connect(network, decryptPermission, programs[])
    // — network FIRST, then decryptPermission (confirmed from extension source)
    const attempts: any[][] = [
        [SHIELD_CHAIN_ID, 'AutoDecrypt', allowlist],
        [DEFAULT_NETWORK, 'AutoDecrypt', allowlist],
        [{ decryptPermission: 'AutoDecrypt', programs: allowlist }],
        [],
    ];

    let lastError: string | null = null;
    for (const args of attempts) {
        try {
            return await client.connect(...args);
        } catch (error: any) {
            lastError = error?.message || String(error);
        }
    }

    if (lastError) {
        throw new Error(lastError);
    }
}

async function connectKnownProvider(provider: WalletProvider | null, allowlist = PROGRAM_ALLOWLIST): Promise<any> {
    if (!provider) return null;

    let lastError: string | null = null;

    if (provider.connect) {
        try {
            return await connectKnownShield(provider as WalletProvider & NativeShield, allowlist);
        } catch (error: unknown) {
            lastError = errorMessage(error);
        }
    }

    if (provider.request) {
        const methods = ['wallet_connect', 'aleo_connect', 'connect'];
        const payloads = [
            [SHIELD_CHAIN_ID, 'AutoDecrypt', allowlist],
            [{ decryptPermission: 'AutoDecrypt', programs: allowlist }],
            [],
        ];

        for (const method of methods) {
            for (const params of payloads) {
                try {
                    return await provider.request({ method, params });
                } catch (error: unknown) {
                    lastError = errorMessage(error);
                }
            }
        }
    }

    if (lastError) {
        throw new Error(lastError);
    }

    return null;
}

export async function getShieldWalletAddress(): Promise<string> {
    const errors: string[] = [];

    // Preferred path: native Shield API.
    const nativeShield = getNativeShield();
    if (nativeShield) {
        try {
            const connected = await connectKnownShield(nativeShield);
            const fromConnect = extractAddress(connected);
            const fromAccount = nativeShield.getAccount ? extractAddress(await nativeShield.getAccount()) : null;
            const fromAddress = nativeShield.getAddress ? extractAddress(await nativeShield.getAddress()) : null;
            const fromPublicKey = extractAddress(nativeShield.publicKey);
            const address = fromConnect || fromAccount || fromAddress || fromPublicKey;
            if (address && address.startsWith('aleo1')) return address;
        } catch (error: unknown) {
            errors.push(errorMessage(error));
        }
    }

    const provider = getProvider();
    if (!provider) {
        throw classifyWalletError(errors.at(-1) || 'Shield wallet extension not detected', false);
    }

    try {
        const connected = await connectKnownProvider(provider);
        const fromConnect = extractAddress(connected);
        if (fromConnect && fromConnect.startsWith('aleo1')) {
            return fromConnect;
        }
    } catch (error: unknown) {
        errors.push(errorMessage(error));
    }

    try {
        const walletAddress = await readAddressFromProvider(provider);
        if (!walletAddress.startsWith('aleo1')) {
            throw new Error('Shield wallet returned an invalid address');
        }
        return walletAddress;
    } catch (error: unknown) {
        errors.push(errorMessage(error));
    }

    throw classifyWalletError(errors.at(-1) || 'Shield wallet extension not detected', true);
}

export async function ensureShieldProgramAccess(program?: string): Promise<void> {
    const allowlist = Array.from(new Set(program ? [...PROGRAM_ALLOWLIST, program] : PROGRAM_ALLOWLIST));
    const errors: string[] = [];

    // Shield wallet: connect(network, decryptPermission, programs[])
    for (const client of getConnectCapableClients()) {
        try {
            await client.connect?.(SHIELD_CHAIN_ID, 'AutoDecrypt', allowlist);
            return;
        } catch (error: any) {
            errors.push(error?.message || String(error));
        }
        try {
            await client.connect?.({ decryptPermission: 'AutoDecrypt', programs: allowlist });
            return;
        } catch (error: any) {
            errors.push(error?.message || String(error));
        }
    }

    // Fallback to provider request RPC methods used by some wallet builds.
    const provider = getProvider();
    if (provider?.request) {
        const methods = ['wallet_connect', 'aleo_connect', 'connect'];
        const payloads = [
            [SHIELD_CHAIN_ID, 'AutoDecrypt', allowlist],
            [{ decryptPermission: 'AutoDecrypt', programs: allowlist }],
        ];
        for (const method of methods) {
            for (const params of payloads) {
                try {
                    await provider.request({ method, params });
                    return;
                } catch (error: any) {
                    errors.push(error?.message || String(error));
                }
            }
        }
    }

    if (errors.length > 0) {
        throw new Error(`Program authorization failed: ${errors[0]}`);
    }
}

async function signTextMessage(message: string): Promise<string> {
    const errors: string[] = [];

    // Try signing directly first — wallet is already connected from getShieldWalletAddress().
    // Re-calling connect here can disrupt the active session and cause "Dapp not connected".
    const nativeShield = getNativeShield();
    if (nativeShield?.signMessage) {
        try {
            const normalized = normalizeSignature(await nativeShield.signMessage(encodeUtf8(message)));
            if (normalized) return normalized;
            errors.push('Wallet returned an empty signature');
        } catch (error: unknown) {
            errors.push(errorMessage(error));
        }
        // If direct sign failed, try once more after a fresh connect
        try {
            await connectKnownShield(nativeShield);
            const normalized = normalizeSignature(await nativeShield.signMessage(encodeUtf8(message)));
            if (normalized) return normalized;
        } catch (error: unknown) {
            errors.push(errorMessage(error));
        }
    }

    const provider = getProvider();
    if (!provider) throw new Error(errors.at(-1) || 'Shield wallet extension not detected');

    if (provider.signMessage) {
        let providerSignError: string | null = null;
        try {
            const bytePayload = encodeUtf8(message) as unknown as string;
            const normalized = normalizeSignature(await provider.signMessage(bytePayload));
            if (normalized) return normalized;
        } catch (error: unknown) {
            providerSignError = errorMessage(error);
            // Fall through to text payload.
        }
        try {
            const fallback = normalizeSignature(await provider.signMessage(message));
            if (fallback) return fallback;
        } catch (error: unknown) {
            providerSignError = errorMessage(error);
            // Fall through to provider.request methods.
        }
        if (providerSignError) {
            errors.push(providerSignError);
        }
    }

    if (provider.request) {
        const methods = ['wallet_signMessage', 'aleo_signMessage', 'wallet_sign', 'aleo_sign', 'signMessage', 'sign'];
        const account = extractAddress(provider.selectedAccount || provider.account || provider.accounts);
        const messageBytes = encodeUtf8(message);
        let lastRequestError: string | null = null;
        for (const method of methods) {
            const shapes = [
                [messageBytes],
                [{ message: messageBytes }],
                [{ data: messageBytes }],
                [message],
                [{ message }],
                [{ data: message }],
                [{ message, address: account }],
                [{ message, account }],
                [account, message],
            ];
            for (const params of shapes) {
                try {
                    const result = await provider.request({ method, params });
                    const normalized = normalizeSignature(result);
                    if (normalized) return normalized;
                } catch (error: unknown) {
                    lastRequestError = errorMessage(error);
                    // Try next payload shape.
                }
            }
        }
        if (lastRequestError) {
            errors.push(lastRequestError);
        }
    }

    throw new Error(errors.at(-1) || 'Shield wallet does not support message signing');
}

export async function signShieldWalletNonce(nonce: string): Promise<string> {
    const signature = await signTextMessage(`Sign this nonce to authenticate: ${nonce}`);
    if (!signature) throw new Error('Wallet returned an empty signature');
    return signature;
}

export async function signShieldWalletMessage(message: string): Promise<string> {
    const signature = await signTextMessage(message);
    if (!signature) throw new Error('Wallet returned an empty signature');
    return signature;
}

export async function connectShieldWalletAndSign(nonce: string): Promise<WalletConnectResult> {
    const walletAddress = await getShieldWalletAddress();
    const signature = await signShieldWalletNonce(nonce);
    return { walletAddress, signature };
}

