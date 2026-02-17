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

const CreateRFQSchema = z.object({
    biddingDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    minBid: z.string().transform((s) => BigInt(s)),
}).refine((data) => data.biddingDeadline < data.revealDeadline, {
    message: 'Bidding deadline must be before reveal deadline',
});

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

function serializeRFQ(rfq: any) {
    return {
        ...rfq,
        minBid: rfq.minBid?.toString(),
    };
}

function serializeBid(bid: any) {
    return {
        ...bid,
        stake: bid.stake?.toString(),
        revealedAmount: bid.revealedAmount?.toString() ?? null,
    };
}

export async function handleCreateRFQ(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const body = await request.json();
        const data = CreateRFQSchema.parse(body);
        const currentBlock = await getCurrentBlockHeight();
        const rfqId = `${Date.now()}field`;
        const idempotencyKey = `create_rfq_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = `create_rfq:${rfqId}`;

        const tx: AleoTransaction = {
            program: DEFAULT_PROGRAM_ID,
            function: 'create_rfq',
            inputs: IS_POC_PROGRAM
                ? [
                      rfqId,
                      `${data.biddingDeadline}u32`,
                      `${data.revealDeadline}u32`,
                      `${data.minBid}u64`,
                  ]
                : [
                      rfqId,
                      `${data.biddingDeadline}u32`,
                      `${data.revealDeadline}u32`,
                      `${data.minBid}u64`,
                      `${currentBlock}u32`,
                  ],
            fee: BigInt(1_000_000),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);

        await prisma.rFQ.create({
            data: {
                id: rfqId,
                buyer: authResult.walletAddress,
                biddingDeadline: data.biddingDeadline,
                revealDeadline: data.revealDeadline,
                minBid: data.minBid,
                status: 'OPEN',
                createdBlock: currentBlock,
                createdTxId: `pending_${idempotencyKey}`,
                createdEventIdx: 0,
            },
        });

        return NextResponse.json({
            status: 'success',
            data: {
                rfq_id: rfqId,
                tx: {
                    idempotencyKey,
                    canonicalTxKey: canonicalKey,
                    request: buildWalletTxRequest(tx),
                },
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                status: 'error',
                error: { code: 'VALIDATION_ERROR', message: error.message },
            },
            { status: 400 },
        );
    }
}

export async function handleCloseBidding(
    request: NextRequest,
    rfqId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });
        if (!rfq) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        if (rfq.buyer !== authResult.walletAddress) {
            return NextResponse.json(
                { status: 'error', error: { code: 'FORBIDDEN', message: 'Not the RFQ buyer' } },
                { status: 403 },
            );
        }

        if (rfq.status !== 'OPEN') {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: `Cannot close bidding: RFQ is in ${rfq.status} state (expected OPEN)`,
                    },
                },
                { status: 400 },
            );
        }

        const currentBlock = await getCurrentBlockHeight();
        const idempotencyKey = `close_bidding_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = `close_bidding:${rfqId}`;
        const tx: AleoTransaction = {
            program: DEFAULT_PROGRAM_ID,
            function: 'close_bidding',
            inputs: IS_POC_PROGRAM ? [rfqId] : [rfqId, `${currentBlock}u32`],
            fee: BigInt(1_000_000),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
        await prisma.rFQ.update({
            where: { id: rfqId },
            data: { status: 'CLOSED', updatedAt: new Date() },
        });

        return NextResponse.json({
            status: 'success',
            data: {
                rfq_id: rfqId,
                tx: {
                    idempotencyKey,
                    canonicalTxKey: canonicalKey,
                    request: buildWalletTxRequest(tx),
                },
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}

const SelectWinnerSchema = z.object({
    winningBidId: z.string(),
});

export async function handleSelectWinner(
    request: NextRequest,
    rfqId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const body = await request.json();
        const { winningBidId } = SelectWinnerSchema.parse(body);
        const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });

        if (!rfq) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        if (rfq.buyer !== authResult.walletAddress) {
            return NextResponse.json(
                { status: 'error', error: { code: 'FORBIDDEN', message: 'Not the RFQ buyer' } },
                { status: 403 },
            );
        }

        if (rfq.status !== 'CLOSED') {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: `Cannot select winner: RFQ is in ${rfq.status} state (expected CLOSED)`,
                    },
                },
                { status: 400 },
            );
        }

        const bid = await prisma.bid.findUnique({ where: { id: winningBidId } });
        if (!bid || bid.rfqId !== rfqId || !bid.isRevealed) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'INVALID_BID', message: 'Bid not revealed or not in this RFQ' },
                },
                { status: 400 },
            );
        }

        const currentBlock = await getCurrentBlockHeight();
        const idempotencyKey = `select_winner_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = `select_winner:${rfqId}`;
        const tx: AleoTransaction = {
            program: DEFAULT_PROGRAM_ID,
            function: 'select_winner',
            inputs: IS_POC_PROGRAM
                ? [rfqId, winningBidId]
                : [rfqId, winningBidId, `${currentBlock}u32`],
            fee: BigInt(1_000_000),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);

        await prisma.$transaction([
            prisma.bid.updateMany({
                where: { rfqId },
                data: { isWinner: false },
            }),
            prisma.bid.update({
                where: { id: winningBidId },
                data: { isWinner: true },
            }),
            prisma.rFQ.update({
                where: { id: rfqId },
                data: { status: 'WINNER_SELECTED', updatedAt: new Date() },
            }),
        ]);

        return NextResponse.json({
            status: 'success',
            data: {
                rfq_id: rfqId,
                winning_bid_id: winningBidId,
                tx: {
                    idempotencyKey,
                    canonicalTxKey: canonicalKey,
                    request: buildWalletTxRequest(tx),
                },
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}

const FundEscrowSchema = z.object({
    amount: z.string().transform((s) => BigInt(s)),
});

export async function handleFundEscrow(
    request: NextRequest,
    rfqId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const body = await request.json();
        const { amount } = FundEscrowSchema.parse(body);
        const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });

        if (!rfq) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        if (rfq.buyer !== authResult.walletAddress) {
            return NextResponse.json(
                { status: 'error', error: { code: 'FORBIDDEN', message: 'Not the RFQ buyer' } },
                { status: 403 },
            );
        }

        if (rfq.status !== 'WINNER_SELECTED') {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: `Cannot fund escrow: RFQ is in ${rfq.status} state (expected WINNER_SELECTED)`,
                    },
                },
                { status: 400 },
            );
        }

        const winningBid = await prisma.bid.findFirst({ where: { rfqId, isWinner: true } });
        if (winningBid?.revealedAmount && amount < winningBid.revealedAmount) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_AMOUNT',
                        message: `Escrow amount must be >= ${winningBid.revealedAmount.toString()}`,
                    },
                },
                { status: 400 },
            );
        }

        const currentBlock = await getCurrentBlockHeight();
        const idempotencyKey = `fund_escrow_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = `fund_escrow:${rfqId}`;
        const tx: AleoTransaction = {
            program: DEFAULT_PROGRAM_ID,
            function: 'fund_escrow',
            inputs: IS_POC_PROGRAM ? [rfqId, `${amount}u64`] : [rfqId, `${amount}u64`, `${currentBlock}u32`],
            fee: BigInt(1_000_000),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);

        await prisma.$transaction([
            prisma.escrow.upsert({
                where: { rfqId },
                update: {
                    totalAmount: amount,
                    fundedBlock: currentBlock,
                    fundedTxId: `pending_${idempotencyKey}`,
                    fundedEventIdx: 0,
                },
                create: {
                    rfqId,
                    totalAmount: amount,
                    releasedAmount: BigInt(0),
                    isFinal: false,
                    fundedBlock: currentBlock,
                    fundedTxId: `pending_${idempotencyKey}`,
                    fundedEventIdx: 0,
                },
            }),
            prisma.rFQ.update({
                where: { id: rfqId },
                data: { status: 'ESCROW_FUNDED', updatedAt: new Date() },
            }),
        ]);

        return NextResponse.json({
            status: 'success',
            data: {
                rfq_id: rfqId,
                amount: amount.toString(),
                tx: {
                    idempotencyKey,
                    canonicalTxKey: canonicalKey,
                    request: buildWalletTxRequest(tx),
                },
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}

export async function handleGetRFQ(
    request: NextRequest,
    rfqId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });
        if (!rfq) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        return NextResponse.json({ status: 'success', data: serializeRFQ(rfq) });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}

export async function handleGetBids(
    request: NextRequest,
    rfqId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'AUDITOR', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const bids = await prisma.bid.findMany({
            where: { rfqId },
            orderBy: { revealedAmount: 'asc' },
        });

        return NextResponse.json({
            status: 'success',
            data: bids.map(serializeBid),
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}

export async function handleGetMyRFQs(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const rfqs = await prisma.rFQ.findMany({
            where: { buyer: authResult.walletAddress },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json({
            status: 'success',
            data: rfqs.map(serializeRFQ),
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}
