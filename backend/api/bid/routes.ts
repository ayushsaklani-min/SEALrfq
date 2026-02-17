import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireRole } from '../../auth/middleware';
import { TransactionTracker } from '../../tx/tracker';
import { getCurrentBlockHeight } from '../../aleo/executor';
import { z } from 'zod';
import crypto from 'crypto';
import type { AleoTransaction } from '../../../contracts/v1/client/result-types';

const prisma = new PrismaClient();
const tracker = new TransactionTracker(prisma);
const DEFAULT_PROGRAM_ID = process.env.ALEO_PROGRAM_ID || 'sealrfq_v1.aleo';
const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'testnet';
const IS_POC_PROGRAM = DEFAULT_PROGRAM_ID === 'sealrfq_poc.aleo';

function serializeBid(bid: any) {
    return {
        ...bid,
        stake: bid.stake?.toString(),
        revealedAmount: bid.revealedAmount?.toString() ?? null,
    };
}

async function prepareTrackedTransition(
    tx: AleoTransaction,
    idempotencyKey: string,
    canonicalKey: string,
): Promise<void> {
    await tracker.prepare(tx, canonicalKey, idempotencyKey);
}

function buildWalletTxRequest(tx: AleoTransaction) {
    return {
        program: tx.program,
        function: tx.function,
        inputs: tx.inputs,
        fee: tx.fee.toString(),
        network: DEFAULT_NETWORK,
    };
}

async function nextUserNonce(wallet: string, action: 'commit' | 'reveal'): Promise<number> {
    const transition = action === 'commit' ? 'submit_bid_commit' : 'reveal_bid';
    const confirmed = await prisma.transaction.count({
        where: {
            transition,
            status: 'CONFIRMED',
            canonicalTxKey: { contains: wallet },
        },
    });
    return confirmed + 1;
}

const CommitBidSchema = z.object({
    rfqId: z.string(),
    bidAmount: z.string().transform((s) => BigInt(s)),
    nonce: z.string().min(1),
    stake: z.string().transform((s) => BigInt(s)),
});

export async function handleCommitBid(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const body = await request.json();
        const data = CommitBidSchema.parse(body);
        const rfq = await prisma.rFQ.findUnique({ where: { id: data.rfqId } });

        if (!rfq) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        if (rfq.status !== 'OPEN') {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: `Cannot commit bid: RFQ is in ${rfq.status} state (expected OPEN)`,
                    },
                },
                { status: 400 },
            );
        }

        if (data.bidAmount < rfq.minBid) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_AMOUNT',
                        message: `Bid must be at least ${rfq.minBid.toString()}`,
                    },
                },
                { status: 400 },
            );
        }

        const existingBid = await prisma.bid.findFirst({
            where: { rfqId: data.rfqId, vendor: authResult.walletAddress },
        });
        if (existingBid) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'DUPLICATE_BID', message: 'Bid already exists for this RFQ' },
                },
                { status: 400 },
            );
        }

        const bidId = `${Date.now()}${crypto.randomInt(100, 999)}field`;
        const idempotencyKey = `commit_bid_${bidId}`;
        const canonicalKey = `commit_bid:${authResult.walletAddress}:${data.rfqId}`;
        const currentBlock = await getCurrentBlockHeight();
        const userNonce = await nextUserNonce(authResult.walletAddress, 'commit');

        const tx: AleoTransaction = {
            program: DEFAULT_PROGRAM_ID,
            function: 'submit_bid_commit',
            inputs: IS_POC_PROGRAM
                ? [data.rfqId, `${data.bidAmount}u64`, data.nonce, `${data.stake}u64`, bidId]
                : [
                      data.rfqId,
                      `${data.bidAmount}u64`,
                      data.nonce,
                      `${data.stake}u64`,
                      bidId,
                      `${currentBlock}u32`,
                      `${userNonce}u64`,
                  ],
            fee: BigInt(1_000_000),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
        const commitmentHash = crypto
            .createHash('sha256')
            .update(`${data.bidAmount.toString()}`)
            .digest('hex');

        await prisma.bid.create({
            data: {
                id: bidId,
                rfqId: data.rfqId,
                vendor: authResult.walletAddress,
                commitmentHash,
                stake: data.stake,
                createdBlock: currentBlock,
                createdTxId: `pending_${idempotencyKey}`,
                createdEventIdx: 0,
            },
        });

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
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } },
            { status: 400 },
        );
    }
}

