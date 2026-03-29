import { z } from 'zod';

export const PROGRAM_IDS = {
    rfq: process.env.NEXT_PUBLIC_ALEO_PROGRAM_ID || 'sealrfq_v18.aleo',
    invoice: process.env.NEXT_PUBLIC_ALEO_INVOICE_PROGRAM_ID || 'sealrfq_invoice_v1.aleo',
    vickrey: process.env.NEXT_PUBLIC_ALEO_VICKREY_PROGRAM_ID || 'sealvickrey_v8.aleo',
    dutch: process.env.NEXT_PUBLIC_ALEO_DUTCH_PROGRAM_ID || 'sealdutch_v8.aleo',
    credits: 'credits.aleo',
    usdcx: 'test_usdcx_stablecoin.aleo',
    usad: 'test_usad_stablecoin.aleo',
} as const;

export const TOKEN_TYPE = {
    CREDITS: 0,
    USDCX: 1,
    USAD: 2,
} as const;

export const PRICING_MODE = {
    RFQ: 0,
    VICKREY: 1,
    DUTCH: 2,
} as const;

export const STATUS_LABELS: Record<string, string> = {
    NONE: 'Not Created',
    OPEN: 'Accepting Bids',
    REVEAL: 'Reveal Phase',
    WINNER_SELECTED: 'Awaiting Winner Response',
    ESCROW_FUNDED: 'In Delivery',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    WINNER_DECLINED: 'Winner Declined',
};

export const TIMING = {
    MIN_REVEAL_WINDOW: 720,
    ESCROW_TIMEOUT_BLOCKS: 2160,
    SLASH_WINDOW: 1440,
    ESCROW_RECOVERY_BLOCKS: 2880,
    SNIPE_WINDOW_BLOCKS: 40,
    SNIPE_EXTENSION_BLOCKS: 40,
    MAX_RFQ_DURATION: 100_000,
    BLOCK_MS: Number(process.env.NEXT_PUBLIC_ALEO_APPROX_BLOCK_TIME_MS || '5000'),
    FEE_DENOMINATOR: 10_000,
} as const;

export const ACTION_TAG = {
    COMMIT: 1,
    REVEAL: 2,
    PAYMENT_CREDITS: 3,
    INVOICE_CREDITS: 4,
    FINAL_USDCX: 5,
    INVOICE_USDCX: 6,
    FINAL_USAD: 7,
    INVOICE_USAD: 8,
    PARTIAL_USDCX: 9,
    PARTIAL_USAD: 10,
} as const;

export type PlatformConfig = {
    adminHash: string;
    feeBps: number;
    paused: boolean;
    treasuryCredits: string;
    treasuryUsdcx: string;
    treasuryUsad: string;
    initialized: boolean;
};

export const createRfqSchema = z
    .object({
        biddingDeadline: z.number().int().positive(),
        revealDeadline: z.number().int().positive(),
        minBid: z.string().regex(/^\d+$/),
        minBidCount: z.number().int().positive().default(1),
        metadataHash: z.string().regex(/^\d+field$/),
        tokenType: z.number().int().min(0).max(2),
        pricingMode: z.number().int().min(0).max(2),
        salt: z.string().regex(/^\d+field$/),
    })
    .refine((value) => value.revealDeadline > value.biddingDeadline, {
        message: 'Reveal deadline must be after bidding deadline',
        path: ['revealDeadline'],
    })
    .refine((value) => value.revealDeadline - value.biddingDeadline >= TIMING.MIN_REVEAL_WINDOW, {
        message: `Reveal window must be at least ${TIMING.MIN_REVEAL_WINDOW} blocks`,
        path: ['revealDeadline'],
    });

export const bidCommitSchema = z.object({
    rfqId: z.string().regex(/^\d+field$/),
    bidAmount: z.string().regex(/^\d+$/),
    nonce: z.string().regex(/^\d+field$/),
    stake: z.string().regex(/^\d+$/),
});

export const partialReleaseSchema = z.object({
    amount: z.string().regex(/^\d+$/),
    percentage: z.number().int().min(1).max(100),
    feeBps: z.number().int().min(0).max(TIMING.FEE_DENOMINATOR),
});

export const invoiceSchema = z.object({
    amount: z.string().regex(/^\d+$/),
    receiptNonce: z.string().regex(/^\d+field$/),
    paymentRecord: z.union([z.string().min(1), z.record(z.string(), z.unknown())]),
    proofs: z.string().optional(),
});

export const vickreyAuctionSchema = z.object({
    auctionId: z.string().regex(/^\d+field$/),
    salt: z.string().regex(/^\d+field$/),
    rfqId: z.string().regex(/^\d+field$/),
    tokenType: z.number().int().min(0).max(2),
    biddingDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    minBid: z.string().regex(/^\d+$/),
});

