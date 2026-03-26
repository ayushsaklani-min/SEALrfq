import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireRole } from '../../auth/middleware';
import { estimateFee } from '../../aleo/fees';
import { getCurrentBlockHeight } from '../../aleo/executor';
import { TransactionTracker } from '../../tx/tracker';
import type { AleoTransaction } from '../../lib/types';
import {
    ACTION_TAG,
    deriveCommitment,
    getNextActionNonceFromChain,
    PROGRAM_IDS,
    RFQ_STATUS,
    canonicalActionKey,
    getRfqChainState,
    randomField,
} from '../../lib/sealProtocol';

const prisma = new PrismaClient();
const tracker = new TransactionTracker(prisma);
const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'testnet';
const DEMO_MODE = process.env.DEMO_MODE === 'true';

const CommitBidSchema = z.object({
    rfqId: z.string().regex(/^\d+field$/),
    bidAmount: z.string().regex(/^\d+$/).transform((value) => BigInt(value)),
    nonce: z.string().regex(/^\d+field$/),
    stake: z.string().regex(/^\d+$/).transform((value) => BigInt(value)),
    txHash: z.string().optional(),
    bidId: z.string().regex(/^\d+field$/).optional(),
});

const RevealBidSchema = z.object({
    bidAmount: z.string().regex(/^\d+$/).transform((value) => BigInt(value)),
    nonce: z.string().regex(/^\d+field$/),
    txHash: z.string().optional(),
});

function buildWalletTxRequest(tx: AleoTransaction) {
    return {
        program: tx.program,
        function: tx.function,
        inputs: tx.inputs,
        fee: tx.fee.toString(),
        network: DEMO_MODE ? 'demo' : DEFAULT_NETWORK,
    };
}

async function prepareTrackedTransition(tx: AleoTransaction, idempotencyKey: string, canonicalKey: string) {
    await tracker.prepare(tx, canonicalKey, idempotencyKey);
}

async function nextActionNonce(walletAddress: string, rfqId: string, actionTag: number) {
    return getNextActionNonceFromChain(walletAddress, rfqId, actionTag);
}

async function commitmentHash(bidAmount: bigint, nonce: string) {
    return deriveCommitment(bidAmount, nonce);
}

function serializeBid(bid: any) {
    return {
        ...bid,
        stake: bid.stake?.toString(),
        revealedAmount: bid.revealedAmount?.toString() ?? null,
    };
}

async function recoverCommitBidIdFromTxHash(rfqId: string, walletAddress: string, txHash: string): Promise<string | null> {
    const existing = await prisma.bid.findFirst({
        where: { rfqId, vendor: walletAddress, createdTxId: txHash },
        select: { id: true },
    });
    if (existing?.id) return existing.id;

    const tracked = await prisma.transaction.findUnique({
        where: { txHash },
        select: { canonicalTxKey: true },
    });
    const canonicalKey = tracked?.canonicalTxKey ?? '';
    if (!canonicalKey || !canonicalKey.includes(`:${rfqId}:`)) {
        return null;
    }

    const candidate = canonicalKey.split(':').at(-1) ?? null;
    return candidate && /^\d+field$/.test(candidate) ? candidate : null;
}

