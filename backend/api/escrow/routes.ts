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
    deriveReceiptHash,
    PRICING_MODE,
    PROGRAM_IDS,
    RFQ_STATUS,
    TIMING,
    TOKEN_TYPE,
    canonicalActionKey,
    getPlatformConfig,
    getRfqChainState,
    getWinningAmountFromChain,
    tokenSymbol,
} from '../../lib/sealProtocol';
import { getBuyerProfiles, getVendorProfiles } from '../../lib/counterpartyProfile';
import {
    DELIVERY_MILESTONE_STATUS,
    DeliveryEvidenceSchema,
    DeliveryPlanSchema,
    DeliveryReviewSchema,
    serializeDeliveryMilestone,
    summarizeDeliveryMilestones,
    validateMilestoneReleaseSchedule,
} from '../../lib/deliveryAssurance';

const prisma = new PrismaClient();
const tracker = new TransactionTracker(prisma);
const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'testnet';
const DEMO_MODE = process.env.DEMO_MODE === 'true';

const ReleasePartialSchema = z.object({
    amount: z.string().regex(/^\d+$/).transform((value) => BigInt(value)),
    milestoneId: z.string().uuid().optional(),
    txHash: z.string().optional(),
});

const InvoiceSchema = z.object({
    paymentRecord: z.string().min(1).optional(),
    receiptNonce: z.string().regex(/^\d+field$/),
    proofA: z.string().optional(),
    proofB: z.string().optional(),
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
    const confirmed = await prisma.transaction.count({
        where: {
            status: 'CONFIRMED',
            canonicalTxKey: { startsWith: `nonce:${actionTag}:${walletAddress}:${rfqId}` },
        },
    });
    return confirmed + 1;
}

function serializePayment(payment: any) {
    return {
        ...payment,
        amount: payment.amount?.toString(),
    };
}

function partialTransition(tokenType: number) {
    if (tokenType === TOKEN_TYPE.USDCX) return { fn: 'release_partial_usdcx', actionTag: ACTION_TAG.PARTIAL_USDCX };
    if (tokenType === TOKEN_TYPE.USAD) return { fn: 'release_partial_usad', actionTag: ACTION_TAG.PARTIAL_USAD };
    return { fn: 'release_partial_payment', actionTag: ACTION_TAG.PAYMENT_CREDITS };
}

function finalTransition(tokenType: number) {
    if (tokenType === TOKEN_TYPE.USDCX) return { fn: 'release_final_usdcx', actionTag: ACTION_TAG.FINAL_USDCX };
    if (tokenType === TOKEN_TYPE.USAD) return { fn: 'release_final_usad', actionTag: ACTION_TAG.FINAL_USAD };
    return { fn: 'release_final_payment', actionTag: ACTION_TAG.PAYMENT_CREDITS };
}

function invoiceTransition(tokenType: number) {
    if (tokenType === TOKEN_TYPE.USDCX) return { fn: 'pay_invoice_usdcx', actionTag: ACTION_TAG.INVOICE_USDCX, program: PROGRAM_IDS.invoice };
    if (tokenType === TOKEN_TYPE.USAD) return { fn: 'pay_invoice_usad', actionTag: ACTION_TAG.INVOICE_USAD, program: PROGRAM_IDS.invoice };
    return { fn: 'pay_invoice', actionTag: ACTION_TAG.INVOICE_CREDITS, program: PROGRAM_IDS.rfq };
}

function winnerClaimTransition(tokenType: number) {
    if (tokenType === TOKEN_TYPE.USDCX) return 'winner_claim_usdcx';
    if (tokenType === TOKEN_TYPE.USAD) return 'winner_claim_usad';
    return 'winner_claim_escrow';
}

function creatorReclaimTransition(tokenType: number) {
    if (tokenType === TOKEN_TYPE.USDCX) return 'creator_reclaim_escrow_usdcx';
    if (tokenType === TOKEN_TYPE.USAD) return 'creator_reclaim_escrow_usad';
    return 'creator_reclaim_escrow';
}

async function loadEscrowState(rfqId: string) {
    const [rfq, escrow, chain, platform, payments, currentBlock, winningBid, milestones] = await Promise.all([
        prisma.rFQ.findUnique({ where: { id: rfqId } }),
        prisma.escrow.findUnique({ where: { rfqId } }),
        getRfqChainState(rfqId),
        getPlatformConfig(),
        prisma.payment.findMany({ where: { rfqId }, orderBy: { releasedAt: 'asc' } }),
        getCurrentBlockHeight(),
        prisma.bid.findFirst({
            where: { rfqId, isWinner: true },
            select: { vendor: true, revealedAmount: true, revealedBlock: true },
        }),
        prisma.deliveryMilestone.findMany({ where: { rfqId }, orderBy: { sequence: 'asc' } }),
    ]);

    const releasedAmount = payments.reduce((total, payment) => total + payment.amount, BigInt(0));
    const winningAmount = await getWinningAmountFromChain(rfqId);
    const onChainExists = chain.statusCode !== 0;
    const effectiveChain = {
        ...chain,
        status: onChainExists ? chain.status : (rfq?.status ?? chain.status),
        creator: chain.creator ?? rfq?.buyer ?? null,
        winner: chain.winner ?? winningBid?.vendor ?? null,
        lifecycleBlock: onChainExists
            ? chain.lifecycleBlock
            : (escrow?.fundedBlock ?? winningBid?.revealedBlock ?? rfq?.createdBlock ?? null),
        escrowToken: onChainExists ? chain.escrowToken : (rfq?.tokenType ?? TOKEN_TYPE.CREDITS),
        pricingMode: onChainExists ? chain.pricingMode : (rfq?.pricingMode ?? PRICING_MODE.RFQ),
        paid: onChainExists ? chain.paid : Boolean(rfq?.paid),
        winnerAccepted: onChainExists ? chain.winnerAccepted : Boolean(rfq?.winnerAccepted),
        auctionSource: onChainExists ? chain.auctionSource : (rfq?.auctionSource ?? null),
        receiptHash: onChainExists ? chain.receiptHash : (rfq?.receiptHash ?? null),
    };

    return {
        rfq,
        escrow,
        chain: effectiveChain,
        platform,
        payments,
        milestones,
        releasedAmount,
        winningAmount: winningAmount ? BigInt(winningAmount) : (winningBid?.revealedAmount ?? escrow?.totalAmount ?? BigInt(0)),
        currentBlock,
    };
}

function feeBpsForToken(tokenType: number, platformFeeBps: number) {
    return tokenType === TOKEN_TYPE.USAD ? 0 : platformFeeBps;
}

export async function handleGetEscrow(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const state = await loadEscrowState(rfqId);
    if (!state.rfq || !state.escrow) {
        return NextResponse.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'Escrow not found' } }, { status: 404 });
    }

    const [creatorProfiles, winnerProfiles] = await Promise.all([
        getBuyerProfiles(prisma, [state.chain.creator ?? state.rfq.buyer]),
        getVendorProfiles(prisma, [state.chain.winner]),
    ]);

    const remainingAmount = state.escrow.totalAmount - state.releasedAmount;
    const recoveryBlock = (state.chain.lifecycleBlock ?? 0) + TIMING.ESCROW_RECOVERY_BLOCKS;
    const timeoutBlock = (state.chain.lifecycleBlock ?? 0) + TIMING.ESCROW_TIMEOUT_BLOCKS;
    const deliverySummary = summarizeDeliveryMilestones(state.milestones, state.winningAmount);

    return NextResponse.json({
        status: 'success',
        data: {
            id: state.escrow.id,
            rfqId,
            status: state.chain.status,
            tokenType: state.chain.escrowToken,
            tokenSymbol: tokenSymbol(state.chain.escrowToken),
            pricingMode: state.chain.pricingMode,
            totalAmount: state.escrow.totalAmount.toString(),
            releasedAmount: state.releasedAmount.toString(),
            remainingAmount: remainingAmount.toString(),
            milestoneCount: state.milestones.length,
            payments: state.payments.map(serializePayment),
            milestones: state.milestones.map(serializeDeliveryMilestone),
            deliverySummary,
            lifecycleBlock: state.chain.lifecycleBlock,
            currentBlock: state.currentBlock,
            recoveryBlock,
            timeoutBlock,
            winner: state.chain.winner,
            creator: state.chain.creator ?? state.rfq.buyer,
            creatorProfile: creatorProfiles[state.chain.creator ?? state.rfq.buyer] ?? null,
            winnerProfile: state.chain.winner ? winnerProfiles[state.chain.winner] ?? null : null,
            paid: state.chain.paid,
            receiptHash: state.chain.receiptHash,
            feeBps: feeBpsForToken(state.chain.escrowToken, state.platform.feeBps),
            settlementPathLocked:
                state.chain.paid ? 'PRIVATE_PAYMENT' : state.releasedAmount > 0n ? 'PARTIAL_RELEASES' : null,
            canRecoverBond: state.chain.paid && remainingAmount > 0n,
            canWinnerClaim:
                state.chain.status === RFQ_STATUS.ESCROW_FUNDED &&
                !state.chain.paid &&
                state.currentBlock > recoveryBlock,
            canCreatorReclaim:
                state.chain.status === RFQ_STATUS.ESCROW_FUNDED &&
                !state.chain.paid &&
                state.currentBlock > recoveryBlock,
            winningAmount: state.winningAmount.toString(),
        },
    });
}

