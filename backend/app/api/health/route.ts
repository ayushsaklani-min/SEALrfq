import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  const checks: Record<string, any> = {};
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  // Database check
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', latency_ms: Date.now() - start };
  } catch (error) {
    checks.database = { status: 'fail', message: 'Database unreachable' };
    overallStatus = 'unhealthy';
  }

  // Indexer check
  try {
    const checkpoint = await prisma.indexerCheckpoint.findFirst({
      orderBy: { blockHeight: 'desc' }
    });
    if (checkpoint) {
      checks.indexer = { 
        status: 'ok', 
        lastBlock: checkpoint.blockHeight,
        lastSync: checkpoint.processedAt 
      };
    } else {
      checks.indexer = { status: 'stale', message: 'No checkpoints found' };
      overallStatus = 'degraded';
    }
  } catch (error) {
    checks.indexer = { status: 'fail' };
    overallStatus = 'degraded';
  }

  // Aleo RPC check
  const rpcUrl = process.env.ALEO_RPC_URL;
  if (rpcUrl) {
    try {
      const response = await fetch(`${rpcUrl}/testnet/latest/height`, { 
        signal: AbortSignal.timeout(5000) 
      });
      if (response.ok) {
        checks.aleoRpc = { status: 'ok' };
      } else {
        checks.aleoRpc = { status: 'degraded' };
        overallStatus = 'degraded';
      }
    } catch {
      checks.aleoRpc = { status: 'fail', message: 'RPC timeout' };
      overallStatus = 'degraded';
    }
  } else {
    checks.aleoRpc = { status: 'not_configured' };
  }

  return NextResponse.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks
  }, { 
    status: overallStatus === 'unhealthy' ? 503 : 200 
  });
}