import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireRole } from '../../auth/middleware';
import { TransactionTracker } from '../../tx/tracker';
import { getCurrentBlockHeight } from '../../aleo/executor';
import { getWinnerAcceptedState } from '../../aleo/chainState';
import { estimateFee } from '../../aleo/fees';
import { materializeEscrowFromConfirmedFunding } from '../../lib/escrowState';
import { z } from 'zod';
import crypto from 'crypto';
import type { AleoTransaction } from '../../lib/types';

const prisma = new PrismaClient();
const tracker = new TransactionTracker(prisma);
const DEFAULT_PROGRAM_ID = process.env.ALEO_PROGRAM_ID || 'sealrfq_v5.aleo';
const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'testnet';
const IS_POC_PROGRAM = DEFAULT_PROGRAM_ID === 'sealrfq_poc.aleo';
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const MAX_RFQ_DURATION = 100_000;
const APPROX_BLOCK_TIME_MS = Number(process.env.ALEO_APPROX_BLOCK_TIME_MS || '5000');

const CreateRFQSchema = z.object({
    biddingDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    minBid: z.string().transform((s) => BigInt(s)),
    minBidCount: z.number().int().positive().optional(),
    metadataHash: z.string().optional(),
    // Product detail fields (stored off-chain)
    itemName: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    quantity: z.string().max(50).optional(),
    unit: z.string().max(50).optional(),
    // Frontend-provided after wallet tx succeeds
    rfqId: z.string().optional(),
    txHash: z.string().optional(),
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
        network: DEMO_MODE ? 'demo' : DEFAULT_NETWORK,
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

async function getWinningBidSummary(rfqId: string) {
    return prisma.bid.findFirst({
        where: { rfqId, isWinner: true },
        select: {
            id: true,
            vendor: true,
            revealedAmount: true,
        },
    });
}

async function getWinnerAcceptedStateSafe(rfq: { id: string; status: string }): Promise<boolean | null> {
    if (!['WINNER_SELECTED', 'ESCROW_FUNDED', 'COMPLETED'].includes(rfq.status)) {
        return null;
    }

    try {
        return await getWinnerAcceptedState(rfq.id);
    } catch {
        return null;
    }
}

async function serializeRFQWithComputedState(rfq: any) {
    const winningBid = await getWinningBidSummary(rfq.id);
    const winnerAccepted = await getWinnerAcceptedStateSafe(rfq);

    return {
        ...serializeRFQ(rfq),
        winningBidId: winningBid?.id ?? null,
        winningBidAmount: winningBid?.revealedAmount?.toString() ?? null,
        winningVendor: winningBid?.vendor ?? null,
        winnerAccepted,
        estimatedFundEscrowFee: estimateFee('fund_escrow').toString(),
    };
}

async function healStalePendingWinnerSelection(rfqId: string): Promise<void> {
    const tracked = await prisma.transaction.findFirst({
        where: { canonicalTxKey: `select_winner:${rfqId}` },
        orderBy: { preparedAt: 'desc' },
        select: { status: true },
    });
    if (!tracked || !['REJECTED', 'EXPIRED'].includes(tracked.status)) {
        return;
    }

    const rfq = await prisma.rFQ.findUnique({
        where: { id: rfqId },
        select: { status: true },
    });
    if (!rfq || rfq.status !== 'WINNER_SELECTED') {
        return;
    }

    const escrow = await prisma.escrow.findUnique({
        where: { rfqId },
        select: { id: true },
    });
    if (escrow) {
        return;
    }

    await prisma.$transaction([
        prisma.bid.updateMany({
            where: { rfqId, isWinner: true },
            data: { isWinner: false },
        }),
        prisma.rFQ.update({
            where: { id: rfqId },
            data: { status: 'CLOSED', updatedAt: new Date() },
        }),
    ]);
}

async function healStalePendingEscrowState(rfqId: string): Promise<void> {
    const escrow = await prisma.escrow.findUnique({
        where: { rfqId },
        select: { fundedTxId: true },
    });
    if (!escrow?.fundedTxId?.startsWith('pending_')) {
        return;
    }

    const idempotencyKey = escrow.fundedTxId.substring('pending_'.length);
    const tracked = await prisma.transaction.findUnique({
        where: { idempotencyKey },
        select: { status: true },
    });
    if (!tracked || !['REJECTED', 'EXPIRED'].includes(tracked.status)) {
        return;
    }

    await prisma.$transaction([
        prisma.escrow.delete({ where: { rfqId } }),
        prisma.rFQ.update({
            where: { id: rfqId },
            data: { status: 'WINNER_SELECTED', updatedAt: new Date() },
        }),
    ]);
}

function normalizeDeadlineToBlockHeight(value: number, currentBlock: number): number {
    if (DEMO_MODE) {
        return value;
    }

    if (value > currentBlock && value <= currentBlock + MAX_RFQ_DURATION) {
        return value;
    }

    const targetMs =
        value >= 1_000_000_000_000
            ? value
            : value >= 1_000_000_000
              ? value * 1000
              : null;

    if (targetMs === null) {
        return value;
    }

    const blockOffset = Math.ceil((targetMs - Date.now()) / APPROX_BLOCK_TIME_MS);
    return currentBlock + blockOffset;
}

export async function handleCreateRFQ(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const body = await request.json();
        const data = CreateRFQSchema.parse(body);
        const currentBlock = DEMO_MODE ? Math.floor(Date.now() / 1000) : await getCurrentBlockHeight();
        const biddingDeadline = normalizeDeadlineToBlockHeight(data.biddingDeadline, currentBlock);
        const revealDeadline = normalizeDeadlineToBlockHeight(data.revealDeadline, currentBlock);

        if (biddingDeadline <= currentBlock) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_DEADLINE',
                        message: DEMO_MODE
                            ? `Bidding deadline must be in the future (current timestamp ${currentBlock})`
                            : `Bidding deadline must be greater than current block (${currentBlock})`,
                    },
                },
                { status: 400 },
            );
        }
        if (revealDeadline <= biddingDeadline) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_DEADLINE',
                        message: 'Reveal deadline must be after bidding deadline',
                    },
                },
                { status: 400 },
            );
        }
        if (!DEMO_MODE && (biddingDeadline > currentBlock + MAX_RFQ_DURATION || revealDeadline > currentBlock + MAX_RFQ_DURATION)) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_DEADLINE',
                        message: `Deadlines must be within ${MAX_RFQ_DURATION} blocks of the current block (${currentBlock})`,
                    },
                },
                { status: 400 },
            );
        }
        // If frontend already executed the wallet tx, use its rfqId and txHash
        const rfqId = data.rfqId || `${Date.now()}field`;
        const txHash = data.txHash || null;

        if (!txHash) {
            // Prepare phase: validate, construct tx, track — but do NOT create RFQ record
            const idempotencyKey = `create_rfq_${rfqId}_${crypto.randomUUID()}`;
            const canonicalKey = `create_rfq:${rfqId}`;

            const tx: AleoTransaction = {
                program: DEFAULT_PROGRAM_ID,
                function: 'create_rfq',
                inputs: IS_POC_PROGRAM
                    ? [
                          rfqId,
                          `${biddingDeadline}u32`,
                          `${revealDeadline}u32`,
                          `${data.minBid}u64`,
                      ]
                    : [
                          rfqId,
                          `${biddingDeadline}u32`,
                          `${revealDeadline}u32`,
                          `${data.minBid}u64`,
                          `${data.minBidCount ?? 1}u64`,
                          data.metadataHash || `${Date.now()}field`,
                      ],
                fee: estimateFee('create_rfq'),
            };

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

        // New flow: wallet tx already succeeded, just persist the RFQ
        await prisma.rFQ.create({
            data: {
                id: rfqId,
                buyer: authResult.walletAddress,
                biddingDeadline,
                revealDeadline,
                minBid: data.minBid,
                status: 'OPEN',
                createdBlock: currentBlock,
                createdTxId: txHash,
                createdEventIdx: 0,
                itemName: data.itemName ?? null,
                description: data.description ?? null,
                quantity: data.quantity ?? null,
                unit: data.unit ?? null,
                metadataHash: data.metadataHash ?? null,
            },
        });

        return NextResponse.json({
            status: 'success',
            data: {
                rfq_id: rfqId,
                txHash,
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

        const currentBlock = DEMO_MODE ? Math.floor(Date.now() / 1000) : await getCurrentBlockHeight();
        if (!DEMO_MODE && currentBlock < rfq.biddingDeadline) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: `Cannot close bidding before bidding deadline block ${rfq.biddingDeadline} (current block ${currentBlock})`,
                    },
                },
                { status: 400 },
            );
        }

        const body = await request.json().catch(() => ({}));
        const txHash = typeof body?.txHash === 'string' ? body.txHash : null;

        if (txHash) {
            // Confirm phase: wallet tx already succeeded, update RFQ status
            await prisma.rFQ.update({
                where: { id: rfqId },
                data: { status: 'CLOSED', updatedAt: new Date() },
            });

            return NextResponse.json({
                status: 'success',
                data: { rfq_id: rfqId, txHash },
            });
        }

        // Prepare phase: validate, construct tx, track — but do NOT update RFQ status
        const idempotencyKey = `close_bidding_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = `close_bidding:${rfqId}`;
        const tx: AleoTransaction = {
            program: DEFAULT_PROGRAM_ID,
            function: 'close_bidding',
            inputs: [rfqId],
            fee: estimateFee('close_bidding'),
        };

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
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}

const SelectWinnerSchema = z.object({
    winningBidId: z.string(),
    txHash: z.string().optional(),
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
        const data = SelectWinnerSchema.parse(body);
        const { winningBidId } = data;
        await healStalePendingWinnerSelection(rfqId);
        let rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });

        if (!rfq) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        if (rfq.buyer !== authResult.walletAddress) {
            return NextResponse.json(
                { status: 'error', error: { code: 'FORBIDDEN', message: 'Only the RFQ buyer can select a winner' } },
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

        const currentBlock = DEMO_MODE ? Math.floor(Date.now() / 1000) : await getCurrentBlockHeight();
        if (!DEMO_MODE && currentBlock < rfq.revealDeadline) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: `Cannot select winner before reveal deadline block ${rfq.revealDeadline} (current block ${currentBlock})`,
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

        if (data.txHash) {
            // Confirm phase: wallet tx already succeeded, update bid/RFQ records
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
                data: { rfq_id: rfqId, winning_bid_id: winningBidId, txHash: data.txHash },
            });
        }

        // Prepare phase: validate, construct tx, track — but do NOT update records
        const idempotencyKey = `select_winner_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = `select_winner:${rfqId}`;
        const tx: AleoTransaction = {
            program: DEFAULT_PROGRAM_ID,
            function: 'select_winner',
            inputs: [
                rfqId,
                winningBidId,
                `${bid.revealedAmount}u64`,
                bid.vendor,
            ],
            fee: estimateFee('select_winner'),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);

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

