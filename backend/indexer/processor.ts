/**
 * Event Processor
 * 
 * Processes events with:
 * - Idempotency (unique tx_id + transition + event_idx)
 * - Staging for pending, confirmed-only business state
 * - Reorg safety with checkpointing
 */

import { PrismaClient } from '@prisma/client';
import { EventType, RFQStatus } from '../db/enums';
import type {
    RFQCreatedEvent,
    BidCommittedEvent,
    BiddingClosedEvent,
    BidRevealedEvent,
    WinnerSelectedEvent,
    StakeSlashedEvent,
    EscrowFundedEvent,
    PaymentReleasedEvent,
    ContractEvent,
} from '../../contracts/v1/client/events';

// ============================================================================
// Event Processor
// ============================================================================

export class EventProcessor {
    constructor(private prisma: PrismaClient) { }

    /**
     * Process event with idempotency check
     * 
     * HARD REQUIREMENT 2: Check unique (tx_id + transition + event_idx)
     */
    async processEvent(
        event: ContractEvent,
        txId: string,
        transition: string,
        eventIdx: number,
        blockHeight: number,
        blockHash: string,
        isPending: boolean = false
    ): Promise<void> {
        // Check if already processed
        const existing = await this.prisma.rFQEvent.findUnique({
            where: {
                txId_transition_eventIdx: {
                    txId,
                    transition,
                    eventIdx,
                },
            },
        });

        if (existing) {
            console.log(`Event already processed: ${txId}:${transition}:${eventIdx}`);
            return;
        }

        // HARD REQUIREMENT 3: Pending goes to staging, confirmed to business state
        if (isPending) {
            await this.processPendingEvent(event, txId, transition, eventIdx, blockHeight, blockHash);
        } else {
            await this.processConfirmedEvent(event, txId, transition, eventIdx, blockHeight, blockHash);
        }
    }

    /**
     * Process pending event (staging table only)
     */
    private async processPendingEvent(
        event: ContractEvent,
        txId: string,
        transition: string,
        eventIdx: number,
        blockHeight: number,
        blockHash: string
    ): Promise<void> {
        const eventType = this.getEventType(transition);

        await this.prisma.stagingEvent.create({
            data: {
                txId,
                transition,
                eventIdx,
                eventType,
                eventData: event as any,
                blockHeight,
                blockHash,
                eventVersion: 1, // HARD REQUIREMENT 1
            },
        });
    }

    /**
     * Process confirmed event (business state + event log)
     */
    private async processConfirmedEvent(
        event: ContractEvent,
        txId: string,
        transition: string,
        eventIdx: number,
        blockHeight: number,
        blockHash: string
    ): Promise<void> {
        const eventType = this.getEventType(transition);

        await this.prisma.$transaction(async (tx) => {
            // 1. Write to event log (immutable audit trail)
            await tx.rFQEvent.create({
                data: {
                    eventType,
                    rfqId: this.extractRFQId(event),
                    eventData: event as any,
                    txId,
                    transition,
                    eventIdx,
                    blockHeight,
                    blockHash,
                    eventVersion: 1, // HARD REQUIREMENT 1
                },
            });

            // 2. Update business state (type-specific)
            await this.updateBusinessState(tx, event, txId, eventIdx, blockHeight);

            // 3. Remove from staging if exists
            await tx.stagingEvent.deleteMany({
                where: { txId, transition, eventIdx },
            });
        });
    }

    /**
     * Update business state based on event type
     */
    private async updateBusinessState(
        tx: any,
        event: ContractEvent,
        txId: string,
        eventIdx: number,
        blockHeight: number
    ): Promise<void> {
        if (this.isRFQCreatedEvent(event)) {
            await this.processRFQCreated(tx, event, txId, eventIdx, blockHeight);
        } else if (this.isBidCommittedEvent(event)) {
            await this.processBidCommitted(tx, event, txId, eventIdx, blockHeight);
        } else if (this.isBiddingClosedEvent(event)) {
            await this.processBiddingClosed(tx, event);
        } else if (this.isBidRevealedEvent(event)) {
            await this.processBidRevealed(tx, event, blockHeight);
        } else if (this.isWinnerSelectedEvent(event)) {
            await this.processWinnerSelected(tx, event);
        } else if (this.isStakeSlashedEvent(event)) {
            await this.processStakeSlashed(tx, event);
        } else if (this.isEscrowFundedEvent(event)) {
            await this.processEscrowFunded(tx, event, txId, eventIdx, blockHeight);
        } else if (this.isPaymentReleasedEvent(event)) {
            await this.processPaymentReleased(tx, event, txId, eventIdx, blockHeight);
        }
    }

