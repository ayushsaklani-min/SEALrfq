/**
 * Leo Types for sealRFQ V1 Contract
 * 
 * Auto-generated from INTERFACE_LOCK.md (v1.0.0-interface-lock)
 * Build Hash: b8e826b0bbbb91757ec493f9df99cda3160ddb81ae0029556f655db321aa0b1ad
 * 
 * WARNING: These types are FROZEN. Do not modify without major version bump (v2.0.0)
 */

// ============================================================================
// Base Aleo Types
// ============================================================================

/** Leo field type (253-bit prime field element) */
export type Field = string; // Hex string representation

/** Leo address type (Aleo account address) */
export type Address = string; // bech32m encoded

/** Leo u8 unsigned integer */
export type u8 = number; // 0-255

/** Leo u32 unsigned integer */
export type u32 = number; // 0-4294967295

/** Leo u64 unsigned integer (JavaScript can't safely represent, use BigInt) */
export type u64 = bigint; // 0-18446744073709551615

/** Leo boolean */
export type bool = boolean;

// ============================================================================
// Transition Parameter Types (All 10 Transitions)
// ============================================================================

/**
 * Transition 1: create_rfq
 * 
 * Creates a new RFQ with bidding and reveal deadlines.
 * 
 * Invariants:
 * - bidding_deadline > current_block
 * - reveal_deadline > bidding_deadline
 * - min_bid > 0 && min_bid < 1_000_000_000
 */
export interface CreateRFQParams {
  /** Unique identifier for the RFQ */
  rfq_id: Field;
  
  /** Block height when bidding closes */
  bidding_deadline: u32;
  
  /** Block height when reveal period ends */
  reveal_deadline: u32;
  
  /** Minimum acceptable bid amount (in credits) */
  min_bid: u64;
  
  /** Current block height (for deadline validation) */
  current_block: u32;
}

/**
 * Transition 2: submit_bid_commit
 * 
 * Submits a sealed bid commitment with stake.
 * 
 * Invariants:
 * - current_block < bidding_deadline
 * - bid_amount >= min_bid
 * - stake >= (bid_amount * 10) / 100  (10% minimum)
 * - user_nonce == stored_nonce + 1  (replay protection)
 * 
 * Privacy: bid_amount and nonce are PRIVATE inputs
 */
export interface SubmitBidCommitParams {
  /** RFQ identifier */
  rfq_id: Field;
  
  /** Actual bid amount (PRIVATE - not visible on chain) */
  bid_amount: u64;
  
  /** Random nonce for commitment (PRIVATE) */
  nonce: Field;
  
  /** Stake amount (public, typically 10% of bid) */
  stake: u64;
  
  /** Unique bid identifier */
  bid_id: Field;
  
  /** Current block height */
  current_block: u32;
  
  /** User's replay protection nonce (must be sequential) */
  user_nonce: u64;
}

/**
 * Transition 3: close_bidding
 *  
 * Closes the bidding period, transitions RFQ to CLOSED state.
 * 
 * Invariants:
 * - current_block >= bidding_deadline
 * - caller == rfq_creator
 * - status == OPEN
 */
export interface CloseBiddingParams {
  /** RFQ identifier */
  rfq_id: Field;
  
  /** Current block height */
  current_block: u32;
}

/**
 * Transition 4: reveal_bid
 * 
 * Reveals a previously committed bid.
 * 
 * Invariants:
 * - current_block < reveal_deadline
 * - BHP256(bid_amount) == stored_commitment
 * - bid not already revealed
 * - user_nonce == stored_nonce + 1  (replay protection)
 * 
 * Privacy: bid_amount and nonce are PRIVATE inputs (now revealed)
 */
export interface RevealBidParams {
  /** RFQ identifier */
  rfq_id: Field;
  
  /** Bid identifier */
 bid_id: Field;
  
  /** Actual bid amount (PRIVATE, matches commit) */
  bid_amount: u64;
  
  /** Nonce used in commitment (PRIVATE) */
  nonce: Field;
  
  /** Current block height */
  current_block: u32;
  
  /** User's replay protection nonce */
  user_nonce: u64;
}

/**
 * Transition 5: select_winner
 * 
 * Selects the winning bid (must be revealed).
 * 
 * Invariants:
 * - current_block >= reveal_deadline
 * - winning_bid_id must be revealed
 * - caller == rfq_creator
 * - status == CLOSED
 * 
 * Tie-break rule: If multiple bids have same amount, select lowest bid_id
 */
export interface SelectWinnerParams {
  /** RFQ identifier */
  rfq_id: Field;
  
  /** Bid ID of the winner */
  winning_bid_id: Field;
  
  /** Current block height */
  current_block: u32;
}

/**
 * Transition 6: slash_non_revealer
 * 
 * Slashes stake of a bidder who didn't reveal.
 * 
 * Invariants:
 * - current_block > reveal_deadline
 * - bid_commitments[bid_id] exists
 * - revealed_bids[bid_id] NOT exists
 * - status >= CLOSED
 */
export interface SlashNonRevealerParams {
  /** RFQ identifier */
  rfq_id: Field;
  
  /** Bid ID of non-revealer */
  bid_id: Field;
  
  /** Current block height */
  current_block: u32;
}

