import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '../../auth/middleware';
import { estimateFee } from '../../aleo/fees';
import { TransactionTracker } from '../../tx/tracker';
import type { AleoTransaction } from '../../lib/types';
import { PrismaClient } from '@prisma/client';
import { getPlatformConfig, hashAddressToField, PROGRAM_IDS } from '../../lib/sealProtocol';

const prisma = new PrismaClient();
const tracker = new TransactionTracker(prisma);
const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'testnet';
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const ADMIN_ADDRESS = process.env.ALEO_ADMIN_ADDRESS?.trim() || '';

const ConfigureSchema = z.object({
    feeBps: z.number().int().min(0).max(10_000),
    paused: z.boolean(),
    txHash: z.string().optional(),
});

const WithdrawSchema = z.object({
    amount: z.string().regex(/^\d+$/),
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

async function requireAdmin(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    const config = await getPlatformConfig(true);
    const callerHash = await hashAddressToField(auth.walletAddress);
    const isAdmin = ADMIN_ADDRESS
        ? auth.walletAddress.trim().toLowerCase() === ADMIN_ADDRESS.trim().toLowerCase()
        : !config.initialized || callerHash === config.adminHash;
    if (!isAdmin) {
        return NextResponse.json(
            { status: 'error', error: { code: 'FORBIDDEN', message: 'Admin access required.' } },
            { status: 403 },
        );
    }
    return { auth, config, callerHash, isAdmin };
}

export async function handleGetPlatformConfig(request: NextRequest) {
    const auth = await requireRole(request, ['BUYER', 'VENDOR', 'AUDITOR', 'NEW_USER']);
    if (auth instanceof NextResponse) return auth;

    let config;
    try {
        config = await getPlatformConfig(true);
    } catch {
        config = { adminHash: '0field', feeBps: 0, paused: false, treasuryCredits: '0', treasuryUsdcx: '0', treasuryUsad: '0', initialized: false };
    }
    const callerHash = await hashAddressToField(auth.walletAddress);
    const isAdmin = ADMIN_ADDRESS
        ? auth.walletAddress.trim().toLowerCase() === ADMIN_ADDRESS.trim().toLowerCase()
        : !config.initialized || callerHash === config.adminHash;
    return NextResponse.json({
        status: 'success',
        data: {
            ...config,
            callerHash,
            isAdmin,
        },
    });
}

export async function handleConfigurePlatform(request: NextRequest) {
    const adminResult = await requireAdmin(request);
    if (adminResult instanceof NextResponse) return adminResult;

    try {
        const data = ConfigureSchema.parse(await request.json());
        if (!data.txHash) {
            const idempotencyKey = `configure_platform_${crypto.randomUUID()}`;
            const canonicalKey = 'configure_platform';
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: 'configure_platform',
                inputs: [`${data.feeBps}u64`, data.paused ? 'true' : 'false'],
                fee: estimateFee('configure_platform'),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({
                status: 'success',
                data: {
                    tx: {
                        idempotencyKey,
                        canonicalTxKey: canonicalKey,
                        request: buildWalletTxRequest(tx),
                    },
                },
            });
        }

        return NextResponse.json({
            status: 'success',
            data: {
                txHash: data.txHash,
                adminHash: adminResult.callerHash,
                feeBps: data.feeBps,
                paused: data.paused,
            },
        });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

async function handleWithdraw(request: NextRequest, transition: 'withdraw_fees' | 'withdraw_fees_usdcx') {
    const adminResult = await requireAdmin(request);
    if (adminResult instanceof NextResponse) return adminResult;

    try {
        const data = WithdrawSchema.parse(await request.json());
        if (!data.txHash) {
            const idempotencyKey = `${transition}_${crypto.randomUUID()}`;
            const canonicalKey = transition;
            const tx: AleoTransaction = {
                program: PROGRAM_IDS.rfq,
                function: transition,
                inputs: [`${data.amount}u64`],
                fee: estimateFee(transition),
            };

            await prepareTrackedTransition(tx, idempotencyKey, canonicalKey);
            return NextResponse.json({
                status: 'success',
                data: {
                    tx: {
                        idempotencyKey,
                        canonicalTxKey: canonicalKey,
                        request: buildWalletTxRequest(tx),
                    },
                },
            });
        }

        return NextResponse.json({ status: 'success', data: { txHash: data.txHash, amount: data.amount } });
    } catch (error: any) {
        return NextResponse.json({ status: 'error', error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
    }
}

export async function handleWithdrawFeesCredits(request: NextRequest) {
    return handleWithdraw(request, 'withdraw_fees');
}

export async function handleWithdrawFeesUsdcx(request: NextRequest) {
    return handleWithdraw(request, 'withdraw_fees_usdcx');
}
