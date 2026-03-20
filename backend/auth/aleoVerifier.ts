import { TextEncoder } from 'util';

type AddressLike = {
    from_string(value: string): {
        verify(message: Uint8Array, signature: unknown): boolean;
    };
};

type SignatureLike = {
    from_string(value: string): unknown;
    fromBytesLe(value: Uint8Array): unknown;
};

type AleoSdkModule = {
    Address: AddressLike;
    Signature: SignatureLike;
};

let sdkPromise: Promise<AleoSdkModule> | null = null;

async function loadAleoSdk(): Promise<AleoSdkModule> {
    if (!sdkPromise) {
        sdkPromise =
            process.env.ALEO_NETWORK === 'mainnet'
                ? (import('@provablehq/sdk/mainnet.js') as Promise<AleoSdkModule>)
                : (import('@provablehq/sdk/testnet.js') as Promise<AleoSdkModule>);
    }

    return sdkPromise;
}

function parseHexBytes(value: string): Uint8Array {
    const normalized = value.startsWith('0x') ? value.slice(2) : value;
    if (!/^[0-9a-f]+$/i.test(normalized) || normalized.length % 2 !== 0) {
        throw new Error('Invalid hex signature payload');
    }

    return Uint8Array.from(Buffer.from(normalized, 'hex'));
}

async function parseSignature(rawSignature: string) {
    const { Signature } = await loadAleoSdk();
    const normalized = rawSignature.trim();

    if (normalized.startsWith('sign1')) {
        return Signature.from_string(normalized);
    }

    if (/^[0-9a-f]+$/i.test(normalized) || /^0x[0-9a-f]+$/i.test(normalized)) {
        return Signature.fromBytesLe(parseHexBytes(normalized));
    }

    return Signature.fromBytesLe(Uint8Array.from(Buffer.from(normalized, 'base64')));
}

export async function verifyAleoWalletSignature(
    walletAddress: string,
    message: string,
    rawSignature: string
): Promise<boolean> {
    // Dev-only bypass: accept "insecure_signature" when flag is enabled.
    // This allows CLI/test scripts to authenticate without a real wallet.
    if (
        process.env.ALLOW_INSECURE_WALLET_SIGNATURE === 'true' &&
        process.env.NODE_ENV !== 'production' &&
        rawSignature === 'insecure_signature'
    ) {
        return true;
    }

    const { Address } = await loadAleoSdk();
    const address = Address.from_string(walletAddress);
    const signature = await parseSignature(rawSignature);
    const messageBytes = new TextEncoder().encode(message);

    return address.verify(messageBytes, signature);
}
