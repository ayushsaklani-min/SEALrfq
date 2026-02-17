/**
 * Event Schemas for sealRFQ V1 Contract
 * 
 * Auto-generated from INTERFACE_LOCK.md (v1.0.0-interface-lock)
 * Build Hash: b8e826b0bbbb91757ec493f9df99cda3160ddb81ae0029556f655db321aa0b1ad
 * 
 * WARNING: These schemas are FROZEN. Do not modify without major version bump (v2.0.0)
 */

import type { Field, Address, u8, u32, u64 } from './types';

// ============================================================================
// Event Interfaces (7 Event Types)
// ============================================================================

/**
 * Event: RFQCreatedEvent
 * 
 * Emitted when: create_rfq transition executes
 *  
 * Indexed fields: rfq_id, buyer
 */
export interface RFQCreatedEvent {
    /** RFQ identifier */
    rfq_id: Field;

    /** Buyer (RFQ creator) address */
    buyer: Address;

    /** Block height when bidding closes */
    bidding_deadline: u32;

    /** Block height when reveal period ends */
    reveal_deadline: u32;

    /** Minimum acceptable bid amount */
    min_bid: u64;

    /** Block height when RFQ was created */
    block_height: u32;
}

/**
 * Event: BidCommittedEvent
 * 
 * Emitted when: submit_bid_commit transition executes
 * 
 * Indexed fields: rfq_id, bid_id, vendor
 * 
 * Privacy: bid amount is NOT in this event (commitment_hash only)
 */
export interface BidCommittedEvent {
    /** RFQ identifier */
    rfq_id: Field;

    /** Bid identifier */
    bid_id: Field;

    /** Vendor (bidder) address */
    vendor: Address;

    /** Commitment hash (BHP256 of bid_amount) */
    commitment_hash: Field;

    /** Stake amount (public) */
    stake: u64;

    /** Block height when bid was committed */
    block_height: u32;
}

/**
 * Event: BiddingClosedEvent
 * 
 * Emitted when: close_bidding transition executes
 * 
 * Indexed fields: rfq_id
 */
export interface BiddingClosedEvent {
    /** RFQ identifier */
    rfq_id: Field;

    /** Buyer address (who closed bidding) */
    buyer: Address;

    /** Block height when bidding was closed */
    block_height: u32;
}

/**
 * Event: BidRevealedEvent
 * 
 * Emitted when: reveal_bid transition executes
 * 
 * Indexed fields: rfq_id, bid_id, vendor
 * 
 * Privacy: revealed_amount is NOW PUBLIC (was private in commit)
 */
export interface BidRevealedEvent {
    /** RFQ identifier */
    rfq_id: Field;

    /** Bid identifier */
    bid_id: Field;

    /** Vendor address */
    vendor: Address;

    /** Revealed bid amount (now public) */
    revealed_amount: u64;

    /** Block height when bid was revealed */
    block_height: u32;
}

/**
 * Event: WinnerSelectedEvent
 * 
 * Emitted when: select_winner transition executes
 * 
 * Indexed fields: rfq_id, winning_bid_id, vendor
 */
export interface WinnerSelectedEvent {
    /** RFQ identifier */
    rfq_id: Field;

    /** Winning bid identifier */
    winning_bid_id: Field;

    /** Winning bid amount */
    winning_amount: u64;

    /** Winning vendor address */
    vendor: Address;

    /** Block height when winner was selected */
    block_height: u32;
}

/**
 * Event: StakeSlashedEvent
 * 
 * Emitted when: slash_non_revealer transition executes
 * 
 * Indexed fields: rfq_id, bid_id, slashed_vendor
 */
export interface StakeSlashedEvent {
    /** RFQ identifier */
    rfq_id: Field;

    /** Bid identifier of non-revealer */
    bid_id: Field;

    /** Slashed vendor address */
    slashed_vendor: Address;

    /** Stake amount slashed */
    stake_amount: u64;

    /** Block height when stake was slashed */
    block_height: u32;
}

/**
 * Event: EscrowFundedEvent
 * 
 * Emitted when: fund_escrow transition executes
 * 
 * Indexed fields: rfq_id, buyer
 */
export interface EscrowFundedEvent {
    /** RFQ identifier */
    rfq_id: Field;

    /** Buyer address (who funded escrow) */
    buyer: Address;

    /** Escrow amount */
    amount: u64;

    /** Block height when escrow was funded */
    block_height: u32;
}

/**
 * Event: PaymentReleasedEvent
 * 
 * Emitted when: release_partial_payment OR release_final_payment executes
 * 
 * Indexed fields: rfq_id, recipient
 * 
 * Note: is_final distinguishes partial vs final release
 */
export interface PaymentReleasedEvent {
    /** RFQ identifier */
    rfq_id: Field;

    /** Recipient address */
    recipient: Address;

    /** Amount released */
    amount: u64;

    /** True if final payment, false if partial */
    is_final: boolean;

    /** Block height when payment was released */
    block_height: u32;
}

// ============================================================================
// Union Type for All Events
// ============================================================================

