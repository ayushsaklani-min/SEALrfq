/**
 * Fee estimation for Aleo transitions.
 *
 * Fees are denominated in microcredits (1 ALEO = 1,000,000 microcredits).
 *
 * Values are calibrated against testnet execution costs and include a safety
 * buffer. Override any transition via env var ALEO_FEE_<TRANSITION>=<microcredits>.
 *
 * Mainnet note: actual fees depend on proof size and network congestion.
 * These estimates should be re-validated before mainnet launch.
 */

/** Base fee per transition (microcredits) */
const TRANSITION_FEES: Record<string, bigint> = {
    // Simple state updates
    close_bidding:              BigInt(500_000),
    cancel_rfq:                 BigInt(500_000),
    cancel_rfq_insufficient_bids: BigInt(500_000),
    winner_accept:              BigInt(500_000),
    winner_decline:             BigInt(600_000),

    // Moderate complexity — stake / escrow movements
    submit_bid_commit:          BigInt(1_000_000),
    reveal_bid:                 BigInt(1_200_000),
    refund_stake:               BigInt(800_000),
    refund_stake_cancelled:     BigInt(800_000),
    refund_stake_declined:      BigInt(800_000),
    slash_non_revealer:         BigInt(800_000),
    release_winner_stake:       BigInt(800_000),
    claim_locked_winner_stake:  BigInt(800_000),
    reclaim_unrevealed_stake:   BigInt(800_000),

    // Higher complexity — RFQ / winner / escrow creation
    create_rfq:                 BigInt(1_500_000),
    select_winner:              BigInt(1_500_000),
    fund_escrow:                BigInt(1_200_000),
    creator_reclaim_escrow:     BigInt(1_000_000),

    // Payment releases — escrow + finalize logic
    release_partial_payment:    BigInt(1_500_000),
    release_final_payment:      BigInt(1_500_000),

    // Timeout recovery
    cancel_rfq_stuck_reveal:    BigInt(700_000),
    cancel_rfq_no_escrow:       BigInt(700_000),
};

const DEFAULT_FEE = BigInt(1_000_000);

/**
 * Return the estimated fee for a given transition name.
 * Respects per-transition env var overrides.
 */
export function estimateFee(transition: string): bigint {
    // Allow per-transition override via env: ALEO_FEE_CREATE_RFQ=2000000
    const envKey = `ALEO_FEE_${transition.toUpperCase()}`;
    const envOverride = process.env[envKey];
    if (envOverride && /^\d+$/.test(envOverride)) {
        return BigInt(envOverride);
    }

    // Global override for all transitions
    const globalOverride = process.env.ALEO_DEFAULT_FEE;
    if (globalOverride && /^\d+$/.test(globalOverride)) {
        return BigInt(globalOverride);
    }

    return TRANSITION_FEES[transition] ?? DEFAULT_FEE;
}
