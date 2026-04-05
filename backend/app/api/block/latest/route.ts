import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const checkpoint = await prisma.indexerCheckpoint.findFirst({
      orderBy: { blockHeight: 'desc' }
    });

    return NextResponse.json({
      blockHeight: checkpoint?.blockHeight || 0,
      blockHash: checkpoint?.blockHash || null,
      timestamp: checkpoint?.processedAt || new Date().toISOString(),
      network: process.env.ALEO_NETWORK || 'testnet'
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch block height' },
      { status: 500 }
    );
  }
}