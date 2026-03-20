const TRANSITION_FEES: Record<string, bigint> = {
    configure_platform: BigInt(1_000_000),
    withdraw_fees: BigInt(900_000),
    withdraw_fees_usdcx: BigInt(1_100_000),
    create_rfq: BigInt(1_700_000),
    submit_bid_commit: BigInt(1_200_000),
    reveal_bid: BigInt(1_300_000),
    select_winner: BigInt(1_500_000),
    winner_respond: BigInt(900_000),
    cancel_rfq_post_deadline: BigInt(900_000),
    refund_any_stake: BigInt(900_000),
    slash_non_revealer: BigInt(900_000),
    fund_escrow: BigInt(1_300_000),
    fund_escrow_usdcx: BigInt(1_400_000),
    fund_escrow_usad: BigInt(1_400_000),
    release_partial_payment: BigInt(1_600_000),
    release_partial_usdcx: BigInt(1_700_000),
    release_partial_usad: BigInt(1_700_000),
    pay_invoice: BigInt(1_800_000),
    pay_invoice_usdcx: BigInt(2_000_000),
    pay_invoice_usad: BigInt(2_000_000),
    release_final_payment: BigInt(1_500_000),
    release_final_usdcx: BigInt(1_600_000),
    release_final_usad: BigInt(1_600_000),
    creator_reclaim_escrow: BigInt(1_100_000),
    creator_reclaim_escrow_usdcx: BigInt(1_200_000),
    creator_reclaim_escrow_usad: BigInt(1_200_000),
    winner_claim_escrow: BigInt(1_100_000),
    winner_claim_usdcx: BigInt(1_200_000),
    winner_claim_usad: BigInt(1_200_000),
    import_auction_result: BigInt(1_100_000),
    create_auction: BigInt(1_500_000),
    commit_bid: BigInt(1_200_000),
    finalize_auction: BigInt(1_300_000),
    cancel_auction: BigInt(800_000),
    slash_unrevealed: BigInt(900_000),
    accept_price: BigInt(1_200_000),
    commit_accept: BigInt(1_200_000),
    confirm_accept: BigInt(1_200_000),
    expire_auction: BigInt(800_000),
    refund_commit_stake: BigInt(800_000),
};

const DEFAULT_FEE = BigInt(1_000_000);

export function estimateFee(transition: string): bigint {
    const envKey = `ALEO_FEE_${transition.toUpperCase()}`;
    const envOverride = process.env[envKey];
    if (envOverride && /^\d+$/.test(envOverride)) {
        return BigInt(envOverride);
    }

    const globalOverride = process.env.ALEO_DEFAULT_FEE;
    if (globalOverride && /^\d+$/.test(globalOverride)) {
        return BigInt(globalOverride);
    }

    return TRANSITION_FEES[transition] ?? DEFAULT_FEE;
}
