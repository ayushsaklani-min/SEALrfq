/**
 * Next.js instrumentation hook — runs once when the server starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        // 1. Validate environment variables — fail fast on misconfiguration.
        const { validateEnv } = await import('./lib/validateEnv');
        validateEnv();

        // 2. Register graceful shutdown for all background jobs.
        const { registerShutdownHandler } = await import('./lib/shutdown');
        const { PrismaClient } = await import('@prisma/client');
        const { ReconciliationScheduler, ReconciliationJob } = await import('./tx/reconciliation');
        const { TransactionTracker } = await import('./tx/tracker');

        const prisma = new PrismaClient();

        // Prisma disconnect on shutdown.
        registerShutdownHandler('prisma', async () => {
            await prisma.$disconnect();
        });

        // Reconciliation job (runs every 5 minutes).
        // ChainState is injected by the real Aleo indexer in production.
        // Here we only start it if ALEO_RPC_URL is configured.
        if (process.env.ALEO_RPC_URL) {
            const { AleoChainState } = await import('./aleo/chainState');
            const tracker = new TransactionTracker(prisma);
            const chainState = new AleoChainState();
            const job = new ReconciliationJob(prisma, tracker, chainState);
            const scheduler = new ReconciliationScheduler(job, 5 * 60 * 1000);
            scheduler.start();
            registerShutdownHandler('reconciliation', () => scheduler.stop());
        }
    }
}
