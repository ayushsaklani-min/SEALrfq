import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { requireRole } from '../../auth/middleware';
import { TransactionTracker } from '../../tx/tracker';
import { getWinnerAcceptedState } from '../../aleo/chainState';
import { getCurrentBlockHeight } from '../../aleo/executor';
import { estimateFee } from '../../aleo/fees';
import { z } from 'zod';
import crypto from 'crypto';
import type { AleoTransaction } from '../../lib/types';

const prisma = new PrismaClient();
const tracker = new TransactionTracker(prisma);
const DEFAULT_PROGRAM_ID = process.env.ALEO_PROGRAM_ID || 'sealrfq_v5.aleo';
const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'testnet';
const IS_POC_PROGRAM = DEFAULT_PROGRAM_ID === 'sealrfq_poc.aleo';
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const MIN_STAKE_PERCENTAGE = 10n;

function computeFlatStake(minBid: bigint): bigint {
    return (minBid * MIN_STAKE_PERCENTAGE) / 100n;
}

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
        network: DEMO_MODE ? 'demo' : DEFAULT_NETWORK,
    };
}

async function nextUserNonce(wallet: string, action: 'commit' | 'reveal', rfqId: string): Promise<number> {
    const transition = action === 'commit' ? 'submit_bid_commit' : 'reveal_bid';
    const canonicalPrefix =
        action === 'commit'
            ? `commit_bid:${wallet}:${rfqId}`
            : `reveal_bid:${wallet}:${rfqId}:`;
    const confirmed = await prisma.transaction.count({
        where: {
            transition,
            status: 'CONFIRMED',
            canonicalTxKey: { startsWith: canonicalPrefix },
        },
    });
    return confirmed + 1;
}

const CommitBidSchema = z.object({
    rfqId: z.string(),
    bidAmount: z.string().transform((s) => BigInt(s)),
    nonce: z.string().min(1),
    stake: z.string().transform((s) => BigInt(s)),
    txHash: z.string().optional(),
    bidId: z.string().optional(),
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
        const expectedFlatStake = computeFlatStake(rfq.minBid);
        if (data.stake !== expectedFlatStake) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_AMOUNT',
                        message: `Stake must equal the RFQ flat stake of ${expectedFlatStake.toString()}`,
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

        const bidId = data.bidId || `${Date.now()}${crypto.randomInt(100, 999)}field`;
        const currentBlock = DEMO_MODE ? Math.floor(Date.now() / 1000) : await getCurrentBlockHeight();

        if (data.txHash) {
            // Confirm phase: wallet tx already succeeded, create business record
            const commitmentHash = crypto
                .createHash('sha256')
                .update(`${data.bidAmount.toString()}:${data.nonce}`)
                .digest('hex');

            await prisma.bid.create({
                data: {
                    id: bidId,
                    rfqId: data.rfqId,
                    vendor: authResult.walletAddress,
                    commitmentHash,
                    stake: data.stake,
                    createdBlock: currentBlock,
                    createdTxId: data.txHash,
                    createdEventIdx: 0,
                },
            });

            return NextResponse.json({
                status: 'success',
                data: { bid_id: bidId, txHash: data.txHash },
            });
        }

        // Prepare phase: validate, construct tx, track — but do NOT create bid record
        const idempotencyKey = `commit_bid_${bidId}`;
        const canonicalKey = `commit_bid:${authResult.walletAddress}:${data.rfqId}`;
        const userNonce = await nextUserNonce(authResult.walletAddress, 'commit', data.rfqId);

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
                      `${userNonce}u64`,
                      `${rfq.minBid}u64`,
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
    txHash: z.string().optional(),
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

        // Check reveal deadline before wasting a wallet interaction
        if (!DEMO_MODE) {
            const currentBlock = await getCurrentBlockHeight();
            if (currentBlock >= rfq.revealDeadline) {
                return NextResponse.json(
                    {
                        status: 'error',
                        error: {
                            code: 'DEADLINE_PASSED',
                            message: `Reveal deadline has passed (deadline: block ${rfq.revealDeadline}, current: block ${currentBlock}). This RFQ can no longer accept bid reveals.`,
                        },
                    },
                    { status: 400 },
                );
            }
        }

        // Verify the preimage: SHA256(amount || nonce) must match stored commitmentHash.
        const expectedHash = crypto
            .createHash('sha256')
            .update(`${data.bidAmount.toString()}:${data.nonce}`)
            .digest('hex');

        if (expectedHash !== bid.commitmentHash) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_PREIMAGE',
                        message: 'Revealed amount and nonce do not match the original bid commitment',
                    },
                },
                { status: 400 },
            );
        }

        if (data.txHash) {
            // Confirm phase: wallet tx already succeeded, update bid record
            const currentBlock = DEMO_MODE ? Math.floor(Date.now() / 1000) : await getCurrentBlockHeight();
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
                data: { bid_id: bidId, txHash: data.txHash },
            });
        }

        // Prepare phase: validate, construct tx, track — but do NOT update bid
        const idempotencyKey = `reveal_bid_${bidId}_${crypto.randomUUID()}`;
        const canonicalKey = `reveal_bid:${authResult.walletAddress}:${bid.rfqId}:${bidId}`;
        const userNonce = await nextUserNonce(authResult.walletAddress, 'reveal', bid.rfqId);
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
                      `${userNonce}u64`,
                  ],
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
        const winnerAcceptedByRfq = new Map<string, boolean | null>();

        await Promise.all(
            rfqs
                .filter((rfq) => ['WINNER_SELECTED', 'ESCROW_FUNDED', 'COMPLETED'].includes(rfq.status))
                .map(async (rfq) => {
                    try {
                        winnerAcceptedByRfq.set(rfq.id, await getWinnerAcceptedState(rfq.id));
                    } catch {
                        winnerAcceptedByRfq.set(rfq.id, null);
                    }
                })
        );

        const enriched = bids.map((bid) => {
            const rfq = rfqById.get(bid.rfqId);
            return {
                ...serializeBid(bid),
                rfqStatus: rfq?.status ?? null,
                revealDeadline: rfq?.revealDeadline ?? null,
                winnerAccepted:
                    bid.isWinner && rfq
                        ? winnerAcceptedByRfq.get(rfq.id) ?? null
                        : null,
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

