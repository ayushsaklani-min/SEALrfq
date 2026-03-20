import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '../../auth/middleware';
import type { AleoTransaction } from '../../lib/types';
import {
    buildWalletTxRequest,
    canonicalActionKey,
    escrowFundingTransition,
    estimateFee,
    FundEscrowSchema,
    getCurrentBlockHeight,
    getRfqChainState,
    getWinningAmountFromChain,
    ImportAuctionSchema,
    prepareTrackedTransition,
    PRICING_MODE,
    prisma,
    PROGRAM_IDS,
    resolveCancelMode,
    RFQ_STATUS,
    SelectWinnerSchema,
    StakeActionSchema,
    TIMING,
    TOKEN_TYPE,
    WinnerRespondSchema,
    winnerCertificate,
} from './common';

export async function handleSelectWinner(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = SelectWinnerSchema.parse(await request.json());
        const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });
        const bid = await prisma.bid.findUnique({ where: { id: data.winningBidId } });

        if (!rfq || !bid || bid.rfqId !== rfqId || !bid.isRevealed || !bid.revealedAmount) {
            return NextResponse.json(
                { status: 'error', error: { code: 'INVALID_BID', message: 'Winning bid must be a revealed bid on this RFQ.' } },
                { status: 400 },
            );
        }
        if (rfq.buyer !== auth.walletAddress) {
            return NextResponse.json(
                { status: 'error', error: { code: 'FORBIDDEN', message: 'Only the RFQ creator can select the winner.' } },
                { status: 403 },
            );
        }

        const chain = await getRfqChainState(rfqId);
        const currentBlock = await getCurrentBlockHeight();
        if (chain.status !== RFQ_STATUS.REVEAL || (chain.revealDeadline && currentBlock < chain.revealDeadline)) {
            return NextResponse.json(
                { status: 'error', error: { code: 'INVALID_STATE', message: 'Winner selection is locked until the reveal window ends.' } },
                { status: 400 },
            );
        }

        if (!data.txHash) {
            const idempotencyKey = `select_winner_${rfqId}_${crypto.randomUUID()}`;
            const canonicalKey = `select_winner:${rfqId}`;
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: 'select_winner',
                inputs: [rfqId, bid.id, `${bid.revealedAmount}u64`, bid.vendor],
                fee: estimateFee('select_winner'),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({
                status: 'success',
                data: {
                    rfq_id: rfqId,
                    winning_bid_id: bid.id,
                    winner_certificate: await winnerCertificate(rfqId, bid.id, bid.vendor),
                    tx: {
                        idempotencyKey,
                        canonicalTxKey: canonicalKey,
                        request: buildWalletTxRequest(tx),
                    },
                },
            });
        }

        await prisma.$transaction([
            prisma.bid.updateMany({ where: { rfqId }, data: { isWinner: false } }),
            prisma.bid.update({ where: { id: bid.id }, data: { isWinner: true } }),
            prisma.rFQ.update({ where: { id: rfqId }, data: { status: RFQ_STATUS.WINNER_SELECTED } }),
        ]);

        return NextResponse.json({
            status: 'success',
            data: {
                rfq_id: rfqId,
                winning_bid_id: bid.id,
                txHash: data.txHash,
                winner_certificate: await winnerCertificate(rfqId, bid.id, bid.vendor),
            },
        });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleWinnerRespond(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = WinnerRespondSchema.parse(await request.json());
        const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });
        const winningBid = await prisma.bid.findFirst({ where: { rfqId, isWinner: true } });
        const chain = await getRfqChainState(rfqId);
        const chainImported = Boolean(chain.auctionSource) && chain.pricingMode !== PRICING_MODE.RFQ;
        // Detect imported-auction winner from either on-chain state OR the DB
        // bid record (which has stake=0 and commitmentHash matching auctionId).
        const dbImported = winningBid !== null && winningBid.stake === BigInt(0);
        const importedWinner = chainImported || dbImported;
        const winnerAddress = winningBid?.vendor ?? (importedWinner ? chain.winner : null);
        const responseStake = winningBid?.stake ?? (importedWinner ? BigInt(0) : null);

        if (!rfq || winnerAddress !== auth.walletAddress || responseStake === null) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the selected vendor can respond.' } }, { status: 403 });
        }
        if (importedWinner && responseStake === 0n && PROGRAM_IDS.rfq === 'sealrfq_v16.aleo') {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'UNSUPPORTED_ONCHAIN_STATE',
                        message: 'Imported-auction winners on the deployed v16 RFQ cannot respond because the contract still attempts a zero-value stake transfer. Redeploy the RFQ fix under a new version before continuing.',
                    },
                },
                { status: 409 },
            );
        }

        if (!data.txHash) {
            const idempotencyKey = `winner_respond_${rfqId}_${crypto.randomUUID()}`;
            const canonicalKey = canonicalActionKey('winner_respond', auth.walletAddress, rfqId, data.accept ? 'accept' : 'decline');
            const isImportedNoStake = importedWinner && responseStake === 0n;
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: isImportedNoStake ? 'winner_respond_imported' : 'winner_respond',
                inputs: isImportedNoStake
                    ? [rfqId, data.accept ? 'true' : 'false', rfq.buyer]
                    : [rfqId, data.accept ? 'true' : 'false', `${responseStake}u64`, rfq.buyer],
                fee: estimateFee('winner_respond'),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({
                status: 'success',
                data: {
                    rfq_id: rfqId,
                    accept: data.accept,
                    tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) },
                },
            });
        }

        await prisma.rFQ.update({
            where: { id: rfqId },
            data: { status: data.accept ? RFQ_STATUS.WINNER_SELECTED : RFQ_STATUS.WINNER_DECLINED },
        });

        return NextResponse.json({ status: 'success', data: { rfq_id: rfqId, accept: data.accept, txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleCancelRFQ(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });
    if (!rfq) return NextResponse.json({ status: 'error', error: { code: 'NOT_FOUND', message: 'RFQ not found' } }, { status: 404 });

    const resolved = await resolveCancelMode(rfqId, rfq.buyer, auth.walletAddress);
    if (!resolved) {
        return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'No cancel mode is currently available.' } }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const txHash = typeof body?.txHash === 'string' ? body.txHash : undefined;

    if (!txHash) {
        const idempotencyKey = `cancel_rfq_${rfqId}_${crypto.randomUUID()}`;
        const canonicalKey = `cancel_rfq_post_deadline:${rfqId}:${resolved.mode}`;
        const tx: AleoTransaction = {
            program: PROGRAM_IDS.rfq,
            function: 'cancel_rfq_post_deadline',
            inputs: [rfqId, resolved.creator, `${resolved.mode}u8`],
            fee: estimateFee('cancel_rfq_post_deadline'),
        };

        await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
        return NextResponse.json({ status: 'success', data: { rfq_id: rfqId, mode: resolved.mode, tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) } } });
    }

    await prisma.rFQ.update({ where: { id: rfqId }, data: { status: RFQ_STATUS.CANCELLED } });
    return NextResponse.json({ status: 'success', data: { rfq_id: rfqId, mode: resolved.mode, txHash } });
}

