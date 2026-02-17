import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { TxStatus } from '../../db/enums';
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

function serializeEscrow(escrow: any) {
    return {
        ...escrow,
        totalAmount: escrow.totalAmount?.toString(),
        releasedAmount: escrow.releasedAmount?.toString(),
    };
}

function serializePayment(payment: any) {
    return {
        ...payment,
        amount: payment.amount?.toString(),
    };
}

async function getConfirmedPaymentsForRFQ(rfqId: string) {
    const payments = await prisma.payment.findMany({
        where: { rfqId },
        orderBy: { releasedAt: 'desc' },
    });

    const idempotencyKeys = payments
        .map((payment) =>
            payment.releasedTxId.startsWith('pending_')
                ? payment.releasedTxId.substring('pending_'.length)
                : null
        )
        .filter((k): k is string => Boolean(k));

    const txRows =
        idempotencyKeys.length > 0
            ? await prisma.transaction.findMany({
                  where: { idempotencyKey: { in: idempotencyKeys } },
                  select: { idempotencyKey: true, status: true },
              })
            : [];
    const txStatusByKey = new Map(txRows.map((t) => [t.idempotencyKey, t.status]));

    const confirmedPayments = payments.filter((payment) => {
        if (!payment.releasedTxId.startsWith('pending_')) return true;
        const key = payment.releasedTxId.substring('pending_'.length);
        return txStatusByKey.get(key) === TxStatus.CONFIRMED;
    });

    const confirmedReleasedAmount = confirmedPayments.reduce(
        (acc, payment) => acc + payment.amount,
        BigInt(0)
    );

    return { confirmedPayments, confirmedReleasedAmount };
}

async function nextPaymentNonce(walletAddress: string): Promise<number> {
    const confirmed = await prisma.transaction.count({
        where: {
            transition: { in: ['release_partial_payment', 'release_final_payment'] },
            status: 'CONFIRMED',
            canonicalTxKey: { contains: walletAddress },
        },
    });
    return confirmed + 1;
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

export async function handleGetEscrow(
    request: NextRequest,
    rfqId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const escrow = await prisma.escrow.findUnique({ where: { rfqId } });
        if (!escrow) {
            return NextResponse.json(
                { status: 'error', error: { code: 'NOT_FOUND', message: 'Escrow not found' } },
                { status: 404 },
            );
        }

        const { confirmedPayments, confirmedReleasedAmount } = await getConfirmedPaymentsForRFQ(rfqId);

        const latestBlockIndexed = await getLatestIndexedBlock();
        const pendingTx = await prisma.transaction.count({
            where: {
                canonicalTxKey: { contains: rfqId },
                status: { in: [TxStatus.PREPARED, TxStatus.SUBMITTED] },
            },
        });

        const remainingAmount = escrow.totalAmount - confirmedReleasedAmount;
        const isReconciled = pendingTx === 0 && Math.abs(latestBlockIndexed - escrow.fundedBlock) < 5;

        return NextResponse.json({
            status: 'success',
            data: {
                ...serializeEscrow(escrow),
                releasedAmount: confirmedReleasedAmount.toString(),
                remainingAmount: remainingAmount.toString(),
                payments: confirmedPayments.map(serializePayment),
                isReconciled,
                pendingTx,
                milestones: [],
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'INTERNAL_ERROR', message: error.message } },
            { status: 500 },
        );
    }
}

const ReleasePaymentSchema = z.object({
    amount: z.string().transform((s) => BigInt(s)),
    milestoneId: z.string().optional(),
});

