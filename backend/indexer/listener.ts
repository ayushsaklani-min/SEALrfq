/**
 * Event Listener
 * 
 * Listens for events from Aleo network and processes them.
 */

import { EventProcessor } from './processor';
import type { ContractEvent } from '../../contracts/v1/client/events';

// ============================================================================
// Aleo Event Source Interface
// ============================================================================

export interface AleoEventSource {
    /** Subscribe to new events */
    subscribe(callback: (event: AleoEvent) => void): void;

    /** Get events for specific block range */
    getEvents(fromBlock: number, toBlock: number): Promise<AleoEvent[]>;

    /** Get latest block height */
    getLatestBlock(): Promise<number>;
}

export interface AleoEvent {
    txId: string;
    transition: string;
    eventIdx: number;
    blockHeight: number;
    blockHash: string;
    event: ContractEvent;
    isPending: boolean; // true if in mempool, false if confirmed
}

// ============================================================================
// Event Listener
// ============================================================================

export class EventListener {
    private isRunning = false;
    private lastProcessedBlock = 0;
    private readonly ROLLBACK_WINDOW = 10; // blocks

    constructor(
        private eventSource: AleoEventSource,
        private processor: EventProcessor
    ) { }

    /**
     * Start listening for events
     */
    async start(fromBlock: number = 0): Promise<void> {
        this.isRunning = true;
        this.lastProcessedBlock = fromBlock;

        // Subscribe to new events (pending + confirmed)
        this.eventSource.subscribe(async (event) => {
            await this.handleEvent(event);
        });

        // Catch up on historical events
        await this.catchUp();

        // Poll for new blocks
        this.pollNewBlocks();
    }

    /**
     * Stop listening
     */
    stop(): void {
        this.isRunning = false;
    }

    /**
     * Handle single event
     */
    private async handleEvent(event: AleoEvent): Promise<void> {
        try {
            await this.processor.processEvent(
                event.event,
                event.txId,
                event.transition,
                event.eventIdx,
                event.blockHeight,
                event.blockHash,
                event.isPending
            );

            // Create checkpoint if confirmed
            if (!event.isPending) {
                await this.createCheckpointIfNeeded(event.blockHeight, event.blockHash);
            }
        } catch (error) {
            console.error(`Failed to process event ${event.txId}:${event.eventIdx}:`, error);
        }
    }

    /**
     * Catch up on historical events
     */
    private async catchUp(): Promise<void> {
        const latestBlock = await this.eventSource.getLatestBlock();

        if (this.lastProcessedBlock >= latestBlock) {
            return;
        }

        console.log(`Catching up from block ${this.lastProcessedBlock} to ${latestBlock}`);

        // Process in batches
        const BATCH_SIZE = 100;
        for (let block = this.lastProcessedBlock; block <= latestBlock; block += BATCH_SIZE) {
            const toBlock = Math.min(block + BATCH_SIZE - 1, latestBlock);
            const events = await this.eventSource.getEvents(block, toBlock);

            for (const event of events) {
                await this.handleEvent(event);
            }

            this.lastProcessedBlock = toBlock;
        }

        console.log(`Caught up to block ${latestBlock}`);
    }

    /**
     * Poll for new blocks
     */
    private async pollNewBlocks(): Promise<void> {
        while (this.isRunning) {
            try {
                const latestBlock = await this.eventSource.getLatestBlock();

                if (latestBlock > this.lastProcessedBlock) {
                    await this.catchUp();
                }

                // Wait 5 seconds before next poll
                await new Promise(resolve => setTimeout(resolve, 5000));
            } catch (error) {
                console.error('Error polling blocks:', error);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    }

    /**
     * Create checkpoint and finalize old ones (HARD REQUIREMENT 4)
     */
    private async createCheckpointIfNeeded(blockHeight: number, blockHash: string): Promise<void> {
        // Create checkpoint for this block
        await this.processor.createCheckpoint(blockHeight, blockHash);

        // Finalize checkpoints outside rollback window
        const finalizeBlock = blockHeight - this.ROLLBACK_WINDOW;
        if (finalizeBlock > 0) {
            await this.processor.finalizeCheckpoint(finalizeBlock);
        }
    }
}