export type ContractEvent =
    | RFQCreatedEvent
    | BidCommittedEvent
    | BiddingClosedEvent
    | BidRevealedEvent
    | WinnerSelectedEvent
    | StakeSlashedEvent
    | EscrowFundedEvent
    | PaymentReleasedEvent;

// ============================================================================
// Event Names (String Literals)
// ============================================================================

export const EVENT_NAMES = {
    RFQ_CREATED: 'RFQCreated',
    BID_COMMITTED: 'BidCommitted',
    BIDDING_CLOSED: 'BiddingClosed',
    BID_REVEALED: 'BidRevealed',
    WINNER_SELECTED: 'WinnerSelected',
    STAKE_SLASHED: 'StakeSlashed',
    ESCROW_FUNDED: 'EscrowFunded',
    PAYMENT_RELEASED: 'PaymentReleased',
} as const;

export type EventName = typeof EVENT_NAMES[keyof typeof EVENT_NAMES];

// ============================================================================
// Event Type Guards
// ============================================================================

export function isRFQCreatedEvent(event: ContractEvent): event is RFQCreatedEvent {
    return 'bidding_deadline' in event && 'reveal_deadline' in event && 'min_bid' in event;
}

export function isBidCommittedEvent(event: ContractEvent): event is BidCommittedEvent {
    return 'commitment_hash' in event && 'stake' in event;
}

export function isBiddingClosedEvent(event: ContractEvent): event is BiddingClosedEvent {
    return 'buyer' in event && !('amount' in event) && !('revealed_amount' in event);
}

export function isBidRevealedEvent(event: ContractEvent): event is BidRevealedEvent {
    return 'revealed_amount' in event && 'vendor' in event;
}

export function isWinnerSelectedEvent(event: ContractEvent): event is WinnerSelectedEvent {
    return 'winning_bid_id' in event && 'winning_amount' in event;
}

export function isStakeSlashedEvent(event: ContractEvent): event is StakeSlashedEvent {
    return 'slashed_vendor' in event && 'stake_amount' in event;
}

export function isEscrowFundedEvent(event: ContractEvent): event is EscrowFundedEvent {
    return 'buyer' in event && 'amount' in event && !('is_final' in event);
}

export function isPaymentReleasedEvent(event: ContractEvent): event is PaymentReleasedEvent {
    return 'is_final' in event && 'amount' in event && 'recipient' in event;
}

// ============================================================================
// Event Metadata (for Indexer)
// ============================================================================

export interface EventMetadata {
    /** Event name */
    name: EventName;

    /** Fields to index in database */
    indexed_fields: string[];

    /** Associated transition */
    transition: string;

    /** Description */
    description: string;
}

export const EVENT_METADATA: Record<EventName, EventMetadata> = {
    [EVENT_NAMES.RFQ_CREATED]: {
        name: EVENT_NAMES.RFQ_CREATED,
        indexed_fields: ['rfq_id', 'buyer'],
        transition: 'create_rfq',
        description: 'RFQ created with deadlines and min bid',
    },
    [EVENT_NAMES.BID_COMMITTED]: {
        name: EVENT_NAMES.BID_COMMITTED,
        indexed_fields: ['rfq_id', 'bid_id', 'vendor'],
        transition: 'submit_bid_commit',
        description: 'Sealed bid committed with stake (amount private)',
    },
    [EVENT_NAMES.BIDDING_CLOSED]: {
        name: EVENT_NAMES.BIDDING_CLOSED,
        indexed_fields: ['rfq_id'],
        transition: 'close_bidding',
        description: 'Bidding period closed, reveal period begins',
    },
    [EVENT_NAMES.BID_REVEALED]: {
        name: EVENT_NAMES.BID_REVEALED,
        indexed_fields: ['rfq_id', 'bid_id', 'vendor'],
        transition: 'reveal_bid',
        description: 'Bid amount revealed (now public)',
    },
    [EVENT_NAMES.WINNER_SELECTED]: {
        name: EVENT_NAMES.WINNER_SELECTED,
        indexed_fields: ['rfq_id', 'winning_bid_id', 'vendor'],
        transition: 'select_winner',
        description: 'Winner selected from revealed bids',
    },
    [EVENT_NAMES.STAKE_SLASHED]: {
        name: EVENT_NAMES.STAKE_SLASHED,
        indexed_fields: ['rfq_id', 'bid_id', 'slashed_vendor'],
        transition: 'slash_non_revealer',
        description: 'Stake slashed for non-revealing bidder',
    },
    [EVENT_NAMES.ESCROW_FUNDED]: {
        name: EVENT_NAMES.ESCROW_FUNDED,
        indexed_fields: ['rfq_id', 'buyer'],
        transition: 'fund_escrow',
        description: 'Escrow funded with winning bid amount',
    },
    [EVENT_NAMES.PAYMENT_RELEASED]: {
        name: EVENT_NAMES.PAYMENT_RELEASED,
        indexed_fields: ['rfq_id', 'recipient'],
        transition: 'release_partial_payment | release_final_payment',
        description: 'Payment released from escrow',
    },
};