/**
 * Transition 7: refund_stake
 * 
 * Refunds stake to losing bidders who revealed.
 * 
 * Invariants:
 * - status >= WINNER_SELECTED
 * - bid_id != winning_bid_id
 * - revealed_bids[bid_id] exists
 */
export interface RefundStakeParams {
  /** RFQ identifier */
  rfq_id: Field;
  
  /** Bid ID to refund */
  bid_id: Field;
}

/**
 * Transition 8: fund_escrow
 * 
 * Funds escrow with amount >= winning bid.
 * 
 * Invariants:
 * - amount >= winning_bid_amount
 * - caller == rfq_creator
 * - status == WINNER_SELECTED
 * - escrow not already funded
 */
export interface FundEscrowParams {
  /** RFQ identifier */
  rfq_id: Field;
  
  /** Escrow amount (must be >= winning bid) */
  amount: u64;
  
  /** Current block height */
  current_block: u32;
}

/**
 * Transition 9: release_partial_payment
 * 
 * Releases a percentage of escrowed funds.
 * 
 * Invariants:
 * - percentage > 0 && percentage <= 100
 * - total_released + amount <= escrow_total
 * - caller == rfq_creator
 * - status == ESCROW_FUNDED
 * - user_nonce == stored_nonce + 1  (replay protection)
 */
export interface ReleasePartialPaymentParams {
  /** RFQ identifier */
  rfq_id: Field;
  
  /** Percentage to release (1-100) */
  percentage: u8;
  
  /** Recipient address (usually winning vendor) */
  recipient: Address;
  
  /** Current block height */
  current_block: u32;
  
  /** User's replay protection nonce */
  user_nonce: u64;
}

/**
 * Transition 10: release_final_payment
 * 
 * Releases remaining escrow funds and completes RFQ.
 * 
 * Invariants:
 * - escrow_amounts[rfq_id] > 0
 * - final_payment_released[rfq_id] == false
 * - caller == rfq_creator
 * - status == ESCROW_FUNDED
 * - user_nonce == stored_nonce + 1  (replay protection)
 */
export interface ReleaseFinalPaymentParams {
  /** RFQ identifier */
  rfq_id: Field;
  
  /** Recipient address */
  recipient: Address;
  
  /** Current block height */
  current_block: u32;
  
  /** User's replay protection nonce */
  user_nonce: u64;
}

// ============================================================================
// Union Type for All Transition Params
// ============================================================================

export type TransitionParams =
  | CreateRFQParams
  | SubmitBidCommitParams
  | CloseBiddingParams
  | RevealBidParams
  | SelectWinnerParams
  | SlashNonRevealerParams
  | RefundStakeParams
  | FundEscrowParams
  | ReleasePartialPaymentParams
  | ReleaseFinalPaymentParams;

// ============================================================================
// Transition Names (String Literals)
// ============================================================================

export const TRANSITION_NAMES = {
  CREATE_RFQ: 'create_rfq',
  SUBMIT_BID_COMMIT: 'submit_bid_commit',
  CLOSE_BIDDING: 'close_bidding',
  REVEAL_BID: 'reveal_bid',
  SELECT_WINNER: 'select_winner',
  SLASH_NON_REVEALER: 'slash_non_revealer',
  REFUND_STAKE: 'refund_stake',
  FUND_ESCROW: 'fund_escrow',
  RELEASE_PARTIAL_PAYMENT: 'release_partial_payment',
  RELEASE_FINAL_PAYMENT: 'release_final_payment',
} as const;

export type TransitionName = typeof TRANSITION_NAMES[keyof typeof TRANSITION_NAMES];

// ============================================================================
// Constants (From Contract)
// ============================================================================

/** RFQ status: Does not exist */
export const STATUS_NONE = 0 as u8;

/** RFQ status: Open for bidding */
export const STATUS_OPEN = 1 as u8;

/** RFQ status: Bidding closed, reveal period active */
export const STATUS_CLOSED = 2 as u8;

/** RFQ status: Winner selected */
export const STATUS_WINNER_SELECTED = 3 as u8;

/** RFQ status: Escrow funded */
export const STATUS_ESCROW_FUNDED = 4 as u8;

/** RFQ status: Payment completed */
export const STATUS_COMPLETED = 5 as u8;

/** Maximum bid amount (1 billion credits) */
export const MAX_BID_AMOUNT = BigInt(1_000_000_000);

/** Error code constants (for validation) */
export const ERROR_CODES = {
  /** RFQ ID cannot be zero */
  INVALID_RFQ_ID: 1,
  
  /** Deadline must be in the future */
  INVALID_DEADLINE: 2,
  
  /** Min bid must be positive and < MAX_BID_AMOUNT */
  INVALID_MIN_BID: 3,
  
  /** RFQ already exists */
  DUPLICATE_RFQ: 4,
  
  /** Wrong RFQ status for this operation */
  WRONG_STATUS: 5,
  
  /** Caller is not authorized */
  UNAUTHORIZED: 6,
  
  /** Deadline not reached or passed */
  DEADLINE_VIOLATION: 7,
  
  /** Commitment hash mismatch */
  COMMITMENT_MISMATCH: 8,
  
  /** Invalid nonce (replay attack) */
  REPLAY_ATTACK: 9,
  
  /** Escrow invariant violated */
  ESCROW_VIOLATION: 10,
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
