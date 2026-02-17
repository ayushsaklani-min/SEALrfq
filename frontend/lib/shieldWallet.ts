export interface WalletConnectResult {
    walletAddress: string;
    signature: string;
}
const DEFAULT_NETWORK = process.env.NEXT_PUBLIC_ALEO_NETWORK || 'testnet';
const DEFAULT_PROGRAM_ID = process.env.NEXT_PUBLIC_ALEO_PROGRAM_ID || 'sealrfq_v1.aleo';
const PROGRAM_ALLOWLIST = Array.from(
    new Set([DEFAULT_PROGRAM_ID, 'sealrfq_poc.aleo', 'sealrfq_v1.aleo', 'credits.aleo'])
);

type NativeShield = {
    publicKey?: string;
    connect?: (...args: any[]) => Promise<{ address?: string } | any>;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array | string | any>;
};

type WalletProvider = {
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
    return (w.shield || null) as NativeShield | null;
}

function getProvider(): WalletProvider | null {
    const w = getWindow();
    const direct = [w.shieldWallet, w.ShieldWallet, w.aleoWallet, w.aleo, w.leoWallet, w.puzzle];
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

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export async function getShieldWalletAddress(): Promise<string> {
    // Preferred path: native Shield API, matches working reference project adapter.
    const nativeShield = getNativeShield();
    if (nativeShield) {
        try {
            const connected = nativeShield.connect
                ? await nativeShield.connect(DEFAULT_NETWORK, 'DECRYPT_UPON_REQUEST', PROGRAM_ALLOWLIST)
                : null;
            const fromConnect = extractAddress(connected);
            const fromPublicKey = extractAddress(nativeShield.publicKey);
            const address = fromConnect || fromPublicKey;
            if (address && address.startsWith('aleo1')) return address;
        } catch (error: any) {
            throw new Error(error?.message || 'Shield native connect failed');
        }
    }

    const provider = getProvider();
    if (!provider) {
        throw new Error('Shield wallet extension not detected');
    }
    const walletAddress = await readAddressFromProvider(provider);
    if (!walletAddress.startsWith('aleo1')) {
        throw new Error('Shield wallet returned an invalid address');
    }
    return walletAddress;
}

export async function ensureShieldProgramAccess(program?: string): Promise<void> {
    const allowlist = Array.from(new Set(program ? [...PROGRAM_ALLOWLIST, program] : PROGRAM_ALLOWLIST));
    const errors: string[] = [];

    // Try direct connect APIs on all known injected clients.
    for (const client of getConnectCapableClients()) {
        try {
            await client.connect?.(DEFAULT_NETWORK, 'DECRYPT_UPON_REQUEST', allowlist);
            return;
        } catch (error: any) {
            errors.push(error?.message || String(error));
        }
        try {
            await client.connect?.({
                network: DEFAULT_NETWORK,
                decryptPermission: 'DECRYPT_UPON_REQUEST',
                programs: allowlist,
            });
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
            [DEFAULT_NETWORK, 'DECRYPT_UPON_REQUEST', allowlist],
            [{ network: DEFAULT_NETWORK, decryptPermission: 'DECRYPT_UPON_REQUEST', programs: allowlist }],
            [{ network: DEFAULT_NETWORK, programs: allowlist }],
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

async function signNonce(nonce: string): Promise<string> {
    const message = `Sign this nonce to authenticate: ${nonce}`;

    const nativeShield = getNativeShield();
    if (nativeShield?.signMessage) {
        const raw = await nativeShield.signMessage(encodeUtf8(message));
        if (raw instanceof Uint8Array) return bytesToBase64(raw);
        if (typeof raw === 'string' && raw.length > 0) return raw;
        if (raw?.signature instanceof Uint8Array) return bytesToBase64(raw.signature);
        if (typeof raw?.signature === 'string') return raw.signature;
    }

    const provider = getProvider();
    if (!provider) throw new Error('Shield wallet extension not detected');

    if (provider.signMessage) {
        return provider.signMessage(message);
    }

    if (provider.request) {
        const methods = ['wallet_signMessage', 'aleo_signMessage', 'wallet_sign', 'aleo_sign', 'signMessage', 'sign'];
        const account = extractAddress(provider.selectedAccount || provider.account || provider.accounts);
        for (const method of methods) {
            const shapes = [[message], [{ message }], [{ data: message }], [{ message, address: account }], [{ message, account }], [account, message]];
            for (const params of shapes) {
                try {
                    const result = await provider.request({ method, params });
                    if (typeof result === 'string' && result.length > 0) return result;
                    if (typeof result?.signature === 'string' && result.signature.length > 0) return result.signature;
                } catch {
                    // Try next payload shape.
                }
            }
        }
    }

    throw new Error('Shield wallet does not support message signing');
}

export async function signShieldWalletNonce(nonce: string): Promise<string> {
    const signature = await signNonce(nonce);
    if (!signature) throw new Error('Wallet returned an empty signature');
    return signature;
}

export async function connectShieldWalletAndSign(nonce: string): Promise<WalletConnectResult> {
    const walletAddress = await getShieldWalletAddress();
    const signature = await signShieldWalletNonce(nonce);
    return { walletAddress, signature };
}