export async function handleReleasePayment(
    request: NextRequest,
    rfqId: string,
): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const body = await request.json();
        const data = ReleasePaymentSchema.parse(body);
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

        const escrow = await prisma.escrow.findUnique({ where: { rfqId } });
        if (!escrow) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'INVALID_STATE', message: 'Escrow not yet funded' },
                },
                { status: 400 },
            );
        }

        const winnerBid = await prisma.bid.findFirst({
            where: { rfqId, isWinner: true },
            select: { vendor: true },
        });
        if (!winnerBid) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'INVALID_STATE', message: 'No winner selected for this RFQ' },
                },
                { status: 400 },
            );
        }

        const { confirmedReleasedAmount } = await getConfirmedPaymentsForRFQ(rfqId);
        const remainingAmount = escrow.totalAmount - confirmedReleasedAmount;
        if (data.amount > remainingAmount) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INSUFFICIENT_FUNDS',
                        message: `Cannot release ${data.amount.toString()}: only ${remainingAmount.toString()} remaining`,
                    },
                },
                { status: 400 },
            );
        }

        const canonicalScope = data.milestoneId || `amount_${data.amount.toString()}`;
        const canonicalKey = `release_payment:${authResult.walletAddress}:${rfqId}:${canonicalScope}`;
        const inFlight = await prisma.transaction.findFirst({
            where: {
                canonicalTxKey: { startsWith: `release_payment:${authResult.walletAddress}:${rfqId}:` },
                status: { in: [TxStatus.PREPARED, TxStatus.SUBMITTED] },
            },
        });
        if (inFlight) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'PAYMENT_IN_PROGRESS', message: 'Another payment release is in progress' },
                },
                { status: 409 },
            );
        }
        if (data.milestoneId) {
            const existingAttempt = await prisma.transaction.findFirst({
                where: {
                    canonicalTxKey: canonicalKey,
                    status: { in: [TxStatus.PREPARED, TxStatus.SUBMITTED, TxStatus.CONFIRMED] },
                },
            });
            if (existingAttempt) {
                return NextResponse.json(
                    {
                        status: 'error',
                        error: { code: 'DUPLICATE_PAYMENT', message: 'Milestone already released or in progress' },
                    },
                    { status: 400 },
                );
            }
        }

        const currentBlock = await getCurrentBlockHeight();
        const userNonce = await nextPaymentNonce(authResult.walletAddress);
        const isFinal = data.amount === remainingAmount;

        let tx: AleoTransaction;
        if (isFinal) {
            tx = {
                program: DEFAULT_PROGRAM_ID,
                function: 'release_final_payment',
                inputs: IS_POC_PROGRAM
                    ? [rfqId, winnerBid.vendor]
                    : [
                          rfqId,
                          winnerBid.vendor,
                          `${currentBlock}u32`,
                          `${userNonce}u64`,
                      ],
                fee: BigInt(1_000_000),
            };
        } else {
            const percentage = Number((data.amount * BigInt(100)) / remainingAmount);
            if (percentage <= 0 || percentage > 100) {
                return NextResponse.json(
                    {
                        status: 'error',
                        error: { code: 'INVALID_AMOUNT', message: 'Release amount results in invalid percentage' },
                    },
                    { status: 400 },
                );
            }
            tx = {
                program: DEFAULT_PROGRAM_ID,
                function: 'release_partial_payment',
                inputs: IS_POC_PROGRAM
                    ? [rfqId, `${percentage}u8`, winnerBid.vendor]
                    : [
                          rfqId,
                          `${percentage}u8`,
                          winnerBid.vendor,
                          `${currentBlock}u32`,
                          `${userNonce}u64`,
                      ],
                fee: BigInt(1_000_000),
            };
        }

        const paymentId = `payment_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
        const idempotencyKey = `release_payment_${paymentId}`;
        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);

        await prisma.payment.create({
            data: {
                rfqId,
                recipient: winnerBid.vendor,
                amount: data.amount,
                isFinal,
                releasedBlock: currentBlock,
                releasedTxId: `pending_${idempotencyKey}`,
                releasedEventIdx: 0,
            },
        });

        return NextResponse.json({
            status: 'success',
            data: {
                payment_id: paymentId,
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

const AuditQuerySchema = z.object({
    rfqId: z.string().optional(),
    eventType: z.string().optional(),
    limit: z.coerce.number().min(1).max(500).default(100),
});

export async function handleGetAuditTrail(request: NextRequest): Promise<NextResponse> {
    const authResult = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (authResult instanceof NextResponse) {
        return authResult;
    }

    try {
        const url = new URL(request.url);
        const params = {
            rfqId: url.searchParams.get('rfqId') || undefined,
            eventType: url.searchParams.get('eventType') || undefined,
            limit: url.searchParams.get('limit') || '100',
        };
        const query = AuditQuerySchema.parse(params);
        const where: any = {};
        if (query.rfqId) where.rfqId = query.rfqId;
        if (query.eventType) where.eventType = query.eventType;

        const events = await prisma.rFQEvent.findMany({
            where,
            orderBy: [{ blockHeight: 'desc' }, { eventIdx: 'desc' }],
            take: query.limit,
        });

        return NextResponse.json({
            status: 'success',
            data: events.map((e) => ({
                id: e.id,
                eventType: e.eventType,
                txId: e.txId,
                blockHeight: e.blockHeight,
                eventVersion: e.eventVersion,
                processedAt: e.processedAt,
                rfqId: e.rfqId,
                transition: e.transition,
                eventData: e.eventData,
            })),
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } },
            { status: 400 },
        );
    }
}

async function getLatestIndexedBlock(): Promise<number> {
    const latest = await prisma.rFQEvent.findFirst({
        orderBy: { blockHeight: 'desc' },
        select: { blockHeight: true },
    });

    return latest?.blockHeight || 0;
}
