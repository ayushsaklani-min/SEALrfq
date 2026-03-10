import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { TxStatus } from '../../db/enums';
import { requireRole } from '../../auth/middleware';
import { TransactionTracker } from '../../tx/tracker';
import { getCurrentBlockHeight } from '../../aleo/executor';
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

async function synchronizeEscrowSettlementState(rfqId: string): Promise<void> {
    const [rfq, escrow] = await Promise.all([
        prisma.rFQ.findUnique({
            where: { id: rfqId },
            select: { id: true, status: true },
        }),
        prisma.escrow.findUnique({
            where: { rfqId },
            select: { rfqId: true, releasedAmount: true, isFinal: true, totalAmount: true },
        }),
    ]);

    if (!rfq || !escrow) {
        return;
    }

    const { confirmedPayments, confirmedReleasedAmount } = await getConfirmedPaymentsForRFQ(rfqId);
    const hasConfirmedFinalPayment = confirmedPayments.some((payment) => payment.isFinal);
    const nextRfqStatus = hasConfirmedFinalPayment ? 'COMPLETED' : 'ESCROW_FUNDED';
    const escrowNeedsUpdate =
        escrow.releasedAmount !== confirmedReleasedAmount || escrow.isFinal !== hasConfirmedFinalPayment;
    const rfqNeedsUpdate = rfq.status !== nextRfqStatus;

    if (!escrowNeedsUpdate && !rfqNeedsUpdate) {
        return;
    }

    await prisma.$transaction([
        ...(escrowNeedsUpdate
            ? [
                  prisma.escrow.update({
                      where: { rfqId },
                      data: {
                          releasedAmount: confirmedReleasedAmount,
                          isFinal: hasConfirmedFinalPayment,
                      },
                  }),
              ]
            : []),
        ...(rfqNeedsUpdate
            ? [
                  prisma.rFQ.update({
                      where: { id: rfqId },
                      data: { status: nextRfqStatus, updatedAt: new Date() },
                  }),
              ]
            : []),
    ]);
}

