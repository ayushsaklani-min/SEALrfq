export const TxStatus = {
    PREPARED: 'PREPARED',
    SUBMITTED: 'SUBMITTED',
    CONFIRMED: 'CONFIRMED',
    REJECTED: 'REJECTED',
    EXPIRED: 'EXPIRED',
} as const;
export type TxStatus = typeof TxStatus[keyof typeof TxStatus];

export const RFQStatus = {
    NONE: 'NONE',
    OPEN: 'OPEN',
    CLOSED: 'CLOSED',
    WINNER_SELECTED: 'WINNER_SELECTED',
    ESCROW_FUNDED: 'ESCROW_FUNDED',
    COMPLETED: 'COMPLETED',
} as const;
export type RFQStatus = typeof RFQStatus[keyof typeof RFQStatus];

export const EventType = {
    RFQ_CREATED: 'RFQ_CREATED',
    BID_COMMITTED: 'BID_COMMITTED',
    BIDDING_CLOSED: 'BIDDING_CLOSED',
    BID_REVEALED: 'BID_REVEALED',
    WINNER_SELECTED: 'WINNER_SELECTED',
    STAKE_SLASHED: 'STAKE_SLASHED',
    ESCROW_FUNDED: 'ESCROW_FUNDED',
    PAYMENT_RELEASED: 'PAYMENT_RELEASED',
} as const;
export type EventType = typeof EventType[keyof typeof EventType];

export const ErrorClass = {
    TRANSIENT: 'TRANSIENT',
    LOGICAL: 'LOGICAL',
    NETWORK: 'NETWORK',
    UNKNOWN: 'UNKNOWN',
} as const;
export type ErrorClass = typeof ErrorClass[keyof typeof ErrorClass];
