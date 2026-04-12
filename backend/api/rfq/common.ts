import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { TransactionTracker } from '../../tx/tracker';
import { estimateFee } from '../../aleo/fees';
import { getCurrentBlockHeight } from '../../aleo/executor';
import { getProgramMappingValue } from '../../aleo/chainState';
import type { AleoTransaction } from '../../lib/types';
import {
    PRICING_MODE,
    PROGRAM_IDS,
    RFQ_STATUS,
    TIMING,
    TOKEN_TYPE,
    canonicalActionKey,
    deriveRfqId,
    getAuctionState,
    getBidStakeFromChain,
    deriveWinnerCertificateId,
    getNextActionNonceFromChain,
    getPlatformConfig,
    getRfqChainState,
    parseBigintString,
    randomField,
    tokenSymbol,
} from '../../lib/sealProtocol';
import { getBuyerProfiles } from '../../lib/counterpartyProfile';

export const prisma = new PrismaClient();
export const tracker = new TransactionTracker(prisma);
export const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'testnet';
export const DEMO_MODE = process.env.DEMO_MODE === 'true';

export const CreateRFQSchema = z.object({
    rfqId: z.string().regex(/^\d+field$/).optional(),
    salt: z.string().regex(/^\d+field$/),
    biddingDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    minBid: z.string().regex(/^\d+$/).transform((value) => BigInt(value)),
    minBidCount: z.number().int().positive().default(1),
    metadataHash: z.string().regex(/^\d+field$/),
    tokenType: z.number().int().min(0).max(2),
    pricingMode: z.number().int().min(0).max(2),
    itemName: z.string().max(200).optional(),
    description: z.string().max(2_000).optional(),
    quantity: z.string().max(100).optional(),
    unit: z.string().max(100).optional(),
    txHash: z.string().optional(),
});

export const SelectWinnerSchema = z.object({
    winningBidId: z.string().regex(/^\d+field$/),
    txHash: z.string().optional(),
});

export const WinnerRespondSchema = z.object({
    accept: z.boolean(),
    txHash: z.string().optional(),
});

export const FundEscrowSchema = z.object({
    amount: z.string().regex(/^\d+$/).transform((value) => BigInt(value)),
    txHash: z.string().optional(),
});

export const ImportAuctionSchema = z.object({
    auctionId: z.string().regex(/^\d+field$/),
    winnerAddress: z.string().regex(/^aleo1[0-9a-z]+$/i),
    price: z.string().regex(/^\d+$/).transform((value) => BigInt(value)),
    auctionType: z.number().int().min(1).max(2),
    txHash: z.string().optional(),
});

export const StakeActionSchema = z.object({
    bidId: z.string().regex(/^\d+field$/),
    stake: z.string().regex(/^\d+$/).transform((value) => BigInt(value)).optional(),
    txHash: z.string().optional(),
});

export function buildWalletTxRequest(tx: AleoTransaction) {
    return {
        program: tx.program,
        function: tx.function,
        inputs: tx.inputs,
        fee: tx.fee.toString(),
        network: DEMO_MODE ? 'demo' : DEFAULT_NETWORK,
    };
}

export async function prepareTrackedTransition(tx: AleoTransaction, idempotencyKey: string, canonicalKey: string) {
    await tracker.prepare(tx, canonicalKey, idempotencyKey);
}

export async function nextActionNonce(walletAddress: string, rfqId: string, actionTag: number) {
    return getNextActionNonceFromChain(walletAddress, rfqId, actionTag);
}

export async function getWinningAmountFromChain(rfqId: string): Promise<string | null> {
    const winnerKey = await getProgramMappingValue('winner_bids', rfqId);
    const uniqueBidKey = parseBigintString(winnerKey) ? `${parseBigintString(winnerKey)}field` : null;
    if (!uniqueBidKey) return null;
    return parseBigintString(await getProgramMappingValue('revealed_bids', uniqueBidKey));
}