export const dutchAuctionSchema = z.object({
    auctionId: z.string().regex(/^\d+field$/),
    salt: z.string().regex(/^\d+field$/),
    rfqId: z.string().regex(/^\d+field$/),
    tokenType: z.number().int().min(0).max(2),
    startPrice: z.string().regex(/^\d+$/),
    reservePrice: z.string().regex(/^\d+$/),
    decrementPerBlock: z.string().regex(/^\d+$/),
    startBlock: z.number().int().positive(),
    endBlock: z.number().int().positive(),
});

export function tokenLabel(tokenType: number | null | undefined) {
    if (tokenType === TOKEN_TYPE.USDCX) return 'USDCx';
    if (tokenType === TOKEN_TYPE.USAD) return 'USAD';
    return 'ALEO';
}

export function pricingLabel(mode: number | null | undefined) {
    if (mode === PRICING_MODE.VICKREY) return 'Vickrey';
    if (mode === PRICING_MODE.DUTCH) return 'Dutch';
    return 'RFQ';
}

export function formatAmount(
    amount: string | number | bigint | null | undefined,
    tokenType: number = TOKEN_TYPE.CREDITS,
) {
    if (amount === null || amount === undefined) return '--';
    try {
        const raw = typeof amount === 'bigint' ? amount : BigInt(amount);
        const whole = raw / 1_000_000n;
        const fraction = raw % 1_000_000n;
        const fractionPart =
            fraction === 0n ? '' : `.${fraction.toString().padStart(6, '0').replace(/0+$/, '')}`;
        return `${whole}${fractionPart} ${tokenLabel(tokenType)}`;
    } catch {
        return `${amount} ${tokenLabel(tokenType)}`;
    }
}

// Returns a human time string for a deadline block relative to current block.
// e.g. "in ~2h 30m" | "in ~45m" | "closed" | "block 15400142"
export function blockEta(targetBlock: number | null | undefined, currentBlock: number | null | undefined): string {
    if (!targetBlock) return '--';
    if (!currentBlock) return `block ${targetBlock}`;
    const delta = targetBlock - currentBlock;
    if (delta <= 0) return 'closed';
    return `in ~${formatBlockTime(delta)}`;
}

export function formatBlockTime(blockDelta: number) {
    const totalSeconds = Math.max(0, Math.round((blockDelta * TIMING.BLOCK_MS) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

export function randomField(nonZero = true) {
    while (true) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        let value = 0n;
        for (const byte of bytes) {
            value = (value << 8n) | BigInt(byte);
        }
        if (!nonZero || value > 0n) {
            return `${value.toString()}field`;
        }
    }
}

export async function hashToField(parts: Array<string | number | bigint | boolean>) {
    const payload = new TextEncoder().encode(parts.map((part) => String(part)).join('|'));
    const digest = await crypto.subtle.digest('SHA-256', payload);
    const bytes = new Uint8Array(digest);
    let value = 0n;
    for (const byte of bytes) {
        value = (value << 8n) | BigInt(byte);
    }
    return `${value.toString()}field`;
}

export async function deriveRfqId(creator: string, salt: string) {
    return hashToField(['RFQ_ID', creator, salt]);
}

export async function deriveAuctionId(creator: string, salt: string, kind: 'vickrey' | 'dutch') {
    return hashToField([kind.toUpperCase(), creator, salt]);
}

export async function deriveCommitment(bidAmount: string, nonce: string) {
    return hashToField(['COMMIT', bidAmount, nonce]);
}

export function calculateFee(amount: string | bigint, feeBps: number) {
    const base = typeof amount === 'bigint' ? amount : BigInt(amount);
    return (base * BigInt(feeBps)) / BigInt(TIMING.FEE_DENOMINATOR);
}

export function netAfterFee(amount: string | bigint, feeBps: number) {
    const base = typeof amount === 'bigint' ? amount : BigInt(amount);
    return base - calculateFee(base, feeBps);
}

export function resolveActionTag(tokenType: number, action: 'partial' | 'final' | 'invoice') {
    if (action === 'invoice') {
        if (tokenType === TOKEN_TYPE.USDCX) return ACTION_TAG.INVOICE_USDCX;
        if (tokenType === TOKEN_TYPE.USAD) return ACTION_TAG.INVOICE_USAD;
        return ACTION_TAG.INVOICE_CREDITS;
    }
    if (action === 'final') {
        if (tokenType === TOKEN_TYPE.USDCX) return ACTION_TAG.FINAL_USDCX;
        if (tokenType === TOKEN_TYPE.USAD) return ACTION_TAG.FINAL_USAD;
        return ACTION_TAG.PAYMENT_CREDITS;
    }
    if (tokenType === TOKEN_TYPE.USDCX) return ACTION_TAG.PARTIAL_USDCX;
    if (tokenType === TOKEN_TYPE.USAD) return ACTION_TAG.PARTIAL_USAD;
    return ACTION_TAG.PAYMENT_CREDITS;
}