export async function handleCommitBid(request: NextRequest) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = CommitBidSchema.parse(await request.json());
        const rfq = await prisma.rFQ.findUnique({ where: { id: data.rfqId } });
        const chain = await getRfqChainState(data.rfqId);

        if (!rfq) {
            return NextResponse.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } }, { status: 404 });
        }
        if (chain.status !== RFQ_STATUS.OPEN) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: `RFQ is in ${chain.status}, not OPEN.` } }, { status: 400 });
        }
        if (chain.pricingMode !== 0) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_MODE', message: 'Direct RFQ commits are disabled for imported auction pricing modes.' } }, { status: 400 });
        }
        if (chain.minBid && data.bidAmount < BigInt(chain.minBid)) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_AMOUNT', message: `Bid must be at least ${chain.minBid}.` } }, { status: 400 });
        }
        if (chain.flatStake && data.stake !== BigInt(chain.flatStake)) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_STAKE', message: `Stake must equal the flat stake of ${chain.flatStake}.` } }, { status: 400 });
        }

        const existingBid = await prisma.bid.findFirst({ where: { rfqId: data.rfqId, vendor: auth.walletAddress } });
        if (existingBid) {
            if (data.txHash) {
                return NextResponse.json({ status: 'success', data: { bid_id: existingBid.id, txHash: data.txHash } });
            }
            return NextResponse.json({ status: 'error', error: { code: 'DUPLICATE_BID', message: 'This vendor already committed a bid on the RFQ.' } }, { status: 400 });
        }

        const bidId =
            data.bidId ??
            (data.txHash ? (await recoverCommitBidIdFromTxHash(data.rfqId, auth.walletAddress, data.txHash)) ?? randomField() : randomField());
        if (!data.txHash) {
            const userNonce = await nextActionNonce(auth.walletAddress, data.rfqId, ACTION_TAG.COMMIT);
            const idempotencyKey = `commit_bid_${bidId}`;
            const canonicalKey = canonicalActionKey(`nonce:${ACTION_TAG.COMMIT}`, auth.walletAddress, data.rfqId, bidId);
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: 'submit_bid_commit',
                inputs: [
                    data.rfqId,
                    `${data.bidAmount}u64`,
                    data.nonce,
                    `${data.stake}u64`,
                    bidId,
                    `${userNonce}u64`,
                    `${chain.minBid ?? rfq.minBid.toString()}u64`,
                ],
                fee: estimateFee('submit_bid_commit'),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({
                status: 'success',
                data: {
                    bid_id: bidId,
                    tx: {
                        idempotencyKey,
                        canonicalTxKey: canonicalKey,
                        request: buildWalletTxRequest(tx),
                    },
                },
            });
        }

        const existingByTx = await prisma.bid.findFirst({
            where: { createdTxId: data.txHash, createdEventIdx: 0 },
            select: { id: true },
        });
        if (existingByTx?.id) {
            return NextResponse.json({ status: 'success', data: { bid_id: existingByTx.id, txHash: data.txHash } });
        }

        const currentBlock = await getCurrentBlockHeight();
        await prisma.bid.create({
            data: {
                id: bidId,
                rfqId: data.rfqId,
                vendor: auth.walletAddress,
                commitmentHash: await commitmentHash(data.bidAmount, data.nonce),
                stake: data.stake,
                createdBlock: currentBlock,
                createdTxId: data.txHash,
                createdEventIdx: 0,
            },
        });

        return NextResponse.json({ status: 'success', data: { bid_id: bidId, txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleRevealBid(request: NextRequest, bidId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = RevealBidSchema.parse(await request.json());
        const bid = await prisma.bid.findUnique({ where: { id: bidId } });
        if (!bid || bid.vendor !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the bidder can reveal this bid.' } }, { status: 403 });
        }
        if (bid.isRevealed) {
            return NextResponse.json({ status: 'error', error: { code: 'ALREADY_REVEALED', message: 'Bid has already been revealed.' } }, { status: 400 });
        }

        const rfq = await prisma.rFQ.findUnique({ where: { id: bid.rfqId } });
        const chain = await getRfqChainState(bid.rfqId);
        const currentBlock = await getCurrentBlockHeight();
        if (!rfq) {
            return NextResponse.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } }, { status: 404 });
        }
        if (chain.pricingMode !== 0) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_MODE', message: 'Reveal is disabled for imported auction pricing modes.' } }, { status: 400 });
        }
        if (!chain.biddingDeadline || currentBlock < chain.biddingDeadline) {
            return NextResponse.json({ status: 'error', error: { code: 'BIDDING_STILL_OPEN', message: 'Reveal opens after the bidding deadline.' } }, { status: 400 });
        }
        if (chain.revealDeadline && currentBlock >= chain.revealDeadline) {
            return NextResponse.json({ status: 'error', error: { code: 'DEADLINE_PASSED', message: `Reveal deadline block ${chain.revealDeadline} has passed.` } }, { status: 400 });
        }
        if ((await commitmentHash(data.bidAmount, data.nonce)) !== bid.commitmentHash) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_PREIMAGE', message: 'Reveal values do not match the committed bid.' } }, { status: 400 });
        }

        if (!data.txHash) {
            const userNonce = await nextActionNonce(auth.walletAddress, bid.rfqId, ACTION_TAG.REVEAL);
            const idempotencyKey = `reveal_bid_${bidId}_${crypto.randomUUID()}`;
            const canonicalKey = canonicalActionKey(`nonce:${ACTION_TAG.REVEAL}`, auth.walletAddress, bid.rfqId, bidId);
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: 'reveal_bid',
                inputs: [bid.rfqId, bid.id, `${data.bidAmount}u64`, data.nonce, `${userNonce}u64`],
                fee: estimateFee('reveal_bid'),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({
                status: 'success',
                data: {
                    bid_id: bidId,
                    tx: {
                        idempotencyKey,
                        canonicalTxKey: canonicalKey,
                        request: buildWalletTxRequest(tx),
                    },
                },
            });
        }

        await prisma.$transaction([
            prisma.bid.update({
                where: { id: bidId },
                data: {
                    isRevealed: true,
                    revealedAmount: data.bidAmount,
                    revealedBlock: currentBlock,
                },
            }),
            prisma.rFQ.update({
                where: { id: bid.rfqId },
                data: { status: RFQ_STATUS.REVEAL },
            }),
        ]);

        return NextResponse.json({ status: 'success', data: { bid_id: bidId, txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleGetMyBids(request: NextRequest) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const bids = await prisma.bid.findMany({
        where: { vendor: auth.walletAddress },
        orderBy: { createdAt: 'desc' },
    });
    const rfqIds = Array.from(new Set(bids.map((bid) => bid.rfqId)));
    const rfqs = await prisma.rFQ.findMany({
        where: { id: { in: rfqIds } },
        select: {
            id: true,
            status: true,
            biddingDeadline: true,
            revealDeadline: true,
            tokenType: true,
            pricingMode: true,
            paid: true,
            winnerAccepted: true,
        },
    });
    const rfqById = new Map(rfqs.map((rfq) => [rfq.id, rfq]));

    const enriched = await Promise.all(
        bids.map(async (bid) => {
            const chain = await getRfqChainState(bid.rfqId);
            const rfq = rfqById.get(bid.rfqId);
            const onChainExists = chain.statusCode !== 0;
            return {
                ...serializeBid(bid),
                isWinner: onChainExists ? chain.winner === bid.vendor : bid.isWinner,
                rfqStatus: onChainExists ? chain.status : (rfq?.status ?? chain.status),
                revealDeadline: onChainExists ? chain.revealDeadline : (rfq?.revealDeadline ?? chain.revealDeadline),
                biddingDeadline: onChainExists ? chain.biddingDeadline : (rfq?.biddingDeadline ?? chain.biddingDeadline),
                tokenType: onChainExists ? chain.escrowToken : (rfq?.tokenType ?? chain.escrowToken),
                pricingMode: onChainExists ? chain.pricingMode : (rfq?.pricingMode ?? chain.pricingMode),
                paid: onChainExists ? chain.paid : Boolean(rfq?.paid),
                winnerAccepted: onChainExists ? chain.winnerAccepted : Boolean(rfq?.winnerAccepted),
            };
        }),
    );

    return NextResponse.json({ status: 'success', data: enriched });
}

export async function handleGetBid(request: NextRequest, bidId: string) {
    const auth = await requireRole(request, ['VENDOR', 'BUYER', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const bid = await prisma.bid.findUnique({ where: { id: bidId } });
    if (!bid) {
        return NextResponse.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'Bid not found' } }, { status: 404 });
    }

    if (auth.role !== 'AUDITOR') {
        const rfq = await prisma.rFQ.findUnique({ where: { id: bid.rfqId } });
        if (bid.vendor !== auth.walletAddress && rfq?.buyer !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Access denied' } }, { status: 403 });
        }
    }

    return NextResponse.json({ status: 'success', data: serializeBid(bid) });
}