async function nextPaymentNonce(walletAddress: string, rfqId: string): Promise<number> {
    const confirmed = await prisma.transaction.count({
        where: {
            transition: { in: ['release_partial_payment', 'release_final_payment'] },
            status: 'CONFIRMED',
            canonicalTxKey: { startsWith: `release_payment:${walletAddress}:${rfqId}:` },
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
        network: DEMO_MODE ? 'demo' : DEFAULT_NETWORK,
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
        let escrow = await prisma.escrow.findUnique({ where: { rfqId } });
        if (!escrow) {
            escrow = await materializeEscrowFromConfirmedFunding(prisma, rfqId);
        }
        if (escrow) {
            await synchronizeEscrowSettlementState(rfqId);
            escrow = await prisma.escrow.findUnique({ where: { rfqId } });
        }
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

        // Build milestone list from confirmed payments.
        // Partial payments = PARTIAL milestone, final payment = FINAL milestone.
        const milestones = confirmedPayments.map((payment, index) => {
            const pctOfTotal =
                escrow.totalAmount > 0n
                    ? Number((payment.amount * 100n) / escrow.totalAmount)
                    : 0;
            return {
                index: index + 1,
                type: payment.isFinal ? 'FINAL' : 'PARTIAL',
                amount: payment.amount.toString(),
                percentageOfTotal: pctOfTotal,
                recipient: payment.recipient,
                releasedBlock: payment.releasedBlock,
                releasedAt: payment.releasedAt,
                txId: payment.releasedTxId,
                status: payment.releasedTxId.startsWith('pending_') ? 'PENDING' : 'CONFIRMED',
            };
        });

        return NextResponse.json({
            status: 'success',
            data: {
                ...serializeEscrow(escrow),
                releasedAmount: confirmedReleasedAmount.toString(),
                remainingAmount: remainingAmount.toString(),
                payments: confirmedPayments.map(serializePayment),
                isReconciled,
                pendingTx,
                milestones,
                nextMilestone: milestones.length === 0
                    ? { type: 'PARTIAL', suggestedPercentage: 40, description: '1st milestone — partial delivery (40%)' }
                    : !escrow.isFinal
                    ? { type: 'FINAL', suggestedPercentage: 100 - milestones.reduce((a, m) => a + m.percentageOfTotal, 0), description: 'Final milestone — project completion' }
                    : null,
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
    amount: z
        .string()
        .transform((s) => BigInt(s))
        .refine((amount) => amount > 0n, { message: 'Amount must be greater than zero' }),
    milestoneId: z.string().optional(),
    txHash: z.string().optional(),
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
        let rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });

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

        let escrow = await prisma.escrow.findUnique({ where: { rfqId } });
        if (!escrow) {
            escrow = await materializeEscrowFromConfirmedFunding(prisma, rfqId);
        }
        if (escrow) {
            await synchronizeEscrowSettlementState(rfqId);
            [rfq, escrow] = await Promise.all([
                prisma.rFQ.findUnique({ where: { id: rfqId } }),
                prisma.escrow.findUnique({ where: { rfqId } }),
            ]);
        }
        if (!escrow) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: { code: 'INVALID_STATE', message: 'Escrow not yet funded' },
                },
                { status: 400 },
            );
        }
        if (rfq.status !== 'ESCROW_FUNDED') {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: `Cannot release payment: RFQ is in ${rfq.status} state (expected ESCROW_FUNDED)`,
                    },
                },
                { status: 400 },
            );
        }
        if (IS_POC_PROGRAM) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'UNSUPPORTED_PROGRAM',
                        message: 'Contract-based payout release requires a SealRFQ v2+ program, not sealrfq_poc.aleo',
                    },
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
        if (remainingAmount <= 0n) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: 'Escrow has already been fully released',
                    },
                },
                { status: 400 },
            );
        }
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
            const milestoneCanonicalKey = `release_payment:${authResult.walletAddress}:${rfqId}:milestone_${data.milestoneId}`;
            const existingAttempt = await prisma.transaction.findFirst({
                where: {
                    canonicalTxKey: milestoneCanonicalKey,
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

        const currentBlock = DEMO_MODE ? Math.floor(Date.now() / 1000) : await getCurrentBlockHeight();
        const isFinal = data.amount === remainingAmount;
        const userNonce = await nextPaymentNonce(authResult.walletAddress, rfqId);
        const canonicalScope = data.milestoneId
            ? `milestone_${data.milestoneId}`
            : `nonce_${userNonce}`;
        const canonicalKey = `release_payment:${authResult.walletAddress}:${rfqId}:${canonicalScope}`;

        let tx: AleoTransaction;
        if (isFinal) {
            tx = {
                program: DEFAULT_PROGRAM_ID,
                function: 'release_final_payment',
                inputs: [
                    rfqId,
                    winnerBid.vendor,
                    `${remainingAmount}u64`,
                    `${userNonce}u64`,
                ],
                fee: estimateFee('release_final_payment'),
            };
        } else {
            const scaledPercentage = data.amount * 100n;
            const newTotalReleased = confirmedReleasedAmount + data.amount;
            if (scaledPercentage % remainingAmount !== 0n) {
                return NextResponse.json(
                    {
                        status: 'error',
                        error: {
                            code: 'INVALID_AMOUNT',
                            message: `Partial release amount must equal an exact integer percentage of the remaining escrow (${remainingAmount.toString()})`,
                        },
                    },
                    { status: 400 },
                );
            }

            const percentage = scaledPercentage / remainingAmount;
            if (percentage <= 0n || percentage > 100n) {
                return NextResponse.json(
                    {
                        status: 'error',
                        error: {
                            code: 'INVALID_AMOUNT',
                            message: 'Partial release percentage must be between 1 and 100',
                        },
                    },
                    { status: 400 },
                );
            }

            tx = {
                program: DEFAULT_PROGRAM_ID,
                function: 'release_partial_payment',
                inputs: [
                    rfqId,
                    winnerBid.vendor,
                    `${data.amount}u64`,
                    `${Number(percentage)}u8`,
                    `${newTotalReleased}u64`,
                    `${userNonce}u64`,
                ],
                fee: estimateFee('release_partial_payment'),
            };
        }

        if (data.txHash) {
            // Confirm phase: wallet tx already succeeded, create payment record
            await prisma.payment.create({
                data: {
                    rfqId,
                    recipient: winnerBid.vendor,
                    amount: data.amount,
                    isFinal,
                    releasedBlock: currentBlock,
                    releasedTxId: data.txHash,
                    releasedEventIdx: 0,
                },
            });

            return NextResponse.json({
                status: 'success',
                data: { txHash: data.txHash },
            });
        }

        // Prepare phase: validate, construct tx, track — but do NOT create payment
        const paymentId = `payment_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
        const idempotencyKey = `release_payment_${paymentId}`;
        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);

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
    const authResult = await requireRole(request, ['BUYER', 'AUDITOR']);
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

        // Non-auditors can only query their own RFQs.
        if (authResult.role !== 'AUDITOR') {
            const buyerRfqIds = await prisma.rFQ
                .findMany({ where: { buyer: authResult.walletAddress }, select: { id: true } })
                .then((rows) => rows.map((r) => r.id));
            if (query.rfqId && !buyerRfqIds.includes(query.rfqId)) {
                return NextResponse.json(
                    { status: 'error', error: { code: 'FORBIDDEN', message: 'Access denied to this RFQ audit trail' } },
                    { status: 403 },
                );
            }
            if (!query.rfqId) {
                where.rfqId = { in: buyerRfqIds };
            }
        }

        const events = await prisma.rFQEvent.findMany({
            where,
            orderBy: [{ blockHeight: 'desc' }, { eventIdx: 'desc' }],
            take: query.limit,
        });

        if (events.length === 0) {
            const txRows = await prisma.transaction.findMany({
                where: {
                    status: TxStatus.CONFIRMED,
                    ...(query.rfqId ? { canonicalTxKey: { contains: query.rfqId } } : {}),
                },
                orderBy: { confirmedAt: 'desc' },
                take: query.limit,
                select: {
                    id: true,
                    transition: true,
                    txHash: true,
                    idempotencyKey: true,
                    blockHeight: true,
                    confirmedAt: true,
                    submittedAt: true,
                    preparedAt: true,
                    canonicalTxKey: true,
                },
            });

            const synthesized = txRows
                .map((tx) => ({
                    id: `tx_${tx.id}`,
                    eventType: transitionToEventType(tx.transition),
                    txId: tx.txHash || tx.idempotencyKey,
                    blockHeight: tx.blockHeight || 0,
                    eventVersion: 1,
                    processedAt: tx.confirmedAt || tx.submittedAt || tx.preparedAt,
                    rfqId: inferRfqIdFromCanonicalKey(tx.canonicalTxKey),
                    transition: tx.transition,
                    eventData: null,
                }))
                .filter((event) => (query.eventType ? event.eventType === query.eventType : true));

            return NextResponse.json({
                status: 'success',
                data: synthesized,
            });
        }

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

function transitionToEventType(transition: string): string {
    const map: Record<string, string> = {
        create_rfq: 'RFQ_CREATED',
        submit_bid_commit: 'BID_COMMITTED',
        close_bidding: 'BIDDING_CLOSED',
        reveal_bid: 'BID_REVEALED',
        select_winner: 'WINNER_SELECTED',
        slash_non_revealer: 'STAKE_SLASHED',
        fund_escrow: 'ESCROW_FUNDED',
        release_partial_payment: 'PAYMENT_RELEASED',
        release_final_payment: 'PAYMENT_RELEASED',
    };
    return map[transition] || 'UNKNOWN';
}

function inferRfqIdFromCanonicalKey(canonicalTxKey: string): string | null {
    const fieldMatch = canonicalTxKey.match(/\d+field/);
    return fieldMatch ? fieldMatch[0] : null;
}

