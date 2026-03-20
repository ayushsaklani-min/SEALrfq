import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '../../auth/middleware';
import {
    augmentRFQ,
    CreateRFQSchema,
    createTransitionInputs,
    getCurrentBlockHeight,
    getPlatformConfig,
    prepareTrackedTransition,
    prisma,
    RFQ_STATUS,
    serializeBid,
    TIMING,
    buildWalletTxRequest,
} from './common';
import crypto from 'crypto';

export async function handleCreateRFQ(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = CreateRFQSchema.parse(await request.json());
        const { rfqId, tx } = await createTransitionInputs(data, auth.walletAddress);

        if (!data.txHash) {
            // Prepare path: validate platform state and deadlines before
            // returning the wallet transaction request.
            const currentBlock = await getCurrentBlockHeight();
            const platform = await getPlatformConfig(true);

            if (!platform.initialized) {
                return NextResponse.json(
                    {
                        status: 'error',
                        error: { code: 'PLATFORM_NOT_INITIALIZED', message: 'Platform config must be initialized before creating RFQs.' },
                    },
                    { status: 412 },
                );
            }
            if (platform.paused) {
                return NextResponse.json(
                    {
                        status: 'error',
                        error: { code: 'PLATFORM_PAUSED', message: 'The platform is paused. New RFQs are currently disabled.' },
                    },
                    { status: 423 },
                );
            }
            if (data.biddingDeadline <= currentBlock || data.biddingDeadline > currentBlock + TIMING.MAX_RFQ_DURATION) {
                return NextResponse.json(
                    {
                        status: 'error',
                        error: {
                            code: 'INVALID_DEADLINE',
                            message: `Bidding deadline must be greater than current block ${currentBlock} and within ${TIMING.MAX_RFQ_DURATION} blocks.`,
                        },
                    },
                    { status: 400 },
                );
            }
            if (data.revealDeadline <= data.biddingDeadline || data.revealDeadline - data.biddingDeadline < TIMING.MIN_REVEAL_WINDOW) {
                return NextResponse.json(
                    {
                        status: 'error',
                        error: {
                            code: 'INVALID_DEADLINE',
                            message: `Reveal deadline must be at least ${TIMING.MIN_REVEAL_WINDOW} blocks after bidding closes.`,
                        },
                    },
                    { status: 400 },
                );
            }

            const idempotencyKey = `create_rfq_${rfqId}_${crypto.randomUUID()}`;
            const canonicalKey = `create_rfq:${rfqId}`;
            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);

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
        }

        // Confirm path: the on-chain contract already enforced all guards
        // (platform init, deadlines, paused state). Just record in the local DB.
        const currentBlock = await getCurrentBlockHeight();
        const existing = await prisma.rFQ.findUnique({ where: { id: rfqId } });
        if (!existing) {
            await prisma.rFQ.create({
                data: {
                    id: rfqId,
                    buyer: auth.walletAddress,
                    biddingDeadline: data.biddingDeadline,
                    revealDeadline: data.revealDeadline,
                    minBid: data.minBid,
                    status: RFQ_STATUS.OPEN,
                    tokenType: data.tokenType,
                    pricingMode: data.pricingMode,
                    auctionSource: null,
                    winnerAccepted: false,
                    paid: false,
                    receiptHash: null,
                    createdBlock: currentBlock,
                    createdTxId: data.txHash,
                    createdEventIdx: 0,
                    itemName: data.itemName ?? null,
                    description: data.description ?? null,
                    quantity: data.quantity ?? null,
                    unit: data.unit ?? null,
                    metadataHash: data.metadataHash,
                },
            });
        } else {
            await prisma.rFQ.update({
                where: { id: rfqId },
                data: {
                    biddingDeadline: data.biddingDeadline,
                    revealDeadline: data.revealDeadline,
                    minBid: data.minBid,
                    tokenType: data.tokenType,
                    pricingMode: data.pricingMode,
                    itemName: data.itemName ?? null,
                    description: data.description ?? null,
                    quantity: data.quantity ?? null,
                    unit: data.unit ?? null,
                    metadataHash: data.metadataHash,
                },
            });
        }

        return NextResponse.json({
            status: 'success',
            data: {
                rfq_id: rfqId,
                txHash: data.txHash,
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } },
            { status: 400 },
        );
    }
}

export async function handleGetRFQ(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });
    if (!rfq) {
        return NextResponse.json(
            { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
            { status: 404 },
        );
    }

    return NextResponse.json({
        status: 'success',
        data: await augmentRFQ(rfq),
    });
}

export async function handleGetBids(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const bids = await prisma.bid.findMany({
        where: { rfqId },
        orderBy: [{ isWinner: 'desc' }, { revealedAmount: 'asc' }],
    });

    return NextResponse.json({
        status: 'success',
        data: bids.map(serializeBid),
    });
}

export async function handleGetMyRFQs(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const rfqs = await prisma.rFQ.findMany({
        where: { buyer: auth.walletAddress },
        orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
        status: 'success',
        data: await Promise.all(rfqs.map((rfq) => augmentRFQ(rfq))),
    });
}

export async function handleListOpenRFQs(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const rfqs = await prisma.rFQ.findMany({
        where: { status: { in: [RFQ_STATUS.OPEN, RFQ_STATUS.REVEAL] } },
        orderBy: { createdAt: 'desc' },
    });

    const enriched = await Promise.all(rfqs.map((rfq) => augmentRFQ(rfq)));
    return NextResponse.json({
        status: 'success',
        data: enriched.filter((rfq) => rfq.status === RFQ_STATUS.OPEN || rfq.status === RFQ_STATUS.REVEAL),
    });
}
