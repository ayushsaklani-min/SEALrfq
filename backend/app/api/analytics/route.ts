import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const [
      totalRfqs,
      totalBids,
      completedRfqs,
      payments,
      tokenDistribution
    ] = await Promise.all([
      prisma.rFQ.count(),
      prisma.bid.count(),
      prisma.rFQ.count({ where: { status: 'COMPLETED' } }),
      prisma.payment.aggregate({ _sum: { amount: true } }),
      prisma.rFQ.groupBy({ by: ['tokenType'], _count: true })
    ]);

    const successRate = totalRfqs > 0 ? (completedRfqs / totalRfqs) * 100 : 0;
    const avgBidsPerRfq = totalRfqs > 0 ? totalBids / totalRfqs : 0;

    return NextResponse.json({
      overview: {
        totalRfqs,
        totalBids,
        totalValueSettled: payments._sum.amount?.toString() || '0',
        successRate: Math.round(successRate * 10) / 10,
        avgBidsPerRfq: Math.round(avgBidsPerRfq * 10) / 10
      },
      tokenDistribution: tokenDistribution.map(t => ({
        tokenType: t.tokenType,
        count: t._count
      }))
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}