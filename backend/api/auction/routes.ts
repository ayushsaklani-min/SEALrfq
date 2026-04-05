import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireRole } from '../../auth/middleware';
import { estimateFee } from '../../aleo/fees';
import { getCurrentBlockHeight } from '../../aleo/executor';
import { TransactionTracker } from '../../tx/tracker';
import type { AleoTransaction } from '../../lib/types';
import { deriveAuctionId, getAuctionState, PROGRAM_IDS, randomField, TOKEN_TYPE } from '../../lib/sealProtocol';

const prisma = new PrismaClient();
const tracker = new TransactionTracker(prisma);
const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'testnet';
const DEMO_MODE = process.env.DEMO_MODE === 'true';

const fieldSchema = (label: string) =>
    z.string().trim().regex(/^\d+field$/, `${label} must be a full Aleo field such as 123field.`);

function validationMessage(error: unknown, fallback: string) {
    if (error instanceof z.ZodError) {
        return error.issues[0]?.message || fallback;
    }
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return fallback;
}

const CreateVickreySchema = z.object({
    auctionId: fieldSchema('Auction id').optional(),
    salt: fieldSchema('Salt'),
    rfqId: fieldSchema('Linked RFQ id'),
    tokenType: z.number().int().min(0).max(2),
    biddingDeadline: z.number().int().positive(),
    revealDeadline: z.number().int().positive(),
    minBid: z.string().regex(/^\d+$/),
    txHash: z.string().optional(),
});

const VickreyCommitSchema = z.object({
    bidAmount: z.string().regex(/^\d+$/),
    salt: fieldSchema('Salt'),
    stake: z.string().regex(/^\d+$/),
    bidId: fieldSchema('Bid id').optional(),
    txHash: z.string().optional(),
});

const VickreyRevealSchema = z.object({
    bidId: fieldSchema('Bid id'),
    amount: z.string().regex(/^\d+$/),
    salt: fieldSchema('Salt'),
    txHash: z.string().optional(),
});

const CreateDutchSchema = z.object({
    auctionId: fieldSchema('Auction id').optional(),
    salt: fieldSchema('Salt'),
    rfqId: fieldSchema('Linked RFQ id'),
    tokenType: z.number().int().min(0).max(2),
    startPrice: z.string().regex(/^\d+$/),
    reservePrice: z.string().regex(/^\d+$/),
    decrementPerBlock: z.string().regex(/^\d+$/),
    startBlock: z.number().int().positive(),
    endBlock: z.number().int().positive(),
    txHash: z.string().optional(),
});

const DutchAcceptSchema = z.object({
    salt: fieldSchema('Salt'),
    txHash: z.string().optional(),
});

const DutchAcceptPriceSchema = z.object({
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

async function prepareAuctionTx(tx: AleoTransaction, prefix: string, canonicalKey: string) {
    const idempotencyKey = `${prefix}_${crypto.randomUUID()}`;
    await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
    return {
        idempotencyKey,
        canonicalTxKey: canonicalKey,
        request: buildWalletTxRequest(tx),
    };
}

async function listCreatedAuctionIds(prefix: string) {
    const transactions = await prisma.transaction.findMany({
        where: {
            canonicalTxKey: {
                startsWith: prefix,
            },
        },
        orderBy: {
            preparedAt: 'desc',
        },
        take: 100,
    });

    const uniqueIds = new Set<string>();
    for (const transaction of transactions) {
        const auctionId = transaction.canonicalTxKey.slice(prefix.length);
        if (auctionId) {
            uniqueIds.add(auctionId);
        }
    }

    return Array.from(uniqueIds);
}

export async function handleListVickreyAuctions(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const auctionIds = await listCreatedAuctionIds('vickrey:create:');
    const auctions = await Promise.all(auctionIds.map((auctionId) => getAuctionState('vickrey', auctionId)));
    return NextResponse.json({ status: 'success', data: auctions });
}

export async function handleGetVickreyAuction(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;
    return NextResponse.json({ status: 'success', data: await getAuctionState('vickrey', auctionId) });
}

export async function handleCreateVickreyAuction(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = CreateVickreySchema.parse(await request.json());
        const auctionId = await deriveAuctionId(auth.walletAddress, data.salt);
        if (data.auctionId && data.auctionId !== auctionId) {
            return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: 'Supplied auction id does not match the v2 derived id for this wallet and salt.' } }, { status: 400 });
        }
        if (!data.txHash) {
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.vickrey,
                function: 'create_auction',
                inputs: [
                    auctionId,
                    data.salt,
                    data.rfqId,
                    `${data.biddingDeadline}u32`,
                    `${data.revealDeadline}u32`,
                    `${data.minBid}u64`,
                    `${data.tokenType}u8`,
                ],
                fee: estimateFee('create_auction'),
            };
            const prepared = await prepareAuctionTx(tx, 'create_vickrey', `vickrey:create:${auctionId}`);
            return NextResponse.json({ status: 'success', data: { auctionId, tx: prepared } });
        }

        return NextResponse.json({ status: 'success', data: { auctionId, txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: validationMessage(error, 'Failed to create Vickrey auction.') } },
            { status: 400 },
        );
    }
}