    // ========================================================================
    // Event-Specific Processors (7 types)
    // ========================================================================

    private async processRFQCreated(
        tx: any,
        event: RFQCreatedEvent,
        txId: string,
        eventIdx: number,
        blockHeight: number
    ): Promise<void> {
        await tx.rFQ.create({
            data: {
                id: event.rfq_id,
                buyer: event.buyer,
                biddingDeadline: event.bidding_deadline,
                revealDeadline: event.reveal_deadline,
                minBid: event.min_bid,
                status: RFQStatus.OPEN,
                createdBlock: blockHeight,
                eventVersion: 1,
                createdTxId: txId,
                createdEventIdx: eventIdx,
            },
        });
    }

    private async processBidCommitted(
        tx: any,
        event: BidCommittedEvent,
        txId: string,
        eventIdx: number,
        blockHeight: number
    ): Promise<void> {
        await tx.bid.create({
            data: {
                id: event.bid_id,
                rfqId: event.rfq_id,
                vendor: event.vendor,
                commitmentHash: event.commitment_hash,
                stake: event.stake,
                createdBlock: blockHeight,
                eventVersion: 1,
                createdTxId: txId,
                createdEventIdx: eventIdx,
            },
        });
    }

    private async processBiddingClosed(
        tx: any,
        event: BiddingClosedEvent
    ): Promise<void> {
        await tx.rFQ.update({
            where: { id: event.rfq_id },
            data: { status: RFQStatus.CLOSED },
        });
    }

    private async processBidRevealed(
        tx: any,
        event: BidRevealedEvent,
        blockHeight: number
    ): Promise<void> {
        await tx.bid.update({
            where: { id: event.bid_id },
            data: {
                revealedAmount: event.revealed_amount,
                isRevealed: true,
                revealedBlock: blockHeight,
            },
        });
    }

    private async processWinnerSelected(
        tx: any,
        event: WinnerSelectedEvent
    ): Promise<void> {
        await tx.bid.update({
            where: { id: event.winning_bid_id },
            data: { isWinner: true },
        });

        await tx.rFQ.update({
            where: { id: event.rfq_id },
            data: { status: RFQStatus.WINNER_SELECTED },
        });
    }

    private async processStakeSlashed(
        tx: any,
        event: StakeSlashedEvent
    ): Promise<void> {
        await tx.bid.update({
            where: { id: event.bid_id },
            data: { isSlashed: true },
        });
    }

    private async processEscrowFunded(
        tx: any,
        event: EscrowFundedEvent,
        txId: string,
        eventIdx: number,
        blockHeight: number
    ): Promise<void> {
        await tx.escrow.create({
            data: {
                rfqId: event.rfq_id,
                totalAmount: event.amount,
                fundedBlock: blockHeight,
                eventVersion: 1,
                fundedTxId: txId,
                fundedEventIdx: eventIdx,
            },
        });

        await tx.rFQ.update({
            where: { id: event.rfq_id },
            data: { status: RFQStatus.ESCROW_FUNDED },
        });
    }

    private async processPaymentReleased(
        tx: any,
        event: PaymentReleasedEvent,
        txId: string,
        eventIdx: number,
        blockHeight: number
    ): Promise<void> {
        await tx.payment.create({
            data: {
                rfqId: event.rfq_id,
                recipient: event.recipient,
                amount: event.amount,
                isFinal: event.is_final,
                releasedBlock: blockHeight,
                eventVersion: 1,
                releasedTxId: txId,
                releasedEventIdx: eventIdx,
            },
        });

        // Update escrow released amount
        await tx.escrow.update({
            where: { rfqId: event.rfq_id },
            data: {
                releasedAmount: { increment: event.amount },
                isFinal: event.is_final,
            },
        });

        // If final payment, mark RFQ as completed
        if (event.is_final) {
            await tx.rFQ.update({
                where: { id: event.rfq_id },
                data: { status: RFQStatus.COMPLETED },
            });
        }
    }