export async function handleGetDeliveryMilestones(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const state = await loadEscrowState(rfqId);
    if (!state.rfq) {
        return NextResponse.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } }, { status: 404 });
    }

    return NextResponse.json({
        status: 'success',
        data: {
            rfqId,
            winner: state.chain.winner,
            creator: state.chain.creator ?? state.rfq.buyer,
            winningAmount: state.winningAmount.toString(),
            milestones: state.milestones.map(serializeDeliveryMilestone),
            summary: summarizeDeliveryMilestones(state.milestones, state.winningAmount),
        },
    });
}

export async function handleUpsertDeliveryMilestones(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = DeliveryPlanSchema.parse(await request.json());
        const state = await loadEscrowState(rfqId);

        if (!state.rfq || state.rfq.buyer !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the buyer can manage the delivery plan.' } }, { status: 403 });
        }

        if (!state.chain.winner || state.winningAmount <= 0n) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Create the delivery plan after a winner and winning amount exist.' } }, { status: 412 });
        }

        if (state.milestones.some((milestone) => milestone.status !== DELIVERY_MILESTONE_STATUS.PLANNED && milestone.status !== DELIVERY_MILESTONE_STATUS.REJECTED)) {
            return NextResponse.json({ status: 'error', error: { code: 'PLAN_LOCKED', message: 'The delivery plan cannot be replaced after evidence review or release has started.' } }, { status: 409 });
        }

        const totalPlanned = data.milestones.reduce((sum, milestone) => sum + milestone.amount, 0n);
        if (totalPlanned > state.winningAmount) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_PLAN', message: 'Planned milestone total cannot exceed the winning amount.' } }, { status: 400 });
        }

        const scheduleError = validateMilestoneReleaseSchedule(
            data.milestones.map((milestone) => milestone.amount),
            state.winningAmount,
        );
        if (scheduleError) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_PLAN', message: scheduleError } }, { status: 400 });
        }

        await prisma.$transaction([
            prisma.deliveryMilestone.deleteMany({ where: { rfqId } }),
            prisma.deliveryMilestone.createMany({
                data: data.milestones.map((milestone, index) => ({
                    rfqId,
                    sequence: index + 1,
                    title: milestone.title,
                    description: milestone.description || null,
                    targetAmount: milestone.amount,
                    status: DELIVERY_MILESTONE_STATUS.PLANNED,
                })),
            }),
        ]);

        const milestones = await prisma.deliveryMilestone.findMany({ where: { rfqId }, orderBy: { sequence: 'asc' } });
        return NextResponse.json({
            status: 'success',
            data: {
                rfqId,
                milestones: milestones.map(serializeDeliveryMilestone),
                summary: summarizeDeliveryMilestones(milestones, state.winningAmount),
            },
        });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleSubmitDeliveryEvidence(request: NextRequest, rfqId: string, milestoneId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = DeliveryEvidenceSchema.parse(await request.json());
        const state = await loadEscrowState(rfqId);
        const milestone = state.milestones.find((item) => item.id === milestoneId);

        if (!state.rfq || !milestone) {
            return NextResponse.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'Milestone not found.' } }, { status: 404 });
        }
        if (state.chain.winner !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the winning vendor can submit delivery evidence.' } }, { status: 403 });
        }
        if (milestone.status === DELIVERY_MILESTONE_STATUS.APPROVED || milestone.status === DELIVERY_MILESTONE_STATUS.RELEASED) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Evidence is already approved or released for this milestone.' } }, { status: 409 });
        }

        const updated = await prisma.deliveryMilestone.update({
            where: { id: milestoneId },
            data: {
                status: DELIVERY_MILESTONE_STATUS.SUBMITTED,
                evidenceHash: data.evidenceHash,
                evidenceUrl: data.evidenceUrl || null,
                evidenceNote: data.note || null,
                evidenceSubmittedBy: auth.walletAddress,
                evidenceSubmittedAt: new Date(),
                reviewedBy: null,
                reviewedAt: null,
                reviewNote: null,
                rejectionReason: null,
            },
        });

        return NextResponse.json({ status: 'success', data: { milestone: serializeDeliveryMilestone(updated) } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleReviewDeliveryEvidence(request: NextRequest, rfqId: string, milestoneId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = DeliveryReviewSchema.parse(await request.json());
        const state = await loadEscrowState(rfqId);
        const milestone = state.milestones.find((item) => item.id === milestoneId);

        if (!state.rfq || !milestone) {
            return NextResponse.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'Milestone not found.' } }, { status: 404 });
        }
        if (state.rfq.buyer !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the buyer can review milestone evidence.' } }, { status: 403 });
        }
        if (milestone.status !== DELIVERY_MILESTONE_STATUS.SUBMITTED) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Milestone evidence must be submitted before review.' } }, { status: 409 });
        }

        const updated = await prisma.deliveryMilestone.update({
            where: { id: milestoneId },
            data: {
                status: data.approve ? DELIVERY_MILESTONE_STATUS.APPROVED : DELIVERY_MILESTONE_STATUS.REJECTED,
                reviewedBy: auth.walletAddress,
                reviewedAt: new Date(),
                reviewNote: data.note || null,
                rejectionReason: data.approve ? null : data.rejectionReason || null,
            },
        });

        return NextResponse.json({ status: 'success', data: { milestone: serializeDeliveryMilestone(updated) } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleReleasePartialPayment(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = ReleasePartialSchema.parse(await request.json());
        const state = await loadEscrowState(rfqId);
        const milestone = data.milestoneId ? state.milestones.find((item) => item.id === data.milestoneId) : null;
        if (!state.rfq || !state.escrow || state.rfq.buyer !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the creator can release escrow.' } }, { status: 403 });
        }

        const remaining = state.escrow.totalAmount - state.releasedAmount;
        const transition = partialTransition(state.chain.escrowToken);

        if (!data.txHash) {
            if (state.chain.status !== RFQ_STATUS.ESCROW_FUNDED || state.chain.paid) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Partial releases are only available before invoice payment.' } }, { status: 400 });
            }
            if (data.amount <= 0n || data.amount > remaining) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_AMOUNT', message: `Amount must be between 1 and ${remaining}.` } }, { status: 400 });
            }
            if (data.milestoneId) {
                if (!milestone) {
                    return NextResponse.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'Selected milestone does not exist.' } }, { status: 404 });
                }
                if (milestone.status !== DELIVERY_MILESTONE_STATUS.APPROVED || milestone.releaseTxId) {
                    return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Only approved, unreleased milestones can drive a release.' } }, { status: 409 });
                }
                if (milestone.targetAmount !== data.amount) {
                    return NextResponse.json({ status: 'error', error: { code: 'INVALID_AMOUNT', message: 'Release amount must match the approved milestone amount exactly.' } }, { status: 400 });
                }
            }
            const scaled = data.amount * 100n;
            if (scaled % remaining !== 0n) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_AMOUNT', message: 'Partial releases must resolve to an exact integer percentage of the remaining escrow.' } }, { status: 400 });
            }

            const percentage = Number(scaled / remaining);
            if (percentage <= 0 || percentage > 100) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_AMOUNT', message: 'Partial release percentage must be between 1 and 100.' } }, { status: 400 });
            }

            const feeBps = feeBpsForToken(state.chain.escrowToken, state.platform.feeBps);
            const newTotalReleased = state.releasedAmount + data.amount;
            const userNonce = await nextActionNonce(auth.walletAddress, rfqId, transition.actionTag);
            const idempotencyKey = `release_partial_${rfqId}_${crypto.randomUUID()}`;
            const canonicalKey = canonicalActionKey(`nonce:${transition.actionTag}`, auth.walletAddress, rfqId, `partial_${newTotalReleased}`);
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: transition.fn,
                inputs: [
                    rfqId,
                    state.chain.winner ?? '',
                    `${data.amount}u64`,
                    `${percentage}u8`,
                    `${newTotalReleased}u64`,
                    `${feeBps}u64`,
                    `${userNonce}u64`,
                ],
                fee: estimateFee(transition.fn),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({ status: 'success', data: { tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) } } });
        }

        const existingPayment = await prisma.payment.findFirst({
            where: { releasedTxId: data.txHash },
            select: { id: true },
        });
        if (existingPayment) {
            return NextResponse.json({ status: 'success', data: { txHash: data.txHash } });
        }
        if (data.milestoneId) {
            if (!milestone) {
                return NextResponse.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'Selected milestone does not exist.' } }, { status: 404 });
            }
            if (milestone.releaseTxId) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Milestone is already linked to a release.' } }, { status: 409 });
            }
        }

        const boundedNewTotalRaw = state.releasedAmount + data.amount;
        const boundedNewTotal =
            boundedNewTotalRaw > state.escrow.totalAmount ? state.escrow.totalAmount : boundedNewTotalRaw;
        const isFinal = boundedNewTotal >= state.escrow.totalAmount || state.chain.status === RFQ_STATUS.COMPLETED;

        await prisma.$transaction([
            prisma.payment.create({
                data: {
                    rfqId,
                    recipient: state.chain.winner ?? '',
                    amount: data.amount,
                    isFinal: false,
                    releasedBlock: state.currentBlock,
                    releasedTxId: data.txHash,
                    releasedEventIdx: 0,
                },
            }),
            ...(data.milestoneId
                ? [
                      prisma.deliveryMilestone.update({
                          where: { id: data.milestoneId },
                          data: {
                              status: DELIVERY_MILESTONE_STATUS.RELEASED,
                              releaseTxId: data.txHash,
                              reviewedAt: new Date(),
                          },
                      }),
                  ]
                : []),
            prisma.escrow.update({
                where: { rfqId },
                data: { releasedAmount: boundedNewTotal, isFinal },
            }),
            ...(isFinal
                ? [
                      prisma.rFQ.update({
                          where: { id: rfqId },
                          data: { status: RFQ_STATUS.COMPLETED },
                      }),
                  ]
                : []),
        ]);

        return NextResponse.json({ status: 'success', data: { txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleRecoverEscrowBond(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const txHash = typeof body?.txHash === 'string' ? body.txHash : undefined;
    const state = await loadEscrowState(rfqId);
    if (!state.rfq || !state.escrow || state.rfq.buyer !== auth.walletAddress) {
        return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the creator can recover the escrow bond.' } }, { status: 403 });
    }

    const remaining = state.escrow.totalAmount - state.releasedAmount;
    const transition = finalTransition(state.chain.escrowToken);

    if (!txHash) {
        if (state.chain.status !== RFQ_STATUS.ESCROW_FUNDED || !state.chain.paid || remaining <= 0n) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Escrow bond recovery is only available after invoice payment.' } }, { status: 400 });
        }

        const feeBps = feeBpsForToken(state.chain.escrowToken, state.platform.feeBps);
        const userNonce = await nextActionNonce(auth.walletAddress, rfqId, transition.actionTag);
        const idempotencyKey = `recover_bond_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = canonicalActionKey(`nonce:${transition.actionTag}`, auth.walletAddress, rfqId, 'recover_bond');
        const tx: AleoTransaction = {
            program: PROGRAM_IDS.rfq,
            function: transition.fn,
            inputs: [rfqId, state.chain.winner ?? '', `${remaining}u64`, `${feeBps}u64`, `${userNonce}u64`],
            fee: estimateFee(transition.fn),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
        return NextResponse.json({ status: 'success', data: { tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) } } });
    }

    const existingPayment = await prisma.payment.findFirst({
        where: { releasedTxId: txHash },
        select: { id: true },
    });
    if (existingPayment) {
        return NextResponse.json({ status: 'success', data: { txHash } });
    }

    if (remaining <= 0n) {
        await prisma.$transaction([
            prisma.escrow.update({
                where: { rfqId },
                data: { releasedAmount: state.escrow.totalAmount, isFinal: true },
            }),
            prisma.rFQ.update({
                where: { id: rfqId },
                data: { status: RFQ_STATUS.COMPLETED },
            }),
        ]);
        return NextResponse.json({ status: 'success', data: { txHash } });
    }

    await prisma.$transaction([
        prisma.payment.create({
            data: {
                rfqId,
                recipient: state.rfq.buyer,
                amount: remaining,
                isFinal: true,
                releasedBlock: state.currentBlock,
                releasedTxId: txHash,
                releasedEventIdx: 0,
            },
        }),
        prisma.escrow.update({
            where: { rfqId },
            data: { releasedAmount: state.escrow.totalAmount, isFinal: true },
        }),
        prisma.rFQ.update({
            where: { id: rfqId },
            data: { status: RFQ_STATUS.COMPLETED },
        }),
    ]);

    return NextResponse.json({ status: 'success', data: { txHash } });
}

export async function handlePayInvoice(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = InvoiceSchema.parse(await request.json());
        const state = await loadEscrowState(rfqId);
        if (!state.rfq || !state.escrow || state.rfq.buyer !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the creator can pay the invoice.' } }, { status: 403 });
        }

        const amount = state.winningAmount;
        const transition = invoiceTransition(state.chain.escrowToken);
        const txHash = data.txHash;

        if (!txHash) {
            if (state.chain.status !== RFQ_STATUS.ESCROW_FUNDED || state.chain.paid || state.releasedAmount > 0n) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Invoice payment is only available before any public release.' } }, { status: 400 });
            }

            const userNonce = await nextActionNonce(auth.walletAddress, rfqId, transition.actionTag);
            const idempotencyKey = `pay_invoice_${rfqId}_${crypto.randomUUID()}`;
            const canonicalKey = canonicalActionKey(`nonce:${transition.actionTag}`, auth.walletAddress, rfqId, 'invoice');
            const tx: AleoTransaction = {
                program: transition.program,
                function: transition.fn,
                inputs: [
                    rfqId,
                    state.chain.winner ?? '',
                    `${amount}u64`,
                    `${userNonce}u64`,
                    data.receiptNonce,
                    // paymentRecord (pos 5) and MerkleProofs (pos 6, stablecoin only) are injected
                    // client-side by the frontend using Shield wallet records.
                ],
                fee: estimateFee(transition.fn),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({ status: 'success', data: { tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) } } });
        }

        if (state.rfq.paid || state.chain.paid) {
            return NextResponse.json({
                status: 'success',
                data: {
                    txHash,
                    receiptHash: state.rfq.receiptHash ?? state.chain.receiptHash ?? null,
                    paymentCommitment: null,
                },
            });
        }

        const receiptHash = await deriveReceiptHash(
            rfqId,
            auth.walletAddress,
            state.chain.winner ?? '',
            amount,
            data.receiptNonce,
        );
        await prisma.rFQ.update({
            where: { id: rfqId },
            data: { paid: true, receiptHash },
        });
        return NextResponse.json({
            status: 'success',
            data: {
                txHash,
                receiptHash,
                paymentCommitment: null,
            },
        });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleWinnerClaimEscrow(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const txHash = typeof body?.txHash === 'string' ? body.txHash : undefined;
    const state = await loadEscrowState(rfqId);

    if (!state.rfq || !state.escrow || state.chain.winner !== auth.walletAddress) {
        return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the winner can claim escrow.' } }, { status: 403 });
    }

    const remaining = state.escrow.totalAmount - state.releasedAmount;
    const mode = state.releasedAmount > 0n ? 1 : 0;
    const recoveryBlock = (state.chain.lifecycleBlock ?? 0) + TIMING.ESCROW_RECOVERY_BLOCKS;
    const transition = winnerClaimTransition(state.chain.escrowToken);
    if (!txHash) {
        if (state.chain.status !== RFQ_STATUS.ESCROW_FUNDED || state.chain.paid || state.currentBlock <= recoveryBlock || remaining <= 0n) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Winner claim is not available yet.' } }, { status: 400 });
        }

        const idempotencyKey = `winner_claim_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = `winner_claim:${rfqId}:${mode}`;
        const tx: AleoTransaction = {
            program: PROGRAM_IDS.rfq,
            function: transition,
            inputs: [rfqId, `${remaining}u64`, `${mode}u8`],
            fee: estimateFee(transition),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
        return NextResponse.json({ status: 'success', data: { tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) } } });
    }

    const existingPayment = await prisma.payment.findFirst({
        where: { releasedTxId: txHash },
        select: { id: true },
    });
    if (existingPayment) {
        return NextResponse.json({ status: 'success', data: { txHash, mode } });
    }

    if (remaining <= 0n) {
        await prisma.$transaction([
            prisma.escrow.update({
                where: { rfqId },
                data: { releasedAmount: state.escrow.totalAmount, isFinal: true },
            }),
            prisma.rFQ.update({
                where: { id: rfqId },
                data: { status: RFQ_STATUS.COMPLETED },
            }),
        ]);
        return NextResponse.json({ status: 'success', data: { txHash, mode } });
    }

    await prisma.$transaction([
        prisma.payment.create({
            data: {
                rfqId,
                recipient: auth.walletAddress,
                amount: remaining,
                isFinal: true,
                releasedBlock: state.currentBlock,
                releasedTxId: txHash,
                releasedEventIdx: 0,
            },
        }),
        prisma.escrow.update({
            where: { rfqId },
            data: { releasedAmount: state.escrow.totalAmount, isFinal: true },
        }),
        prisma.rFQ.update({
            where: { id: rfqId },
            data: { status: RFQ_STATUS.COMPLETED },
        }),
    ]);

    return NextResponse.json({ status: 'success', data: { txHash, mode } });
}

export async function handleCreatorReclaimEscrow(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const txHash = typeof body?.txHash === 'string' ? body.txHash : undefined;
    const state = await loadEscrowState(rfqId);

    if (!state.rfq || !state.escrow || state.rfq.buyer !== auth.walletAddress) {
        return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the creator can reclaim escrow.' } }, { status: 403 });
    }

    const remaining = state.escrow.totalAmount - state.releasedAmount;
    const recoveryBlock = (state.chain.lifecycleBlock ?? 0) + TIMING.ESCROW_RECOVERY_BLOCKS;
    const transition = creatorReclaimTransition(state.chain.escrowToken);
    if (!txHash) {
        if (state.chain.status !== RFQ_STATUS.ESCROW_FUNDED || state.chain.paid || state.currentBlock <= recoveryBlock || remaining <= 0n) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Creator reclaim is not available yet.' } }, { status: 400 });
        }

        const idempotencyKey = `creator_reclaim_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = `creator_reclaim:${rfqId}`;
        const tx: AleoTransaction = {
            program: PROGRAM_IDS.rfq,
            function: transition,
            inputs: [rfqId, `${remaining}u64`],
            fee: estimateFee(transition),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
        return NextResponse.json({ status: 'success', data: { tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) } } });
    }

    if (remaining <= 0n) {
        await prisma.$transaction([
            prisma.escrow.update({
                where: { rfqId },
                data: { releasedAmount: state.escrow.totalAmount, isFinal: true },
            }),
            prisma.rFQ.update({
                where: { id: rfqId },
                data: { status: RFQ_STATUS.CANCELLED },
            }),
        ]);
        return NextResponse.json({ status: 'success', data: { txHash } });
    }

    await prisma.$transaction([
        prisma.escrow.update({
            where: { rfqId },
            data: { releasedAmount: state.escrow.totalAmount, isFinal: true },
        }),
        prisma.rFQ.update({
            where: { id: rfqId },
            data: { status: RFQ_STATUS.CANCELLED },
        }),
    ]);

    return NextResponse.json({ status: 'success', data: { txHash } });
}

export async function handleGetAuditTrail(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const url = new URL(request.url);
    const rfqId = url.searchParams.get('rfqId') || undefined;
    const txs = await prisma.transaction.findMany({
        where: rfqId ? { canonicalTxKey: { contains: rfqId } } : undefined,
        orderBy: { preparedAt: 'desc' },
        take: 100,
    });

    return NextResponse.json({
        status: 'success',
        data: txs.map((tx) => ({
            id: tx.id,
            transition: tx.transition,
            txHash: tx.txHash,
            status: tx.status,
            preparedAt: tx.preparedAt,
            submittedAt: tx.submittedAt,
            confirmedAt: tx.confirmedAt,
            canonicalTxKey: tx.canonicalTxKey,
        })),
    });
}

export const handleReleasePayment = handleReleasePartialPayment;