export async function handleVickreyCommitBid(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = VickreyCommitSchema.parse(await request.json());
        const [auction, currentBlock] = await Promise.all([getAuctionState('vickrey', auctionId), getCurrentBlockHeight()]);
        const bidAmount = BigInt(data.bidAmount);
        const postedStake = BigInt(data.stake);
        const flatStake = auction.flatStake ? BigInt(auction.flatStake) : 0n;
        const revealStakeFloor = bidAmount / 10n;
        const revealRequiredStake = revealStakeFloor > 0n ? revealStakeFloor : 1n;
        const requiredStake = flatStake > revealRequiredStake ? flatStake : revealRequiredStake;

        if (bidAmount <= 0n) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_AMOUNT',
                        message: 'Bid amount must be greater than zero.',
                    },
                },
                { status: 400 },
            );
        }
        if (auction.statusCode !== 1) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STATE',
                        message: 'This auction is not accepting commit bids anymore.',
                    },
                },
                { status: 400 },
            );
        }
        if (auction.biddingDeadline && currentBlock >= auction.biddingDeadline) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'DEADLINE_PASSED',
                        message: `Commit phase closed at block ${auction.biddingDeadline}.`,
                    },
                },
                { status: 400 },
            );
        }
        if (postedStake < requiredStake) {
            return NextResponse.json(
                {
                    status: 'error',
                    error: {
                        code: 'INVALID_STAKE',
                        message: `Stake must be at least ${requiredStake.toString()} microcredits for this bid.`,
                    },
                },
                { status: 400 },
            );
        }

        const bidId = data.bidId ?? randomField();
        if (!data.txHash) {
            const tokenType = auction.tokenType ?? TOKEN_TYPE.CREDITS;
            const commitFn = tokenType === TOKEN_TYPE.USDCX ? 'commit_bid_usdcx'
                : tokenType === TOKEN_TYPE.USAD ? 'commit_bid_usad'
                : 'commit_bid';
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.vickrey,
                function: commitFn,
                inputs: [auctionId, `${data.bidAmount}u64`, data.salt, `${data.stake}u64`, bidId],
                fee: estimateFee(commitFn),
            };
            const prepared = await prepareAuctionTx(tx, 'vickrey_commit', `vickrey:commit:${auctionId}:${bidId}`);
            return NextResponse.json({ status: 'success', data: { bidId, tx: prepared } });
        }

        return NextResponse.json({ status: 'success', data: { bidId, txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: validationMessage(error, 'Failed to commit bid.') } },
            { status: 400 },
        );
    }
}

export async function handleVickreyRevealBid(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = VickreyRevealSchema.parse(await request.json());
        if (!data.txHash) {
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.vickrey,
                function: 'reveal_bid',
                inputs: [auctionId, data.bidId, `${data.amount}u64`, data.salt],
                fee: estimateFee('reveal_bid'),
            };
            const prepared = await prepareAuctionTx(tx, 'vickrey_reveal', `vickrey:reveal:${auctionId}:${data.bidId}`);
            return NextResponse.json({ status: 'success', data: { bidId: data.bidId, tx: prepared } });
        }

        return NextResponse.json({ status: 'success', data: { bidId: data.bidId, txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: validationMessage(error, 'Failed to reveal bid.') } },
            { status: 400 },
        );
    }
}

export async function handleFinalizeVickreyAuction(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const txHash = typeof body?.txHash === 'string' ? body.txHash : undefined;
    if (!txHash) {
        const tx: AleoTransaction = {
            program: PROGRAM_IDS.vickrey,
            function: 'finalize_auction',
            inputs: [auctionId],
            fee: estimateFee('finalize_auction'),
        };
        const prepared = await prepareAuctionTx(tx, 'vickrey_finalize', `vickrey:finalize:${auctionId}`);
        return NextResponse.json({ status: 'success', data: { tx: prepared } });
    }
    return NextResponse.json({ status: 'success', data: { txHash } });
}

export async function handleListDutchAuctions(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const auctionIds = await listCreatedAuctionIds('dutch:create:');
    const currentBlock = await getCurrentBlockHeight();
    const auctions = await Promise.all(
        auctionIds.map(async (auctionId) => {
            const auction = await getAuctionState('dutch', auctionId);
            const startPrice = BigInt(auction.startPrice ?? '0');
            const reservePrice = BigInt(auction.reservePrice ?? '0');
            const decrement = BigInt(auction.priceDecrement ?? '0');
            const startBlock = BigInt(auction.startBlock ?? currentBlock);
            const elapsed = currentBlock > Number(startBlock) ? BigInt(currentBlock) - startBlock : 0n;
            const raw = startPrice > decrement * elapsed ? startPrice - decrement * elapsed : reservePrice;
            const currentPrice = raw > reservePrice ? raw : reservePrice;

            return {
                ...auction,
                currentBlock,
                currentPrice: currentPrice.toString(),
            };
        }),
    );

    return NextResponse.json({ status: 'success', data: auctions });
}