    // ========================================================================
    // REORG SAFETY (HARD REQUIREMENT 4)
    // ========================================================================

    /**
     * Create checkpoint after processing block
     */
    async createCheckpoint(blockHeight: number, blockHash: string): Promise<void> {
        await this.prisma.indexerCheckpoint.create({
            data: {
                blockHeight,
                blockHash,
                isFinalized: false,
            },
        });
    }

    /**
     * Finalize checkpoint (outside rollback window)
     */
    async finalizeCheckpoint(blockHeight: number): Promise<void> {
        await this.prisma.indexerCheckpoint.update({
            where: { blockHeight },
            data: { isFinalized: true },
        });
    }

    /**
     * Handle chain reorg (rollback to checkpoint)
     */
    async handleReorg(fromBlock: number, toBlock: number, newHash: string): Promise<void> {
        const checkpoint = await this.prisma.indexerCheckpoint.findUnique({
            where: { blockHeight: toBlock },
        });

        if (!checkpoint) {
            throw new Error(`No checkpoint found for block ${toBlock}`);
        }

        // Log reorg event
        const reorgEvent = await this.prisma.reorgEvent.create({
            data: {
                fromBlock,
                toBlock,
                fromHash: checkpoint.blockHash,
                toHash: newHash,
                eventsRolledBack: 0, // Will be updated
            },
        });

        // Delete events from rolled-back blocks
        const deleted = await this.prisma.rFQEvent.deleteMany({
            where: {
                blockHeight: { gt: toBlock },
            },
        });

        // Update reorg event with count
        await this.prisma.reorgEvent.update({
            where: { id: reorgEvent.id },
            data: {
                eventsRolledBack: deleted.count,
                recoveredAt: new Date(),
            },
        });

        // TODO: Rollback business state changes
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private extractRFQId(event: ContractEvent): string | null {
        return (event as any).rfq_id ?? null;
    }

    private getEventType(transition: string): EventType {
        const mapping: Record<string, EventType> = {
            create_rfq: EventType.RFQ_CREATED,
            submit_bid_commit: EventType.BID_COMMITTED,
            close_bidding: EventType.BIDDING_CLOSED,
            reveal_bid: EventType.BID_REVEALED,
            select_winner: EventType.WINNER_SELECTED,
            slash_non_revealer: EventType.STAKE_SLASHED,
            fund_escrow: EventType.ESCROW_FUNDED,
            release_partial_payment: EventType.PAYMENT_RELEASED,
            release_final_payment: EventType.PAYMENT_RELEASED,
        };
        return mapping[transition] ?? EventType.RFQ_CREATED;
    }

    // Type guards
    private isRFQCreatedEvent(event: ContractEvent): event is RFQCreatedEvent {
        return 'bidding_deadline' in event && 'min_bid' in event;
    }

    private isBidCommittedEvent(event: ContractEvent): event is BidCommittedEvent {
        return 'commitment_hash' in event && 'stake' in event;
    }

    private isBiddingClosedEvent(event: ContractEvent): event is BiddingClosedEvent {
        return 'buyer' in event && !('amount' in event) && !('revealed_amount' in event);
    }

    private isBidRevealedEvent(event: ContractEvent): event is BidRevealedEvent {
        return 'revealed_amount' in event;
    }

    private isWinnerSelectedEvent(event: ContractEvent): event is WinnerSelectedEvent {
        return 'winning_bid_id' in event;
    }

    private isStakeSlashedEvent(event: ContractEvent): event is StakeSlashedEvent {
        return 'slashed_vendor' in event;
    }

    private isEscrowFundedEvent(event: ContractEvent): event is EscrowFundedEvent {
        return 'buyer' in event && 'amount' in event && !('is_final' in event);
    }

    private isPaymentReleasedEvent(event: ContractEvent): event is PaymentReleasedEvent {
        return 'is_final' in event;
    }
}
