// SealRFQ Phase 0 Proof of Concept
// Privacy-first RFQ with commit-reveal bids and escrow
// Leo 3.4.0 - Async/Await Model

program sealrfq_poc.aleo {
    
    mapping rfq_status: field => u8;
    mapping bid_commitments: field => field;
    mapping revealed_bids: field => u64;
    mapping winner_bids: field => field;
    mapping escrow_amounts: field => u64;

    @noupgrade
    async constructor() {
    }
    
    // TRANSITION 1: Create RFQ
    async transition create_rfq(
        public rfq_id: field,
        public bidding_deadline: u32,
        public reveal_deadline: u32,
        public min_bid: u64
    ) -> Future {
        return finalize_create_rfq(rfq_id);
    }
    
    async function finalize_create_rfq(rfq_id: field) {
        Mapping::set(rfq_status, rfq_id, 1u8);
    }
    
    // TRANSITION 2: Submit Bid Commitment
    async transition submit_bid_commit(
        public rfq_id: field,
        bid_amount: u64,
        nonce: field,
        public stake: u64,
        public bid_id: field
    ) -> Future {
        let commitment: field = BHP256::hash_to_field(bid_amount);
        return finalize_submit_bid_commit(bid_id, commitment, rfq_id);
    }
    
    async function finalize_submit_bid_commit(
        bid_id: field,
        commitment: field,
        rfq_id: field
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, 1u8);
        Mapping::set(bid_commitments, bid_id, commitment);
    }
    
    // TRANSITION 3: Close Bidding
    async transition close_bidding(
        public rfq_id: field
    ) -> Future {
        return finalize_close_bidding(rfq_id);
    }
    
    async function finalize_close_bidding(rfq_id: field) {
        Mapping::set(rfq_status, rfq_id, 2u8);
    }
    
    // TRANSITION 4: Reveal Bid
    async transition reveal_bid(
        public rfq_id: field,
        public bid_id: field,
        bid_amount: u64,
        nonce: field
    ) -> Future {
        let commitment: field = BHP256::hash_to_field(bid_amount);
        return finalize_reveal_bid(bid_id, bid_amount, rfq_id, commitment);
    }
    
    async function finalize_reveal_bid(
        bid_id: field,
        bid_amount: u64,
        rfq_id: field,
        commitment: field
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, 2u8);
        
        let stored: field = Mapping::get(bid_commitments, bid_id);
        assert_eq(stored, commitment);
        
        Mapping::set(revealed_bids, bid_id, bid_amount);
    }
    
    // TRANSITION 5: Select Winner
    async transition select_winner(
        public rfq_id: field,
        public winning_bid_id: field
    ) -> Future {
        return finalize_select_winner(rfq_id, winning_bid_id);
    }
    
    async function finalize_select_winner(
        rfq_id: field,
        winning_bid_id: field
    ) {
        let bid_amount: u64 = Mapping::get(revealed_bids, winning_bid_id);
        assert(bid_amount > 0u64);
        
        Mapping::set(winner_bids, rfq_id, winning_bid_id);
        Mapping::set(rfq_status, rfq_id, 3u8);
    }
    
    // TRANSITION 6: Slash Non-Revealer
    async transition slash_non_revealer(
        public rfq_id: field,
        public bid_id: field
    ) -> Future {
        return finalize_slash_non_revealer(rfq_id, bid_id);
    }
    
    async function finalize_slash_non_revealer(
        rfq_id: field,
        bid_id: field
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert(status >= 2u8);
        
        let commitment: field = Mapping::get(bid_commitments, bid_id);
        assert(commitment != 0field);
        
        let revealed: u64 = Mapping::get_or_use(revealed_bids, bid_id, 0u64);
        assert_eq(revealed, 0u64);
    }
    
    // TRANSITION 7: Refund Stake
    transition refund_stake(public bid_id: field) {
        return;
    }
    
    // TRANSITION 8: Fund Escrow
    async transition fund_escrow(
        public rfq_id: field,
        public amount: u64
    ) -> Future {
        return finalize_fund_escrow(rfq_id, amount);
    }
    
    async function finalize_fund_escrow(
        rfq_id: field,
        amount: u64
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, 3u8);
        Mapping::set(escrow_amounts, rfq_id, amount);
    }
    
    // TRANSITION 9: Release Partial Payment
    async transition release_partial_payment(
        public rfq_id: field,
        public percentage: u8,
        public recipient: address
    ) -> Future {
        return finalize_release_partial(rfq_id, percentage);
    }
    
    async function finalize_release_partial(
        rfq_id: field,
        percentage: u8
    ) {
        let total: u64 = Mapping::get(escrow_amounts, rfq_id);
        let amount: u64 = (total * (percentage as u64)) / 100u64;
        assert(amount <= total);
    }
    
    // TRANSITION 10: Release Final Payment
    async transition release_final_payment(
        public rfq_id: field,
        public recipient: address
    ) -> Future {
        return finalize_release_final(rfq_id);
    }
    
    async function finalize_release_final(rfq_id: field) {
        let total: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert(total > 0u64);
        Mapping::set(escrow_amounts, rfq_id, 0u64);
    }
}