export async function handleGetDutchAuction(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const [auction, currentBlock] = await Promise.all([getAuctionState('dutch', auctionId), getCurrentBlockHeight()]);
    const startPrice = BigInt(auction.startPrice ?? '0');
    const reservePrice = BigInt(auction.reservePrice ?? '0');
    const decrement = BigInt(auction.priceDecrement ?? '0');
    const startBlock = BigInt(auction.startBlock ?? currentBlock);
    const elapsed = currentBlock > Number(startBlock) ? BigInt(currentBlock) - startBlock : 0n;
    const raw = startPrice > decrement * elapsed ? startPrice - decrement * elapsed : reservePrice;
    const currentPrice = raw > reservePrice ? raw : reservePrice;

    return NextResponse.json({
        status: 'success',
        data: {
            ...auction,
            currentBlock,
            currentPrice: currentPrice.toString(),
        },
    });
}

export async function handleCreateDutchAuction(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = CreateDutchSchema.parse(await request.json());
        const auctionId = await deriveAuctionId(auth.walletAddress, data.salt);
        if (data.auctionId && data.auctionId !== auctionId) {
            return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: 'Supplied auction id does not match the v2 derived id for this wallet and salt.' } }, { status: 400 });
        }
        if (!data.txHash) {
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.dutch,
                function: 'create_auction',
                inputs: [
                    auctionId,
                    data.salt,
                    data.rfqId,
                    `${data.startPrice}u64`,
                    `${data.reservePrice}u64`,
                    `${data.decrementPerBlock}u64`,
                    `${data.startBlock}u32`,
                    `${data.endBlock}u32`,
                    `${data.tokenType}u8`,
                ],
                fee: estimateFee('create_auction'),
            };
            const prepared = await prepareAuctionTx(tx, 'create_dutch', `dutch:create:${auctionId}`);
            return NextResponse.json({ status: 'success', data: { auctionId, tx: prepared } });
        }

        return NextResponse.json({ status: 'success', data: { auctionId, txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: validationMessage(error, 'Failed to create Dutch auction.') } },
            { status: 400 },
        );
    }
}

export async function handleDutchCommitAccept(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = DutchAcceptSchema.parse(await request.json());
        if (!data.txHash) {
            const auction = await getAuctionState('dutch', auctionId);
            const tokenType = auction.tokenType ?? TOKEN_TYPE.CREDITS;
            const commitFn = tokenType === TOKEN_TYPE.USDCX ? 'commit_accept_usdcx'
                : tokenType === TOKEN_TYPE.USAD ? 'commit_accept_usad'
                : 'commit_accept';
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.dutch,
                function: commitFn,
                inputs: [auctionId, data.salt],
                fee: estimateFee(commitFn),
            };
            const prepared = await prepareAuctionTx(tx, 'dutch_commit', `dutch:commit_accept:${auctionId}`);
            return NextResponse.json({ status: 'success', data: { tx: prepared } });
        }

        return NextResponse.json({ status: 'success', data: { txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: validationMessage(error, 'Failed to commit accept.') } },
            { status: 400 },
        );
    }
}

export async function handleDutchAcceptPrice(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = DutchAcceptPriceSchema.parse(await request.json().catch(() => ({})));
        if (!data.txHash) {
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.dutch,
                function: 'accept_price',
                inputs: [auctionId],
                fee: estimateFee('accept_price'),
            };
            const prepared = await prepareAuctionTx(tx, 'dutch_accept', `dutch:accept_price:${auctionId}`);
            return NextResponse.json({ status: 'success', data: { tx: prepared } });
        }

        return NextResponse.json({ status: 'success', data: { txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: validationMessage(error, 'Failed to accept Dutch price.') } },
            { status: 400 },
        );
    }
}

export async function handleDutchConfirmAccept(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['VENDOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    try {
        const data = DutchAcceptSchema.parse(await request.json());
        if (!data.txHash) {
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.dutch,
                function: 'confirm_accept',
                inputs: [auctionId, data.salt],
                fee: estimateFee('confirm_accept'),
            };
            const prepared = await prepareAuctionTx(tx, 'dutch_confirm', `dutch:confirm_accept:${auctionId}`);
            return NextResponse.json({ status: 'success', data: { tx: prepared } });
        }

        return NextResponse.json({ status: 'success', data: { txHash: data.txHash } });
    } catch (error: any) {
        return NextResponse.json(
            { status: 'error', error: { code: 'VALIDATION_ERROR', message: validationMessage(error, 'Failed to confirm accept.') } },
            { status: 400 },
        );
    }
}

export async function handleDutchExpireAuction(request: NextRequest, auctionId: string) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const txHash = typeof body?.txHash === 'string' ? body.txHash : undefined;
    if (!txHash) {
        const tx: AleoTransaction = {
            program: PROGRAM_IDS.dutch,
            function: 'expire_auction',
            inputs: [auctionId],
            fee: estimateFee('expire_auction'),
        };
        const prepared = await prepareAuctionTx(tx, 'dutch_expire', `dutch:expire:${auctionId}`);
        return NextResponse.json({ status: 'success', data: { tx: prepared } });
    }
    return NextResponse.json({ status: 'success', data: { txHash } });
}