export async function augmentRFQ(rfq: any) {
    const [chain, platform, winningBid, onChainWinningAmount, buyerProfiles] = await Promise.all([
        getRfqChainState(rfq.id),
        getPlatformConfig(),
        prisma.bid.findFirst({
            where: { rfqId: rfq.id, isWinner: true },
            select: { id: true, vendor: true, revealedAmount: true, stake: true },
        }),
        getWinningAmountFromChain(rfq.id),
        getBuyerProfiles(prisma, [rfq.buyer]),
    ]);

    // statusCode 0 means the RFQ does not exist on-chain yet (the on-chain
    // contract always creates with status >= 1).  Fall back to DB state so the
    // API returns meaningful values while the on-chain tx is pending / in tests.
    const onChainExists = chain.statusCode !== 0;
    const tokenType = onChainExists ? chain.escrowToken : (rfq.tokenType ?? chain.escrowToken);
    const pricingMode = onChainExists ? chain.pricingMode : (rfq.pricingMode ?? chain.pricingMode);
    const paid = onChainExists ? chain.paid : Boolean(rfq.paid);
    const auctionSource = onChainExists ? chain.auctionSource : (rfq.auctionSource ?? null);
    const receiptHash = onChainExists ? chain.receiptHash : (rfq.receiptHash ?? null);
    const winnerAccepted = onChainExists ? chain.winnerAccepted : Boolean(rfq.winnerAccepted);

    return {
        ...rfq,
        minBid: rfq.minBid.toString(),
        status: onChainExists ? chain.status : rfq.status,
        statusCode: onChainExists ? chain.statusCode : undefined,
        biddingDeadline: chain.biddingDeadline ?? rfq.biddingDeadline,
        revealDeadline: chain.revealDeadline ?? rfq.revealDeadline,
        minBidCount: chain.minBidCount,
        bidCount: chain.bidCount,
        flatStake: chain.flatStake,
        tokenType,
        tokenSymbol: tokenSymbol(tokenType),
        pricingMode,
        creator: chain.creator ?? rfq.buyer,
        buyerProfile: buyerProfiles[rfq.buyer] ?? null,
        lifecycleBlock: chain.lifecycleBlock,
        paid,
        platformPaused: platform.paused,
        platformInitialized: platform.initialized,
        feeBps: platform.feeBps,
        auctionSource,
        receiptHash,
        settlementProof: chain.settlementProof,
        paymentProof: chain.paymentProof,
        winnerAccepted,
        winningBidId: winningBid?.id ?? null,
        winningVendor: winningBid?.vendor ?? chain.winner ?? null,
        winningBidAmount: winningBid?.revealedAmount?.toString() ?? onChainWinningAmount,
        winningStake: winningBid?.stake?.toString() ?? null,
        estimatedFundEscrowFee: estimateFee(
            tokenType === TOKEN_TYPE.USDCX
                ? 'fund_escrow_usdcx'
                : tokenType === TOKEN_TYPE.USAD
                  ? 'fund_escrow_usad'
                  : 'fund_escrow',
        ).toString(),
    };
}

export function serializeBid(bid: any) {
    return {
        ...bid,
        stake: bid.stake?.toString(),
        revealedAmount: bid.revealedAmount?.toString() ?? null,
    };
}

export async function resolveCancelMode(rfqId: string, fallbackBuyer: string, walletAddress: string) {
    const chain = await getRfqChainState(rfqId);
    const currentBlock = await getCurrentBlockHeight();
    const bidCount = BigInt(chain.bidCount ?? '0');
    const minBidCount = BigInt(chain.minBidCount ?? '0');
    const creator = chain.creator ?? fallbackBuyer;

    if (walletAddress === creator && chain.biddingDeadline && currentBlock < chain.biddingDeadline && chain.status === 'OPEN') {
        return { mode: 3, creator };
    }
    if (chain.status === 'OPEN' && chain.biddingDeadline && currentBlock >= chain.biddingDeadline && bidCount < minBidCount) {
        return { mode: 0, creator };
    }
    if (
        chain.status === 'REVEAL' &&
        chain.revealDeadline &&
        currentBlock > chain.revealDeadline + TIMING.SLASH_WINDOW
    ) {
        return { mode: 1, creator };
    }
    if (
        chain.status === 'WINNER_SELECTED' &&
        chain.lifecycleBlock &&
        currentBlock > chain.lifecycleBlock + TIMING.ESCROW_TIMEOUT_BLOCKS
    ) {
        return { mode: 2, creator };
    }
    return null;
}

export function escrowFundingTransition(tokenType: number) {
    if (tokenType === TOKEN_TYPE.USDCX) return 'fund_escrow_usdcx';
    if (tokenType === TOKEN_TYPE.USAD) return 'fund_escrow_usad';
    return 'fund_escrow';
}

export async function rfqIdForCreate(walletAddress: string, salt: string, suppliedRfqId?: string) {
    const derivedRfqId = await deriveRfqId(walletAddress, salt);
    if (suppliedRfqId && suppliedRfqId !== derivedRfqId) {
        throw new Error('Supplied RFQ id does not match the v15 derived id for this wallet and salt.');
    }
    return derivedRfqId;
}

export async function createTransitionInputs(data: z.infer<typeof CreateRFQSchema>, walletAddress: string) {
    const rfqId = await rfqIdForCreate(walletAddress, data.salt, data.rfqId);
    return {
        rfqId,
        tx: {
            program: PROGRAM_IDS.rfq,
            function: 'create_rfq',
            inputs: [
                rfqId,
                data.salt,
                `${data.biddingDeadline}u32`,
                `${data.revealDeadline}u32`,
                `${data.minBid}u64`,
                `${data.minBidCount}u64`,
                data.metadataHash,
                `${data.tokenType}u8`,
                `${data.pricingMode}u8`,
            ],
            fee: estimateFee('create_rfq'),
        } satisfies AleoTransaction,
    };
}

export async function winnerCertificate(rfqId: string, winningBidId: string, winnerAddress: string) {
    return {
        rfqId,
        winningBidId,
        winnerAddress,
        certificateId: await deriveWinnerCertificateId(rfqId, winningBidId, winnerAddress),
    };
}

export { canonicalActionKey, estimateFee, getAuctionState, getBidStakeFromChain, getCurrentBlockHeight, getPlatformConfig, getRfqChainState, PRICING_MODE, PROGRAM_IDS, randomField, RFQ_STATUS, TIMING, TOKEN_TYPE };