const RevealBidSchema = z.object({
    bidAmount: z.string().transform((s) => BigInt(s)),
    nonce: z.string().min(1),
});

export async function handleRevealBid(
    request: NextRequest,
    bidId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const body = await request.json();
        const data = RevealBidSchema.parse(body);
        const bid = await prisma.bid.findUnique({ where: { id: bidId } });

        if (!bid) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'Bid not found' } },
                { status: 404 },
            );
        }

        if (bid.vendor !== authResult.walletAddress) {
            return NextResponse.json(
                { status: 'error', error: { code: 'FORBIDDEN', message: 'Not your bid' } },
                { status: 403 },
            );
        }

        if (bid.isRevealed) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'ALREADY_REVEALED', message: 'Bid has already been revealed' },
                },
                { status: 400 },
            );
        }

        const rfq = await prisma.rFQ.findUnique({ where: { id: bid.rfqId } });
        if (!rfq) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        if (rfq.status !== 'CLOSED') {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: `Cannot reveal bid: RFQ is in ${rfq.status} state (expected CLOSED)`,
                    },
                },
                { status: 400 },
            );
        }

        const idempotencyKey = `reveal_bid_${bidId}_${crypto.randomUUID()}`;
        const canonicalKey = `reveal_bid:${authResult.walletAddress}:${bidId}`;
        const currentBlock = await getCurrentBlockHeight();
        const userNonce = await nextUserNonce(authResult.walletAddress, 'reveal');
        const tx: AleoTransaction = {
            program: DEFAULT_PROGRAM_ID,
            function: 'reveal_bid',
            inputs: IS_POC_PROGRAM
                ? [bid.rfqId, bidId, `${data.bidAmount}u64`, data.nonce]
                : [
                      bid.rfqId,
                      bidId,
                      `${data.bidAmount}u64`,
                      data.nonce,
                      `${currentBlock}u32`,
                      `${userNonce}u64`,
                  ],
            fee: BigInt(1_000_000),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);

        await prisma.bid.update({
            where: { id: bidId },
            data: {
                isRevealed: true,
                revealedAmount: data.bidAmount,
                revealedBlock: currentBlock,
                updatedAt: new Date(),
            },
        });

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
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } },
            { status: 400 },
        );
    }
}

export async function handleGetMyBids(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const bids = await prisma.bid.findMany({
            where: { vendor: authResult.walletAddress },
            orderBy: { createdAt: 'desc' },
        });

        const rfqIds = Array.from(new Set(bids.map((b) => b.rfqId)));
        const rfqs = await prisma.rFQ.findMany({
            where: { id: { in: rfqIds } },
            select: { id: true, status: true, revealDeadline: true },
        });
        const rfqById = new Map(rfqs.map((r) => [r.id, r]));

        const enriched = bids.map((bid) => {
            const rfq = rfqById.get(bid.rfqId);
            return {
                ...serializeBid(bid),
                rfqStatus: rfq?.status ?? null,
                revealDeadline: rfq?.revealDeadline ?? null,
            };
        });

        return NextResponse.json({ status: 'success', data: enriched });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}

export async function handleGetBid(
    request: NextRequest,
    bidId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['VENDOR', 'BUYER', 'AUDITOR', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const bid = await prisma.bid.findUnique({ where: { id: bidId } });
        if (!bid) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'Bid not found' } },
                { status: 404 },
            );
        }

        if (authResult.role !== 'AUDITOR') {
            const rfq = await prisma.rFQ.findUnique({ where: { id: bid.rfqId } });
            if (bid.vendor !== authResult.walletAddress && rfq?.buyer !== authResult.walletAddress) {
                return NextResponse.json(
                    { status: 'error', error: { code: 'FORBIDDEN', message: 'Access denied' } },
                    { status: 403 },
                );
            }
        }

        return NextResponse.json({ status: 'success', data: serializeBid(bid) });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}
