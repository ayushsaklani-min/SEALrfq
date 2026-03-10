/** Aleo transaction descriptor used to prepare and execute on-chain transitions. */
export type AleoTransaction = {
    program: string;
    function: string;
    inputs: string[];
    fee: bigint;
};

/** Contract event types used by the indexer/processor. */

export type RFQCreatedEvent = {
    rfq_id: string;
    buyer: string;
    bidding_deadline: number;
    reveal_deadline: number;
    min_bid: bigint;
};

export type BidCommittedEvent = {
    rfq_id: string;
    bid_id: string;
    vendor: string;
    commitment_hash: string;
    stake: bigint;
};

export type BiddingClosedEvent = {
    rfq_id: string;
    buyer: string;
};

export type BidRevealedEvent = {
    rfq_id: string;
    bid_id: string;
    vendor: string;
    revealed_amount: bigint;
};

export type WinnerSelectedEvent = {
    rfq_id: string;
    winning_bid_id: string;
    winning_vendor: string;
    winning_amount: bigint;
};

export type StakeSlashedEvent = {
    rfq_id: string;
    bid_id: string;
    slashed_vendor: string;
    slashed_amount: bigint;
};

export type EscrowFundedEvent = {
    rfq_id: string;
    buyer: string;
    amount: bigint;
};

export type PaymentReleasedEvent = {
    rfq_id: string;
    recipient: string;
    amount: bigint;
    is_final: boolean;
};

export type ContractEvent =
    | RFQCreatedEvent
    | BidCommittedEvent
    | BiddingClosedEvent
    | BidRevealedEvent
    | WinnerSelectedEvent
    | StakeSlashedEvent
    | EscrowFundedEvent
    | PaymentReleasedEvent;
