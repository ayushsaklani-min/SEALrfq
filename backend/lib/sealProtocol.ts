import crypto from 'crypto';
import { getProgramMappingValue } from '../aleo/chainState';

type HashSdkModule = {
    BHP256: new () => {
        hash(input: Array<any>): {
            toString(): string;
        };
    };
    Plaintext: {
        fromString(plaintext: string): {
            toBitsLe(): Array<any>;
        };
    };
};

export const PROGRAM_IDS = {
    rfq: process.env.ALEO_PROGRAM_ID || 'sealrfq_v18.aleo',
    invoice: process.env.ALEO_INVOICE_PROGRAM_ID || 'sealrfq_invoice_v1.aleo',
    credits: 'credits.aleo',
    usdcx: 'test_usdcx_stablecoin.aleo',
    usad: 'test_usad_stablecoin.aleo',
    vickrey: process.env.ALEO_VICKREY_PROGRAM_ID || 'sealvickrey_v2.aleo',
    dutch: process.env.ALEO_DUTCH_PROGRAM_ID || 'sealdutch_v4.aleo',
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

export const RFQ_STATUS = {
    NONE: 'NONE',
    OPEN: 'OPEN',
    REVEAL: 'REVEAL',
    WINNER_SELECTED: 'WINNER_SELECTED',
    ESCROW_FUNDED: 'ESCROW_FUNDED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    WINNER_DECLINED: 'WINNER_DECLINED',
} as const;

export const STATUS_CODE_LABELS: Record<number, keyof typeof RFQ_STATUS> = {
    0: 'NONE',
    1: 'OPEN',
    2: 'REVEAL',
    3: 'WINNER_SELECTED',
    4: 'ESCROW_FUNDED',
    5: 'COMPLETED',
    6: 'CANCELLED',
    7: 'WINNER_DECLINED',
};

export const TIMING = {
    MIN_REVEAL_WINDOW: 720,
    ESCROW_TIMEOUT_BLOCKS: 2160,
    SLASH_WINDOW: 1440,
    ESCROW_RECOVERY_BLOCKS: 2880,
    SNIPE_WINDOW_BLOCKS: 40,
    SNIPE_EXTENSION_BLOCKS: 40,
    MAX_RFQ_DURATION: 100_000,
    FEE_DENOMINATOR: 10_000,
    APPROX_BLOCK_TIME_MS: Number(process.env.ALEO_APPROX_BLOCK_TIME_MS || '5000'),
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

export type TokenType = typeof TOKEN_TYPE[keyof typeof TOKEN_TYPE];
export type PricingMode = typeof PRICING_MODE[keyof typeof PRICING_MODE];

export type PlatformConfig = {
    adminHash: string;
    feeBps: number;
    paused: boolean;
    treasuryCredits: string;
    treasuryUsdcx: string;
    treasuryUsad: string;
    initialized: boolean;
};

export type ChainRfqState = {
    status: keyof typeof RFQ_STATUS;
    statusCode: number;
    biddingDeadline: number | null;
    revealDeadline: number | null;
    minBid: string | null;
    minBidCount: string | null;
    bidCount: string | null;
    creator: string | null;
    winner: string | null;
    lifecycleBlock: number | null;
    flatStake: string | null;
    escrowToken: number;
    pricingMode: number;
    paid: boolean;
    winnerAccepted: boolean;
    auctionSource: string | null;
    receiptHash: string | null;
    settlementProof: string | null;
    paymentProof: string | null;
};

export function randomField(nonZero = true): string {
    while (true) {
        const bytes = crypto.randomBytes(32);
        const value = BigInt(`0x${bytes.toString('hex')}`);
        if (!nonZero || value > 0n) {
            return `${value.toString()}field`;
        }
    }
}

export function sha256ToField(parts: Array<string | number | bigint | boolean>): string {
    const digest = crypto
        .createHash('sha256')
        .update(parts.map((part) => String(part)).join('|'))
        .digest('hex');
    const value = BigInt(`0x${digest}`);
    return `${value.toString()}field`;
}

let hashSdkPromise: Promise<HashSdkModule> | null = null;

async function loadHashSdk(): Promise<HashSdkModule> {
    if (!hashSdkPromise) {
        hashSdkPromise =
            process.env.ALEO_NETWORK === 'mainnet'
                ? (import('@provablehq/sdk/mainnet.js') as Promise<HashSdkModule>)
                : (import('@provablehq/sdk/testnet.js') as Promise<HashSdkModule>);
    }
    return hashSdkPromise;
}

export async function bhpHashToFieldFromPlaintext(plaintext: string): Promise<string> {
    const { BHP256, Plaintext } = await loadHashSdk();
    const bhp = new BHP256();
    const value = Plaintext.fromString(plaintext);
    return bhp.hash(value.toBitsLe()).toString();
}

export async function hashAddressToField(address: string): Promise<string> {
    return bhpHashToFieldFromPlaintext(address);
}

export async function deriveRfqId(creator: string, salt: string): Promise<string> {
    return bhpHashToFieldFromPlaintext(`{ creator: ${creator}, salt: ${salt} }`);
}

export async function deriveAuctionId(creator: string, salt: string): Promise<string> {
    return bhpHashToFieldFromPlaintext(`{ creator: ${creator}, salt: ${salt} }`);
}

export async function deriveCommitment(bidAmount: string | bigint, nonce: string): Promise<string> {
    return bhpHashToFieldFromPlaintext(`{ bid_amount: ${bidAmount}u64, nonce: ${nonce} }`);
}

export async function deriveWinnerCertificateId(
    rfqId: string,
    winningBidId: string,
    winnerAddress: string,
): Promise<string> {
    return bhpHashToFieldFromPlaintext(
        `{ rfq_id: ${rfqId}, winning_bid_id: ${winningBidId}, winner_address: ${winnerAddress} }`,
    );
}

export async function deriveBidKey(rfqId: string, bidId: string): Promise<string> {
    return bhpHashToFieldFromPlaintext(`{ rfq_id: ${rfqId}, bid_id: ${bidId} }`);
}

export async function deriveReceiptHash(
    rfqId: string,
    payer: string,
    winner: string,
    amount: string | bigint,
    nonce: string,
): Promise<string> {
    return bhpHashToFieldFromPlaintext(
        `{ rfq_id: ${rfqId}, payer: ${payer}, winner: ${winner}, amount: ${amount}u64, nonce: ${nonce} }`,
    );
}

export async function getNextActionNonceFromChain(
    actorAddress: string,
    rfqId: string,
    actionTag: number,
): Promise<number> {
    const nonceKey = await bhpHashToFieldFromPlaintext(
        `{ actor: ${actorAddress}, action_tag: ${actionTag}u8, rfq_id: ${rfqId} }`,
    );
    const storedNonce = parseBigintString(await getProgramMappingValue('actor_nonces', nonceKey));
    return Number(BigInt(storedNonce ?? '0') + 1n);
}

export function canonicalActionKey(
    scope: string,
    actor: string,
    subjectId: string,
    extra?: string,
): string {
    return [scope, actor, subjectId, extra].filter(Boolean).join(':');
}

export function tokenSymbol(tokenType: number | null | undefined): 'ALEO' | 'USDCx' | 'USAD' {
    if (tokenType === TOKEN_TYPE.USDCX) return 'USDCx';
    if (tokenType === TOKEN_TYPE.USAD) return 'USAD';
    return 'ALEO';
}

export function parsePlaintext(input: any): string | null {
    if (input === null || input === undefined) return null;
    if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
        return String(input);
    }
    if (typeof input?.plaintext === 'string') return input.plaintext;
    if (typeof input?.value === 'string') return input.value;
    if (typeof input?.data === 'string') return input.data;
    return null;
}

export function parseBool(input: any, fallback = false): boolean {
    const raw = parsePlaintext(input)?.trim().toLowerCase();
    if (!raw) return fallback;
    if (raw.includes('true')) return true;
    if (raw.includes('false')) return false;
    return fallback;
}

export function parseInteger(input: any): number | null {
    const raw = parsePlaintext(input);
    if (!raw) return null;
    const match = raw.match(/-?\d+/);
    return match ? Number(match[0]) : null;
}

export function parseBigintString(input: any): string | null {
    const raw = parsePlaintext(input);
    if (!raw) return null;
    const match = raw.match(/-?\d+/);
    return match ? match[0] : null;
}

export function parseAddress(input: any): string | null {
    const raw = parsePlaintext(input);
    if (!raw) return null;
    const match = raw.match(/aleo1[0-9a-z]+/i);
    return match ? match[0] : null;
}

function parseField(input: any): string | null {
    const raw = parsePlaintext(input);
    if (!raw) return null;
    const match = raw.match(/\d+field/);
    return match ? match[0] : raw;
}

function parsePlatformConfigPlaintext(plaintext: string | null): PlatformConfig {
    if (!plaintext) {
        return {
            adminHash: '0field',
            feeBps: 0,
            paused: false,
            treasuryCredits: '0',
            treasuryUsdcx: '0',
            treasuryUsad: '0',
            initialized: false,
        };
    }

    const fieldFor = (key: string) => plaintext.match(new RegExp(`${key}:\\s*([^,}\\s]+)`))?.[1] ?? null;
    const u64For = (key: string) => fieldFor(key)?.match(/-?\d+/)?.[0] ?? '0';

    const adminHash = fieldFor('admin_hash') ?? '0field';
    const feeBps = Number(u64For('fee_bps'));
    const paused = (fieldFor('paused') ?? 'false').includes('true');
    const treasuryCredits = u64For('treasury_credits');
    const treasuryUsdcx = u64For('treasury_usdcx');
    const treasuryUsad = u64For('treasury_usad');

    return {
        adminHash,
        feeBps,
        paused,
        treasuryCredits,
        treasuryUsdcx,
        treasuryUsad,
        initialized: adminHash !== '0field',
    };
}

let platformConfigCache: { value: PlatformConfig; expiresAt: number } | null = null;

export async function getPlatformConfig(forceRefresh = false): Promise<PlatformConfig> {
    const now = Date.now();
    if (!forceRefresh && platformConfigCache && platformConfigCache.expiresAt > now) {
        return platformConfigCache.value;
    }

    const raw = await getProgramMappingValue('platform_config', '0u8');
    const value = parsePlatformConfigPlaintext(parsePlaintext(raw));
    platformConfigCache = {
        value,
        expiresAt: now + 15_000,
    };
    return value;
}

async function readMappings(entries: Array<[string, string]>) {
    const values = await Promise.all(entries.map(([mapping, key]) => getProgramMappingValue(mapping, key)));
    return entries.reduce<Record<string, any>>((acc, [mapping], index) => {
        acc[mapping] = values[index];
        return acc;
    }, {});
}

export async function getRfqChainState(rfqId: string): Promise<ChainRfqState> {
    const mapping = await readMappings([
        ['rfq_status', rfqId],
        ['rfq_bidding_deadlines', rfqId],
        ['rfq_reveal_deadlines', rfqId],
        ['rfq_min_bids', rfqId],
        ['rfq_min_bid_count', rfqId],
        ['rfq_bid_count', rfqId],
        ['rfq_creators', rfqId],
        ['rfq_winner_address', rfqId],
        ['rfq_lifecycle_block', rfqId],
        ['rfq_flat_stake', rfqId],
        ['escrow_token', rfqId],
        ['rfq_mode', rfqId],
        ['paid', rfqId],
        ['rfq_winner_accepted', rfqId],
        ['auction_source', rfqId],
        ['receipts', rfqId],
    ]);

    const statusCode = parseInteger(mapping.rfq_status) ?? 0;
    const [settlementProofKey, paymentProofKey] = await Promise.all([
        bhpHashToFieldFromPlaintext(`{ rfq_id: ${rfqId}, proof_tag: 1u8 }`),
        bhpHashToFieldFromPlaintext(`{ rfq_id: ${rfqId}, proof_tag: 2u8 }`),
    ]);
    const settlementProof = await getProgramMappingValue('v16_proofs', settlementProofKey).then(parseField);
    const paymentProof = await getProgramMappingValue('v16_proofs', paymentProofKey).then(parseField);

    return {
        status: STATUS_CODE_LABELS[statusCode] ?? 'NONE',
        statusCode,
        biddingDeadline: parseInteger(mapping.rfq_bidding_deadlines),
        revealDeadline: parseInteger(mapping.rfq_reveal_deadlines),
        minBid: parseBigintString(mapping.rfq_min_bids),
        minBidCount: parseBigintString(mapping.rfq_min_bid_count),
        bidCount: parseBigintString(mapping.rfq_bid_count),
        creator: parseAddress(mapping.rfq_creators),
        winner: parseAddress(mapping.rfq_winner_address),
        lifecycleBlock: parseInteger(mapping.rfq_lifecycle_block),
        flatStake: parseBigintString(mapping.rfq_flat_stake),
        escrowToken: parseInteger(mapping.escrow_token) ?? TOKEN_TYPE.CREDITS,
        pricingMode: parseInteger(mapping.rfq_mode) ?? PRICING_MODE.RFQ,
        paid: parseBool(mapping.paid),
        winnerAccepted: parseBool(mapping.rfq_winner_accepted),
        auctionSource: parseField(mapping.auction_source),
        receiptHash: parseField(mapping.receipts),
        settlementProof,
        paymentProof,
    };
}

export async function getWinningAmountFromChain(rfqId: string): Promise<string | null> {
    const winnerKey = await getProgramMappingValue('winner_bids', rfqId);
    const uniqueBidKey = parseBigintString(winnerKey) ? `${parseBigintString(winnerKey)}field` : null;
    if (!uniqueBidKey) return null;
    return parseBigintString(await getProgramMappingValue('revealed_bids', uniqueBidKey));
}

export async function getBidStakeFromChain(rfqId: string, bidId: string): Promise<string | null> {
    const uniqueBidKey = await deriveBidKey(rfqId, bidId);
    return parseBigintString(await getProgramMappingValue('bid_stakes', uniqueBidKey));
}

export async function getAuctionState(kind: 'vickrey' | 'dutch', auctionId: string) {
    const program = kind === 'vickrey' ? PROGRAM_IDS.vickrey : PROGRAM_IDS.dutch;
    const rpcEntries =
        kind === 'vickrey'
            ? [
                  ['auction_status', auctionId],
                  ['auction_creators', auctionId],
                  ['auction_rfq_id', auctionId],
                  ['auction_bidding_deadlines', auctionId],
                  ['auction_reveal_deadlines', auctionId],
                  ['auction_bid_count', auctionId],
                  ['auction_revealed_count', auctionId],
                  ['auction_flat_stake', auctionId],
                  ['auction_lowest_bid', auctionId],
                  ['auction_second_lowest_bid', auctionId],
                  ['auction_final_winner', auctionId],
                  ['auction_final_price', auctionId],
              ]
            : [
                  ['auction_status', auctionId],
                  ['auction_creators', auctionId],
                  ['auction_rfq_id', auctionId],
                  ['auction_start_price', auctionId],
                  ['auction_reserve_price', auctionId],
                  ['auction_price_decrement', auctionId],
                  ['auction_start_block', auctionId],
                  ['auction_end_block', auctionId],
                  ['auction_final_winner', auctionId],
                  ['auction_final_price', auctionId],
                  ['first_commit_block', auctionId],
              ];

    const values = await Promise.all(
        rpcEntries.map(([mapping, key]) => getProgramMappingValueForProgram(program, mapping, key)),
    );

    const mapped = rpcEntries.reduce<Record<string, any>>((acc, [mapping], index) => {
        acc[mapping] = values[index];
        return acc;
    }, {});
    return {
        auctionId,
        program,
        kind,
        statusCode: parseInteger(mapped.auction_status) ?? 0,
        creator: parseAddress(mapped.auction_creators),
        rfqId: parseField(mapped.auction_rfq_id),
        // Both current auction contracts (sealvickrey_v2, sealdutch_v4) only support ALEO credits.
        tokenType: TOKEN_TYPE.CREDITS,
        tokenSymbol: tokenSymbol(TOKEN_TYPE.CREDITS),
        bidCount: parseBigintString(mapped.auction_bid_count),
        revealedCount: parseBigintString(mapped.auction_revealed_count),
        flatStake: parseBigintString(mapped.auction_flat_stake),
        biddingDeadline: parseInteger(mapped.auction_bidding_deadlines),
        revealDeadline: parseInteger(mapped.auction_reveal_deadlines),
        lowestBid: parseBigintString(mapped.auction_lowest_bid),
        secondLowestBid: parseBigintString(mapped.auction_second_lowest_bid),
        finalWinner: parseAddress(mapped.auction_final_winner),
        finalPrice: parseBigintString(mapped.auction_final_price),
        startPrice: parseBigintString(mapped.auction_start_price),
        reservePrice: parseBigintString(mapped.auction_reserve_price),
        priceDecrement: parseBigintString(mapped.auction_price_decrement),
        startBlock: parseInteger(mapped.auction_start_block),
        endBlock: parseInteger(mapped.auction_end_block),
        firstCommitBlock: parseInteger(mapped.first_commit_block),
    };
}

export async function getProgramMappingValueForProgram(programId: string, mapping: string, key: string): Promise<any | null> {
    const endpoint = process.env.ALEO_RPC_URL || 'https://api.explorer.provable.com/v1';
    const network = process.env.ALEO_NETWORK || 'testnet';
    const url = `${endpoint}/${network}/program/${programId}/mapping/${mapping}/${encodeURIComponent(key)}`;
    try {
        const response = await fetch(url, { method: 'GET', cache: 'no-store' });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}