export async function handleClaimStake(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = StakeActionSchema.parse(await request.json());
        const bid = await prisma.bid.findUnique({ where: { id: data.bidId } });
        const chain = await getRfqChainState(rfqId);
        const currentBlock = await getCurrentBlockHeight();

        if (!bid || bid.rfqId !== rfqId || bid.vendor !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the bidder can claim this stake.' } }, { status: 403 });
        }

        const eligible =
            chain.status === RFQ_STATUS.CANCELLED ||
            (!bid.isWinner &&
                ((chain.status === RFQ_STATUS.REVEAL && chain.revealDeadline !== null && currentBlock > chain.revealDeadline + TIMING.SLASH_WINDOW) ||
                    chain.status === RFQ_STATUS.WINNER_SELECTED ||
                    chain.status === RFQ_STATUS.ESCROW_FUNDED ||
                    chain.status === RFQ_STATUS.COMPLETED ||
                    chain.status === RFQ_STATUS.WINNER_DECLINED));

        if (!eligible) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Stake refund is not currently available.' } }, { status: 400 });
        }

        const stake = data.stake ?? bid.stake;
        if (!data.txHash) {
            const idempotencyKey = `refund_any_stake_${data.bidId}_${crypto.randomUUID()}`;
            const canonicalKey = canonicalActionKey('refund_any_stake', auth.walletAddress, rfqId, data.bidId);
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: 'refund_any_stake',
                inputs: [rfqId, data.bidId, `${stake}u64`],
                fee: estimateFee('refund_any_stake'),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({ status: 'success', data: { bid_id: data.bidId, tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) } } });
        }

        await prisma.bid.update({ where: { id: data.bidId }, data: { isRefunded: true, stake: BigInt(0) } });
        return NextResponse.json({ status: 'success', data: { bid_id: data.bidId, txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleSlashNonRevealer(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = StakeActionSchema.parse(await request.json());
        const bid = await prisma.bid.findUnique({ where: { id: data.bidId } });
        const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });
        const chain = await getRfqChainState(rfqId);
        const currentBlock = await getCurrentBlockHeight();

        if (!bid || !rfq || bid.rfqId !== rfqId || rfq.buyer !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the creator can slash non-revealers.' } }, { status: 403 });
        }
        if (
            bid.isRevealed ||
            (chain.status !== RFQ_STATUS.REVEAL && chain.status !== RFQ_STATUS.WINNER_SELECTED) ||
            !chain.revealDeadline ||
            currentBlock <= chain.revealDeadline ||
            currentBlock > chain.revealDeadline + TIMING.SLASH_WINDOW
        ) {
            return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Slash window is not open for this bid.' } }, { status: 400 });
        }

        const stake = data.stake ?? bid.stake;
        if (!data.txHash) {
            const idempotencyKey = `slash_non_revealer_${data.bidId}_${crypto.randomUUID()}`;
            const canonicalKey = canonicalActionKey('slash_non_revealer', auth.walletAddress, rfqId, data.bidId);
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: 'slash_non_revealer',
                inputs: [rfqId, data.bidId, `${stake}u64`],
                fee: estimateFee('slash_non_revealer'),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({ status: 'success', data: { bid_id: data.bidId, tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) } } });
        }

        await prisma.bid.update({ where: { id: data.bidId }, data: { isSlashed: true, stake: BigInt(0) } });
        return NextResponse.json({ status: 'success', data: { bid_id: data.bidId, txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleFundEscrow(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = FundEscrowSchema.parse(await request.json());
        const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });

        if (!rfq || rfq.buyer !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the creator can fund escrow.' } }, { status: 403 });
        }

        if (!data.txHash) {
            // Prepare path: validate on-chain state before returning tx request.
            const chain = await getRfqChainState(rfqId);
            const winningAmount = await getWinningAmountFromChain(rfqId);

            if (chain.status !== RFQ_STATUS.WINNER_SELECTED || !chain.winnerAccepted) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Winner must accept before escrow funding.' } }, { status: 400 });
            }
            if (winningAmount && data.amount.toString() !== winningAmount) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_AMOUNT', message: `Escrow amount must equal ${winningAmount}.` } }, { status: 400 });
            }

            const transition = escrowFundingTransition(chain.escrowToken);
            const idempotencyKey = `fund_escrow_${rfqId}_${crypto.randomUUID()}`;
            const canonicalKey = `fund_escrow:${rfqId}:${transition}`;
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: transition,
                inputs: [rfqId, `${data.amount}u64`],
                fee: estimateFee(transition),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({ status: 'success', data: { rfq_id: rfqId, amount: data.amount.toString(), transition, tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) } } });
        }

        // Confirm path: the on-chain contract already validated all guards.
        const transition = escrowFundingTransition(TOKEN_TYPE.CREDITS);
        const currentBlock = await getCurrentBlockHeight();
        const escrow = await prisma.escrow.findUnique({ where: { rfqId } });
        if (!escrow) {
            await prisma.escrow.create({
                data: {
                    rfqId,
                    totalAmount: data.amount,
                    releasedAmount: BigInt(0),
                    isFinal: false,
                    fundedBlock: currentBlock,
                    fundedTxId: data.txHash,
                    fundedEventIdx: 0,
                },
            });
        }
        await prisma.rFQ.update({ where: { id: rfqId }, data: { status: RFQ_STATUS.ESCROW_FUNDED } });
        return NextResponse.json({ status: 'success', data: { rfq_id: rfqId, amount: data.amount.toString(), txHash: data.txHash, transition } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleImportAuctionResult(request: NextRequest, rfqId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = ImportAuctionSchema.parse(await request.json());
        const rfq = await prisma.rFQ.findUnique({ where: { id: rfqId } });

        if (!rfq || rfq.buyer !== auth.walletAddress) {
            return NextResponse.json({ status: 'error', error: { code: 'FORBIDDEN', message: 'Only the creator can import auction results.' } }, { status: 403 });
        }

        if (!data.txHash) {
            // Prepare path: validate on-chain state before returning tx request.
            const chain = await getRfqChainState(rfqId);
            const currentBlock = await getCurrentBlockHeight();

            if (chain.pricingMode === PRICING_MODE.RFQ || chain.pricingMode !== data.auctionType) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Auction import is not available for this RFQ.' } }, { status: 400 });
            }
            if (chain.status !== RFQ_STATUS.OPEN) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Auction import is not available for this RFQ.' } }, { status: 400 });
            }
            if (BigInt(chain.bidCount ?? '0') !== 0n || chain.auctionSource || (chain.revealDeadline && currentBlock > chain.revealDeadline)) {
                return NextResponse.json({ status: 'error', error: { code: 'INVALID_STATE', message: 'Auction result cannot be imported at this stage.' } }, { status: 400 });
            }

            const idempotencyKey = `import_auction_${rfqId}_${crypto.randomUUID()}`;
            const canonicalKey = `import_auction_result:${rfqId}`;
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: 'import_auction_result',
                inputs: [rfqId, data.auctionId, data.winnerAddress, `${data.price}u64`, `${data.auctionType}u8`],
                fee: estimateFee('import_auction_result'),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({ status: 'success', data: { rfq_id: rfqId, tx: { idempotencyKey, canonicalTxKey: canonicalKey, request: buildWalletTxRequest(tx) } } });
        }

        // Confirm path: the on-chain contract already validated all guards.
        const currentBlock = await getCurrentBlockHeight();
        const importedBidId = data.auctionId;
        const importedAmount = BigInt(data.price);
        await prisma.$transaction([
            prisma.bid.updateMany({ where: { rfqId }, data: { isWinner: false } }),
            prisma.bid.upsert({
                where: { id: importedBidId },
                update: {
                    rfqId,
                    vendor: data.winnerAddress,
                    commitmentHash: data.auctionId,
                    stake: BigInt(0),
                    revealedAmount: importedAmount,
                    isWinner: true,
                    isRevealed: true,
                    isSlashed: false,
                    isRefunded: false,
                    revealedBlock: currentBlock,
                },
                create: {
                    id: importedBidId,
                    rfqId,
                    vendor: data.winnerAddress,
                    commitmentHash: data.auctionId,
                    stake: BigInt(0),
                    revealedAmount: importedAmount,
                    isWinner: true,
                    isRevealed: true,
                    isSlashed: false,
                    isRefunded: false,
                    createdBlock: currentBlock,
                    revealedBlock: currentBlock,
                    createdTxId: data.txHash,
                    createdEventIdx: 0,
                },
            }),
            prisma.rFQ.update({ where: { id: rfqId }, data: { status: RFQ_STATUS.WINNER_SELECTED } }),
        ]);
        return NextResponse.json({ status: 'success', data: { rfq_id: rfqId, txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}