export async function handleCancelRFQ(
    request: NextRequest,
    rfqId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'VENDOR']);
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

        if (rfq.status !== 'OPEN') {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: `Cannot cancel RFQ: RFQ is in ${rfq.status} state (expected OPEN)`,
                    },
                },
                { status: 400 },
            );
        }

        const currentBlock = DEMO_MODE ? Math.floor(Date.now() / 1000) : await getCurrentBlockHeight();
        const idempotencyKey = `cancel_rfq_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = `cancel_rfq:${rfqId}`;

        let tx: AleoTransaction;
        if (authResult.walletAddress === rfq.buyer) {
            tx = {
                program: DEFAULT_PROGRAM_ID,
                function: 'cancel_rfq',
                inputs: [rfqId],
                fee: estimateFee('cancel_rfq'),
            };
        } else {
            if (!DEMO_MODE && currentBlock < rfq.biddingDeadline) {
                return NextResponse.json(
                    {
                        status: 'error',
                        error: {
                            code: 'FORBIDDEN',
                            message: 'Only the RFQ buyer can cancel before the bidding deadline',
                        },
                    },
                    { status: 403 },
                );
            }

            tx = {
                program: DEFAULT_PROGRAM_ID,
                function: 'cancel_rfq_insufficient_bids',
                inputs: [rfqId, rfq.buyer],
                fee: estimateFee('cancel_rfq_insufficient_bids'),
            };
        }

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
        await prisma.rFQ.update({
            where: { id: rfqId },
            data: { status: 'CANCELLED', updatedAt: new Date() },
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

export async function handleWinnerAccept(
    request: NextRequest,
    rfqId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['VENDOR', 'NEW_USER']);
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

        if (rfq.status !== 'WINNER_SELECTED') {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: `Cannot accept winner selection: RFQ is in ${rfq.status} state (expected WINNER_SELECTED)`,
                    },
                },
                { status: 400 },
            );
        }

        const winningBid = await getWinningBidSummary(rfqId);
        if (!winningBid) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'INVALID_STATE', message: 'No winning bid is recorded for this RFQ' },
                },
                { status: 400 },
            );
        }

        if (winningBid.vendor !== authResult.walletAddress) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'FORBIDDEN',
                        message: 'Only the selected vendor can accept this RFQ award',
                    },
                },
                { status: 403 },
            );
        }

        const alreadyAccepted = await getWinnerAcceptedStateSafe(rfq);
        if (alreadyAccepted === true) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'ALREADY_ACCEPTED',
                        message: 'The winner has already accepted this RFQ',
                    },
                },
                { status: 400 },
            );
        }

        const canonicalKey = `winner_accept:${authResult.walletAddress}:${rfqId}`;
        const existingAttempt = await prisma.transaction.findFirst({
            where: {
                canonicalTxKey: canonicalKey,
                status: { in: ['PREPARED', 'SUBMITTED', 'CONFIRMED'] },
            },
            orderBy: { preparedAt: 'desc' },
        });
        if (existingAttempt) {
            const message =
                existingAttempt.status === 'CONFIRMED'
                    ? 'Winner acceptance is already confirmed. Refresh the RFQ status.'
                    : 'Winner acceptance is already in progress';
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code:
                            existingAttempt.status === 'CONFIRMED'
                                ? 'ALREADY_ACCEPTED'
                                : 'ACCEPTANCE_IN_PROGRESS',
                        message,
                    },
                },
                { status: existingAttempt.status === 'CONFIRMED' ? 400 : 409 },
            );
        }

        const body = await request.json().catch(() => ({}));
        const txHash = typeof body?.txHash === 'string' ? body.txHash : null;

        if (txHash) {
            // Confirm phase: wallet tx already succeeded
            return NextResponse.json({
                status: 'success',
                data: { rfq_id: rfqId, txHash },
            });
        }

        // Prepare phase: validate, construct tx, track
        const idempotencyKey = `winner_accept_${rfqId}_${crypto.randomUUID()}`;
        const tx: AleoTransaction = {
            program: DEFAULT_PROGRAM_ID,
            function: 'winner_accept',
            inputs: [rfqId],
            fee: estimateFee('winner_accept'),
        };

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
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}

const FundEscrowSchema = z.object({
    amount: z.string().transform((s) => BigInt(s)),
    txHash: z.string().optional(),
});

export async function handleFundEscrow(
    request: NextRequest,
    rfqId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const body = await request.json();
        const data = FundEscrowSchema.parse(body);
        const { amount } = data;
        await healStalePendingWinnerSelection(rfqId);
        let rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });

        if (!rfq) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        await healStalePendingEscrowState(rfqId);
        await materializeEscrowFromConfirmedFunding(prisma, rfqId);
        rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });
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

        const existingEscrow = await prisma.escrow.findUnique({ where: { rfqId } });
        if (existingEscrow) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'ALREADY_FUNDED', message: 'Escrow has already been funded' },
                },
                { status: 400 },
            );
        }

        const canonicalKey = `fund_escrow:${rfqId}`;
        const existingAttempt = await prisma.transaction.findFirst({
            where: {
                canonicalTxKey: canonicalKey,
                status: { in: ['PREPARED', 'SUBMITTED', 'CONFIRMED'] },
            },
            orderBy: { preparedAt: 'desc' },
        });
        if (existingAttempt) {
            const message =
                existingAttempt.status === 'CONFIRMED'
                    ? 'Escrow funding is already confirmed. Refresh the escrow view.'
                    : 'Escrow funding is already in progress';
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code:
                            existingAttempt.status === 'CONFIRMED'
                                ? 'ALREADY_FUNDED'
                                : 'FUNDING_IN_PROGRESS',
                        message,
                    },
                },
                { status: existingAttempt.status === 'CONFIRMED' ? 400 : 409 },
            );
        }

        const winningBid = await getWinningBidSummary(rfqId);
        if (winningBid?.revealedAmount && amount !== winningBid.revealedAmount) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_AMOUNT',
                        message: `Escrow amount must equal winning bid amount ${winningBid.revealedAmount.toString()}`,
                    },
                },
                { status: 400 },
            );
        }

        const winnerAccepted = await getWinnerAcceptedState(rfqId);
        if (winnerAccepted === null) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'ALEO_STATE_UNAVAILABLE',
                        message: 'Could not verify winner acceptance from the Aleo network. Try again shortly.',
                    },
                },
                { status: 503 },
            );
        }
        if (winnerAccepted !== true) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'WINNER_NOT_ACCEPTED',
                        message: 'The selected vendor must accept the award before you can fund escrow',
                    },
                },
                { status: 400 },
            );
        }

        if (data.txHash) {
            // Confirm phase: wallet tx already succeeded
            return NextResponse.json({
                status: 'success',
                data: { rfq_id: rfqId, txHash: data.txHash },
            });
        }

        // Prepare phase: validate, construct tx, track
        const idempotencyKey = `fund_escrow_${rfqId}_${crypto.randomUUID()}`;
        const tx: AleoTransaction = {
            program: DEFAULT_PROGRAM_ID,
            function: 'fund_escrow',
            inputs: [rfqId, `${amount}u64`],
            fee: estimateFee('fund_escrow'),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);

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
        await healStalePendingWinnerSelection(rfqId);
        let rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });
        if (!rfq) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        await healStalePendingEscrowState(rfqId);
        rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });
        if (!rfq) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } },
                { status: 404 },
            );
        }

        return NextResponse.json({
            status: 'success',
            data: await serializeRFQWithComputedState(rfq),
        });
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

export async function handleListOpenRFQs(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const rfqs = await prisma.rFQ.findMany({
            where: { status: 'OPEN' },
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
