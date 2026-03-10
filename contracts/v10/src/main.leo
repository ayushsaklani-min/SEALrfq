import credits.aleo;

// ═══════════════════════════════════════════════════════════════════════════════
// sealrfq_v10.aleo — Sealed-Bid RFQ Protocol (Production / Testnet)
//
// Differences from sealrfq_v9.aleo (demo contract):
//   MIN_REVEAL_WINDOW    10  → 720  blocks  (~1 hour  at 5s/block)
//   ESCROW_TIMEOUT_BLOCKS 20 → 2160 blocks  (~3 hours)
//   SLASH_WINDOW          20 → 1440 blocks  (~2 hours)
//   ESCROW_RECOVERY_BLOCKS 30 → 2880 blocks (~4 hours)
//
// For demo video recording use sealrfq_v9.aleo (short timers).
// For production testnet / mainnet deployment use this contract.
program sealrfq_v10.aleo {

    // ─── CONSTANTS ───────────────────────────────────────────────────────────

    // 1 billion microcredits = 1,000 ALEO.
    const MAX_BID_AMOUNT:          u64 = 1_000_000_000u64;

    // Flat stake = floor(rfq_min_bid * 10 / 100). Uniform across all bidders
    // so the public stake amount reveals nothing about the private bid.
    const MIN_STAKE_PERCENTAGE:    u8  = 10u8;

    // Maximum total RFQ lifetime in blocks.
    const MAX_RFQ_DURATION:        u32 = 100_000u32;

    // Minimum reveal window: vendors have ~1 hour to reveal after bidding closes.
    // Testnet @ ~5s/block: 720 blocks = 3600s = 1 hour.
    const MIN_REVEAL_WINDOW:       u32 = 720u32;

    // Buyer must fund escrow within ~3 hours of winner selection.
    // Testnet @ ~5s/block: 2160 blocks = 10800s = 3 hours.
    const ESCROW_TIMEOUT_BLOCKS:   u32 = 2160u32;

    // Window to slash non-revealers after reveal deadline: ~2 hours.
    // Testnet @ ~5s/block: 1440 blocks = 7200s = 2 hours.
    const SLASH_WINDOW:            u32 = 1440u32;

    // Creator can reclaim escrow if winner disappears: ~4 hours after timeout.
    // Testnet @ ~5s/block: 2880 blocks = 14400s = 4 hours.
    const ESCROW_RECOVERY_BLOCKS:  u32 = 2880u32;

    // Minimum partial release as percentage of escrow_original.
    // Prevents griefing via thousands of dust-level partial payments.
    const MIN_PARTIAL_RELEASE_PCT: u8  = 1u8;

    // ─── STATUS CODES ────────────────────────────────────────────────────────
    const STATUS_NONE:             u8 = 0u8;
    const STATUS_OPEN:             u8 = 1u8;
    const STATUS_REVEAL:           u8 = 2u8;
    const STATUS_WINNER_SELECTED:  u8 = 3u8;
    const STATUS_ESCROW_FUNDED:    u8 = 4u8;
    const STATUS_COMPLETED:        u8 = 5u8;
    const STATUS_CANCELLED:        u8 = 6u8;
    const STATUS_WINNER_DECLINED:  u8 = 7u8;

    // ─── STRUCTS ─────────────────────────────────────────────────────────────

    // Both bid_amount and nonce are private inputs — never visible on-chain.
    // Commitment is preimage-resistant given a random nonce.
    struct CommitmentInput {
        bid_amount: u64,
        nonce:      field,
    }

    // Hashed key for per-actor per-action per-rfq nonce tracking.
    struct NonceKey {
        actor:      address,
        action_tag: u8,
        rfq_id:     field,
    }

    // Hashed key for per-vendor per-rfq bid count tracking.
    struct VendorRFQKey {
        vendor: address,
        rfq_id: field,
    }

    // Composite key for all bid-level mappings.
    struct BidKey {
        rfq_id: field,
        bid_id: field,
    }

    // ─── RECORDS ─────────────────────────────────────────────────────────────
    // All records are private to their owner by Aleo's record model.

    record RFQCreated {
        owner:            address,
        rfq_id:           field,
        creator:          address,
        bidding_deadline: u32,
        reveal_deadline:  u32,
        min_bid:          u64,
        min_bid_count:    u64,
        flat_stake:       u64,
        metadata_hash:    field,
    }

    record BidCommitted {
        owner:  address,
        rfq_id: field,
        bid_id: field,
        vendor: address,
        stake:  u64,
    }

    record BidRevealed {
        owner:      address,
        rfq_id:     field,
        bid_id:     field,
        bid_amount: u64,
    }

    record WinnerSelected {
        owner:          address,
        rfq_id:         field,
        winning_bid_id: field,
        winner_address: address,
        winning_amount: u64,
    }

    record WinnerAccepted {
        owner:  address,
        rfq_id: field,
    }

    record WinnerDeclined {
        owner:  address,
        rfq_id: field,
    }

    record EscrowFunded {
        owner:  address,
        rfq_id: field,
        amount: u64,
    }

    record PartialPaymentReleased {
        owner:          address,
        rfq_id:         field,
        release_amount: u64,
        total_released: u64,
        percentage:     u8,
    }

    record FinalPaymentReleased {
        owner:          address,
        rfq_id:         field,
        release_amount: u64,
    }

    record StakeRefunded {
        owner:  address,
        rfq_id: field,
        bid_id: field,
        amount: u64,
    }

    record StakeSlashed {
        owner:   address,
        rfq_id:  field,
        bid_id:  field,
        amount:  u64,
        creator: address,
    }

    record WinnerStakeReleased {
        owner:  address,
        rfq_id: field,
        amount: u64,
    }

    record EscrowReclaimed {
        owner:   address,
        rfq_id:  field,
        creator: address,
        amount:  u64,
    }

    record RFQCancelled {
        owner:   address,
        rfq_id:  field,
        creator: address,
    }

    record UnrevealedStakeReclaimed {
        owner:  address,
        rfq_id: field,
        bid_id: field,
        amount: u64,
    }

    // ─── MAPPINGS ────────────────────────────────────────────────────────────

    // RFQ lifecycle
    mapping rfq_status:                field => u8;
    mapping rfq_bidding_deadlines:     field => u32;
    mapping rfq_reveal_deadlines:      field => u32;
    mapping rfq_min_bids:              field => u64;
    mapping rfq_min_bid_count:         field => u64;
    mapping rfq_creators:              field => address;
    mapping rfq_bid_count:             field => u64;
    mapping rfq_winner_address:        field => address;
    mapping rfq_winner_selected_block: field => u32;
    mapping rfq_escrow_funded_block:   field => u32;
    mapping rfq_escrow_timeout_block:  field => u32;   // [MED-3 FIX] now defined and populated
    mapping rfq_metadata_hash:         field => field;
    mapping rfq_lowest_bid:            field => u64;
    mapping rfq_lowest_bid_id:         field => field;
    mapping rfq_flat_stake:            field => u64;
    mapping rfq_revealed_count:        field => u64;

    // Bid-level state (keyed by BHP256::hash_to_field(BidKey{rfq_id, bid_id}))
    mapping bid_commitments:  field => field;
    mapping bid_owner:        field => address;
    mapping revealed_bids:    field => u64;
    mapping bid_stakes:       field => u64;
    mapping winner_bids:      field => field;
    mapping vendor_bid_count: field => u64;

    // Escrow accounting
    mapping escrow_original:        field => u64;
    mapping escrow_amounts:         field => u64;
    mapping total_released:         field => u64;
    mapping final_payment_released: field => bool;

    // Replay-protection nonces (per actor, per action_tag, per rfq — strictly sequential)
    mapping actor_commit_nonces:  field => u64;
    mapping actor_reveal_nonces:  field => u64;
    mapping actor_payment_nonces: field => u64;

    // Winner acceptance gate (false = pending, true = accepted)
    mapping rfq_winner_accepted: field => bool;

    @noupgrade
    async constructor() {}

    // ═══════════════════════════════════════════════════════════════════════
    // 1. CREATE RFQ
    // Creator registers a new sealed-bid RFQ with deadlines and parameters.
    // ═══════════════════════════════════════════════════════════════════════

    async transition create_rfq(
        public rfq_id:           field,
        public bidding_deadline: u32,
        public reveal_deadline:  u32,
        public min_bid:          u64,
        public min_bid_count:    u64,
        public metadata_hash:    field
    ) -> (RFQCreated, Future) {
        assert(rfq_id        != 0field);
        assert(min_bid        > 0u64);
        assert(min_bid        < MAX_BID_AMOUNT);
        assert(min_bid_count  > 0u64);
        assert(metadata_hash != 0field);
        // Transition-side guard prevents submitting a provably invalid tx.
        assert(reveal_deadline > bidding_deadline);

        // Pre-compute the flat stake for bidders' convenience.
        // All bidders pay this same amount so the public transfer reveals
        // nothing about individual private bid amounts. [PRIV-1 from v6]
        let flat_stake: u64 = (min_bid * (MIN_STAKE_PERCENTAGE as u64)) / 100u64;
        assert(flat_stake > 0u64);

        let event: RFQCreated = RFQCreated {
            owner:            self.caller,
            rfq_id:           rfq_id,
            creator:          self.caller,
            bidding_deadline: bidding_deadline,
            reveal_deadline:  reveal_deadline,
            min_bid:          min_bid,
            min_bid_count:    min_bid_count,
            flat_stake:       flat_stake,
            metadata_hash:    metadata_hash,
        };

        let f: Future = finalize_create_rfq(
            rfq_id, bidding_deadline, reveal_deadline,
            min_bid, min_bid_count, metadata_hash, flat_stake, self.caller
        );

        return (event, f);
    }

    async function finalize_create_rfq(
        rfq_id:           field,
        bidding_deadline: u32,
        reveal_deadline:  u32,
        min_bid:          u64,
        min_bid_count:    u64,
        metadata_hash:    field,
        flat_stake:       u64,
        creator:          address
    ) {
        // Sentinel guard — 0field is used as "not set" in several mappings.
        assert(rfq_id != 0field);

        let now: u32 = block.height;
        assert(bidding_deadline  > now);
        assert(bidding_deadline  <= now + MAX_RFQ_DURATION);
        assert(reveal_deadline   > now);
        assert(reveal_deadline   <= now + MAX_RFQ_DURATION);
        // [MIN-1 FIX] Explicit guard before the subtraction prevents u32 wrap-around.
        assert(reveal_deadline   > bidding_deadline);
        assert(reveal_deadline - bidding_deadline >= MIN_REVEAL_WINDOW);

        // Idempotency: rfq_id must not already exist.
        let existing: u8 = Mapping::get_or_use(rfq_status, rfq_id, STATUS_NONE);
        assert_eq(existing, STATUS_NONE);

        Mapping::set(rfq_status,            rfq_id, STATUS_OPEN);
        Mapping::set(rfq_bidding_deadlines, rfq_id, bidding_deadline);
        Mapping::set(rfq_reveal_deadlines,  rfq_id, reveal_deadline);
        Mapping::set(rfq_min_bids,          rfq_id, min_bid);
        Mapping::set(rfq_min_bid_count,     rfq_id, min_bid_count);
        Mapping::set(rfq_creators,          rfq_id, creator);
        Mapping::set(rfq_bid_count,         rfq_id, 0u64);
        Mapping::set(rfq_metadata_hash,     rfq_id, metadata_hash);
        Mapping::set(rfq_lowest_bid,        rfq_id, MAX_BID_AMOUNT);
        Mapping::set(rfq_lowest_bid_id,     rfq_id, 0field);
        Mapping::set(rfq_flat_stake,        rfq_id, flat_stake);
        Mapping::set(rfq_revealed_count,    rfq_id, 0u64);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. SUBMIT BID COMMIT
    //
    // [CRIT-2 FIX] bid_amount is no longer passed to finalize.
    // Instead, the caller supplies claimed_min_bid (a public value):
    //   - Transition (ZK circuit) privately proves: bid_amount >= claimed_min_bid
    //   - Finalize on-chain validates:               claimed_min_bid == rfq_min_bids[rfq_id]
    // Together: bid_amount >= min_bid is proven without leaking bid_amount.
    //
    // Only one bid per vendor per RFQ is permitted.
    // Stake is a flat amount (rfq_flat_stake) — uniform across all bidders.
    // ═══════════════════════════════════════════════════════════════════════

    async transition submit_bid_commit(
        public rfq_id:          field,
               bid_amount:      u64,    // PRIVATE — stays in ZK circuit, never on-chain
               nonce:           field,  // PRIVATE — stays in ZK circuit, never on-chain
        public stake:           u64,    // Must equal rfq_flat_stake[rfq_id]
        public bid_id:          field,
        public user_nonce:      u64,
        public claimed_min_bid: u64    // [CRIT-2 FIX] public; validated against on-chain min_bid in finalize
    ) -> (BidCommitted, Future) {
        assert(bid_id          != 0field);
        assert(bid_amount       > 0u64);
        assert(bid_amount       < MAX_BID_AMOUNT);
        assert(stake            > 0u64);
        assert(stake            < MAX_BID_AMOUNT);
        // Zero nonce reduces commitment to hash(bid_amount, 0) — brute-forceable. [BUG-1 from v6]
        assert(nonce           != 0field);

        // [CRIT-2 FIX] ZK circuit privately proves bid_amount >= claimed_min_bid.
        // finalize will verify claimed_min_bid == actual on-chain min_bid.
        assert(bid_amount >= claimed_min_bid);

        let commitment: field = BHP256::hash_to_field(CommitmentInput {
            bid_amount: bid_amount,
            nonce:      nonce,
        });

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 1u8,
            rfq_id:     rfq_id,
        });

        let vendor_rfq_key: field = BHP256::hash_to_field(VendorRFQKey {
            vendor: self.caller,
            rfq_id: rfq_id,
        });

        let unique_bid_key: field = BHP256::hash_to_field(BidKey {
            rfq_id: rfq_id,
            bid_id: bid_id,
        });

        // Debit the wallet signer and credit the program account.
        let stake_future: Future = credits.aleo/transfer_public_as_signer(self.address, stake);

        let event: BidCommitted = BidCommitted {
            owner:  self.caller,
            rfq_id: rfq_id,
            bid_id: bid_id,
            vendor: self.caller,
            stake:  stake,
        };

        let f: Future = finalize_submit_bid_commit(
            unique_bid_key, commitment, rfq_id,
            claimed_min_bid, stake, nonce_key, user_nonce,
            self.caller, vendor_rfq_key, stake_future
        );

        return (event, f);
    }

    async function finalize_submit_bid_commit(
        unique_bid_key: field,
        commitment:     field,
        rfq_id:         field,
        claimed_min_bid: u64,   // [CRIT-2 FIX] replaces bid_amount — carries no private info
        stake:          u64,
        nonce_key:      field,
        user_nonce:     u64,
        vendor:         address,
        vendor_rfq_key: field,
        stake_future:   Future
    ) {
        // Strictly sequential nonces prevent replay.
        let stored_nonce: u64 = Mapping::get_or_use(actor_commit_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_OPEN);

        let bidding_deadline: u32 = Mapping::get(rfq_bidding_deadlines, rfq_id);
        assert(block.height < bidding_deadline);

        // [CRIT-2 FIX] Validate claimed_min_bid equals the authoritative on-chain value.
        // Combined with the transition's assert(bid_amount >= claimed_min_bid),
        // this proves bid_amount >= rfq_min_bids[rfq_id] without leaking bid_amount.
        let actual_min_bid: u64 = Mapping::get(rfq_min_bids, rfq_id);
        assert_eq(claimed_min_bid, actual_min_bid);

        // Flat stake validation: all bidders must post exactly the same amount.
        let expected_flat_stake: u64 = Mapping::get(rfq_flat_stake, rfq_id);
        assert_eq(stake, expected_flat_stake);

        // Prevent duplicate bid_id within the same RFQ.
        let existing: field = Mapping::get_or_use(bid_commitments, unique_bid_key, 0field);
        assert_eq(existing, 0field);

        // Each vendor may submit at most one bid per RFQ.
        let existing_count: u64 = Mapping::get_or_use(vendor_bid_count, vendor_rfq_key, 0u64);
        assert_eq(existing_count, 0u64);

        stake_future.await();

        Mapping::set(bid_commitments,  unique_bid_key, commitment);
        Mapping::set(bid_owner,        unique_bid_key, vendor);
        Mapping::set(bid_stakes,       unique_bid_key, stake);
        Mapping::set(vendor_bid_count, vendor_rfq_key, 1u64);

        let count: u64 = Mapping::get_or_use(rfq_bid_count, rfq_id, 0u64);
        Mapping::set(rfq_bid_count, rfq_id, count + 1u64);

        Mapping::set(actor_commit_nonces, nonce_key, user_nonce);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. CLOSE BIDDING
    // Permissionless — anyone can advance state once the bidding deadline has
    // passed AND the minimum bid count is met.
    // ═══════════════════════════════════════════════════════════════════════

    async transition close_bidding(
        public rfq_id: field
    ) -> Future {
        return finalize_close_bidding(rfq_id);
    }

    async function finalize_close_bidding(rfq_id: field) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_OPEN);

        let bidding_deadline: u32 = Mapping::get(rfq_bidding_deadlines, rfq_id);
        assert(block.height >= bidding_deadline);

        let bid_count: u64 = Mapping::get_or_use(rfq_bid_count, rfq_id, 0u64);
        let min_count: u64 = Mapping::get(rfq_min_bid_count, rfq_id);
        assert(bid_count >= min_count);

        Mapping::set(rfq_status, rfq_id, STATUS_REVEAL);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. REVEAL BID
    // [MED-1 FIX] finalize now asserts bid_amount >= rfq_min_bids[rfq_id].
    // The commitment scheme prevents amount-switching, but the on-chain check
    // provides defense-in-depth and is consistent with the CRIT-2 fix.
    // ═══════════════════════════════════════════════════════════════════════

    async transition reveal_bid(
        public rfq_id:     field,
        public bid_id:     field,
               bid_amount: u64,    // PRIVATE — but publicly recorded on-chain after reveal
               nonce:      field,  // PRIVATE — never stored
        public user_nonce: u64
    ) -> (BidRevealed, Future) {
        assert(bid_amount > 0u64);
        assert(bid_amount < MAX_BID_AMOUNT);
        assert(nonce != 0field);

        let commitment: field = BHP256::hash_to_field(CommitmentInput {
            bid_amount: bid_amount,
            nonce:      nonce,
        });

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 2u8,
            rfq_id:     rfq_id,
        });

        let unique_bid_key: field = BHP256::hash_to_field(BidKey {
            rfq_id: rfq_id,
            bid_id: bid_id,
        });

        let event: BidRevealed = BidRevealed {
            owner:      self.caller,
            rfq_id:     rfq_id,
            bid_id:     bid_id,
            bid_amount: bid_amount,
        };

        let f: Future = finalize_reveal_bid(
            unique_bid_key, bid_id, bid_amount, rfq_id, commitment,
            nonce_key, user_nonce, self.caller
        );

        return (event, f);
    }

    async function finalize_reveal_bid(
        unique_bid_key: field,
        bid_id:         field,
        bid_amount:     u64,
        rfq_id:         field,
        commitment:     field,
        nonce_key:      field,
        user_nonce:     u64,
        caller:         address
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_reveal_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_REVEAL);

        let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
        assert(block.height < reveal_deadline);

        // Caller must be the original bid owner.
        let owner: address = Mapping::get(bid_owner, unique_bid_key);
        assert_eq(owner, caller);

        // Commitment must exist and must match the hash of revealed values.
        let stored: field = Mapping::get_or_use(bid_commitments, unique_bid_key, 0field);
        assert(stored != 0field);
        assert_eq(stored, commitment);

        // Prevent double-reveal.
        let already_revealed: u64 = Mapping::get_or_use(revealed_bids, unique_bid_key, 0u64);
        assert_eq(already_revealed, 0u64);

        // [MED-1 FIX] Defense-in-depth: confirm the revealed amount meets the minimum.
        // The commitment scheme guarantees no amount-switching, but this on-chain
        // assertion provides an additional layer of validation.
        let min_bid: u64 = Mapping::get(rfq_min_bids, rfq_id);
        assert(bid_amount >= min_bid);

        Mapping::set(revealed_bids, unique_bid_key, bid_amount);

        // Update running lowest-bid tracker.
        // [PRIV-3 NOTE] This is publicly observable — a watching vendor may choose
        // not to reveal if already outbid. Accepted design tradeoff for on-chain auctions.
        let current_lowest: u64      = Mapping::get_or_use(rfq_lowest_bid,    rfq_id, MAX_BID_AMOUNT);
        let current_lowest_id: field = Mapping::get_or_use(rfq_lowest_bid_id, rfq_id, 0field);

        let is_lower: bool       = bid_amount < current_lowest;
        let new_lowest: u64      = is_lower ? bid_amount : current_lowest;
        let new_lowest_id: field = is_lower ? bid_id : current_lowest_id;

        Mapping::set(rfq_lowest_bid,    rfq_id, new_lowest);
        Mapping::set(rfq_lowest_bid_id, rfq_id, new_lowest_id);
        let reveal_count: u64 = Mapping::get_or_use(rfq_revealed_count, rfq_id, 0u64);
        Mapping::set(rfq_revealed_count, rfq_id, reveal_count + 1u64);

        Mapping::set(actor_reveal_nonces, nonce_key, user_nonce);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. SELECT WINNER
    // Permissionless after reveal deadline. Caller supplies the claimed winner;
    // finalize validates ALL claims against on-chain truth.
    // Tie-breaking: first-revealer wins (first-write-wins). Intentional design.
    // ═══════════════════════════════════════════════════════════════════════

    async transition select_winner(
        public rfq_id:         field,
        public winning_bid_id: field,
        public winning_amount: u64,
        public winner_address: address
    ) -> (WinnerSelected, Future) {
        assert(winning_bid_id != 0field);
        assert(winning_amount  > 0u64);
        assert(winner_address != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);

        let unique_bid_key: field = BHP256::hash_to_field(BidKey {
            rfq_id: rfq_id,
            bid_id: winning_bid_id,
        });

        let event: WinnerSelected = WinnerSelected {
            owner:          self.caller,
            rfq_id:         rfq_id,
            winning_bid_id: winning_bid_id,
            winner_address: winner_address,
            winning_amount: winning_amount,
        };

        let f: Future = finalize_select_winner(
            rfq_id, winning_bid_id, unique_bid_key, winning_amount, winner_address
        );

        return (event, f);
    }

    async function finalize_select_winner(
        rfq_id:         field,
        winning_bid_id: field,
        unique_bid_key: field,
        winning_amount: u64,
        winner_address: address
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_REVEAL);

        let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
        assert(block.height >= reveal_deadline);

        // Validate winning_amount against on-chain revealed value (cannot be spoofed).
        let actual_winning_amount: u64 = Mapping::get_or_use(revealed_bids, unique_bid_key, 0u64);
        assert(actual_winning_amount > 0u64);
        assert_eq(winning_amount, actual_winning_amount);

        // Supplied bid_id must match the on-chain tracked lowest bid.
        let lowest_bid_id: field = Mapping::get(rfq_lowest_bid_id, rfq_id);
        assert_eq(winning_bid_id, lowest_bid_id);

        // Validate winner_address against on-chain bid owner.
        let actual_winner: address = Mapping::get(bid_owner, unique_bid_key);
        assert_eq(winner_address, actual_winner);

        // Zero-address guard.
        assert(actual_winner != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);

        Mapping::set(winner_bids,               rfq_id, unique_bid_key);
        Mapping::set(rfq_winner_address,        rfq_id, actual_winner);
        Mapping::set(rfq_status,                rfq_id, STATUS_WINNER_SELECTED);
        Mapping::set(rfq_winner_selected_block, rfq_id, block.height);
        // Initialise acceptance state to false — winner must explicitly accept.
        Mapping::set(rfq_winner_accepted,       rfq_id, false);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6. WINNER ACCEPT
    // Selected winner explicitly accepts the award. Only after acceptance
    // can the creator fund the escrow — prevents forced commitments.
    // ═══════════════════════════════════════════════════════════════════════

    async transition winner_accept(
        public rfq_id: field
    ) -> (WinnerAccepted, Future) {
        let event: WinnerAccepted = WinnerAccepted {
            owner:  self.caller,
            rfq_id: rfq_id,
        };
        let f: Future = finalize_winner_accept(rfq_id, self.caller);
        return (event, f);
    }

    async function finalize_winner_accept(rfq_id: field, caller: address) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_WINNER_SELECTED);

        let winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(caller, winner);

        // Idempotency guard — can only accept once.
        let already_accepted: bool = Mapping::get_or_use(rfq_winner_accepted, rfq_id, false);
        assert_eq(already_accepted, false);

        Mapping::set(rfq_winner_accepted, rfq_id, true);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 7. WINNER DECLINE
    // [CRIT-1 FIX] Winner's stake is now correctly slashed to the CREATOR.
    // In v6 the stake was transferred to self.caller (the winner), making
    // the decline penalty effectively zero. A new public `creator` parameter
    // is required and validated in finalize against rfq_creators[rfq_id].
    // ═══════════════════════════════════════════════════════════════════════

    async transition winner_decline(
        public rfq_id:   field,
        public stake:    u64,
        public creator:  address   // [CRIT-1 FIX] stake penalty recipient; validated on-chain
    ) -> (WinnerDeclined, Future) {
        // Guard against accidentally slashing to the zero address.
        assert(creator != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);

        // [CRIT-1 FIX] Slash the winner's stake to the creator as a decline penalty.
        let slash_future: Future = credits.aleo/transfer_public(creator, stake);

        let event: WinnerDeclined = WinnerDeclined {
            owner:  self.caller,
            rfq_id: rfq_id,
        };
        let f: Future = finalize_winner_decline(rfq_id, self.caller, stake, creator, slash_future);
        return (event, f);
    }

    async function finalize_winner_decline(
        rfq_id:       field,
        caller:       address,
        stake:        u64,
        creator:      address,
        slash_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_WINNER_SELECTED);

        // Only the selected winner may decline.
        let winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(caller, winner);

        // Cannot decline after having already accepted.
        let already_accepted: bool = Mapping::get_or_use(rfq_winner_accepted, rfq_id, false);
        assert_eq(already_accepted, false);

        // [CRIT-1 FIX] Validate the supplied creator is the actual RFQ creator.
        let actual_creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(creator, actual_creator);

        // Validate and zero stake before transfer (checks-effects-interactions).
        let winner_key: field   = Mapping::get(winner_bids, rfq_id);
        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, winner_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);
        Mapping::set(bid_stakes, winner_key, 0u64);

        slash_future.await();

        Mapping::set(rfq_status, rfq_id, STATUS_WINNER_DECLINED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 8. REFUND STAKE — WINNER DECLINED
    // Non-winners (revealed and unrevealed) reclaim stakes after winner declined.
    // ═══════════════════════════════════════════════════════════════════════

    async transition refund_stake_declined(
        public rfq_id: field,
        public bid_id: field,
        public stake:  u64
    ) -> (StakeRefunded, Future) {
        let unique_bid_key: field = BHP256::hash_to_field(BidKey {
            rfq_id: rfq_id,
            bid_id: bid_id,
        });
        let refund_future: Future = credits.aleo/transfer_public(self.caller, stake);

        let event: StakeRefunded = StakeRefunded {
            owner:  self.caller,
            rfq_id: rfq_id,
            bid_id: bid_id,
            amount: stake,
        };
        let f: Future = finalize_refund_declined(
            rfq_id, unique_bid_key, self.caller, stake, refund_future
        );
        return (event, f);
    }

    async function finalize_refund_declined(
        rfq_id:         field,
        unique_bid_key: field,
        caller:         address,
        stake:          u64,
        refund_future:  Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_WINNER_DECLINED);

        let owner: address = Mapping::get(bid_owner, unique_bid_key);
        assert_eq(owner, caller);

        // The declined winner already forfeited their stake — they cannot call this.
        let winner_key: field = Mapping::get(winner_bids, rfq_id);
        assert(unique_bid_key != winner_key);

        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, unique_bid_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);
        // Zero before transfer.
        Mapping::set(bid_stakes, unique_bid_key, 0u64);

        refund_future.await();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 9. CANCEL RFQ — CREATOR INITIATED (STATUS_OPEN only)
    // ═══════════════════════════════════════════════════════════════════════

    async transition cancel_rfq(
        public rfq_id: field
    ) -> (RFQCancelled, Future) {
        let event: RFQCancelled = RFQCancelled {
            owner:   self.caller,
            rfq_id:  rfq_id,
            creator: self.caller,
        };
        let f: Future = finalize_cancel_rfq(rfq_id, self.caller);
        return (event, f);
    }

    async function finalize_cancel_rfq(rfq_id: field, caller: address) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_OPEN);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        Mapping::set(rfq_status, rfq_id, STATUS_CANCELLED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 10. CANCEL RFQ — INSUFFICIENT BIDS (permissionless after bidding deadline)
    // ═══════════════════════════════════════════════════════════════════════

    async transition cancel_rfq_insufficient_bids(
        public rfq_id:  field,
        public creator: address
    ) -> (RFQCancelled, Future) {
        let event: RFQCancelled = RFQCancelled {
            owner:   self.caller,
            rfq_id:  rfq_id,
            creator: creator,
        };
        let f: Future = finalize_cancel_shortfall(rfq_id, creator);
        return (event, f);
    }

    async function finalize_cancel_shortfall(rfq_id: field, creator: address) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_OPEN);

        let actual_creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(creator, actual_creator);

        let bidding_deadline: u32 = Mapping::get(rfq_bidding_deadlines, rfq_id);
        assert(block.height >= bidding_deadline);

        let bid_count: u64 = Mapping::get_or_use(rfq_bid_count, rfq_id, 0u64);
        let min_count: u64 = Mapping::get(rfq_min_bid_count, rfq_id);
        assert(bid_count < min_count);

        Mapping::set(rfq_status, rfq_id, STATUS_CANCELLED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 11. CANCEL RFQ — STUCK REVEAL (permissionless escape hatch)
    // Triggered when ALL vendors fail to reveal AND the slash window expires.
    // Both windows fully elapsed — no slash or reveal possible — RFQ is stuck.
    // Creator address is public; anyone can call once conditions are met.
    // ═══════════════════════════════════════════════════════════════════════

    async transition cancel_rfq_stuck_reveal(
        public rfq_id:  field,
        public creator: address
    ) -> (RFQCancelled, Future) {
        let event: RFQCancelled = RFQCancelled {
            owner:   self.caller,
            rfq_id:  rfq_id,
            creator: creator,
        };
        let f: Future = finalize_cancel_stuck_reveal(rfq_id, creator);
        return (event, f);
    }

    async function finalize_cancel_stuck_reveal(rfq_id: field, creator: address) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_REVEAL);

        let actual_creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(creator, actual_creator);

        let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
        assert(block.height > reveal_deadline + SLASH_WINDOW);
        let revealed_count: u64 = Mapping::get_or_use(rfq_revealed_count, rfq_id, 0u64);
        assert_eq(revealed_count, 0u64);

        Mapping::set(rfq_status, rfq_id, STATUS_CANCELLED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 12. CANCEL RFQ — NO ESCROW FUNDED (permissionless after timeout)
    // Allows STATUS_WINNER_SELECTED → STATUS_CANCELLED when the creator never
    // funded the escrow after ESCROW_TIMEOUT_BLOCKS. Unblocks ALL vendor stakes
    // via refund_stake_cancelled (not just the winner via claim_locked_winner_stake).
    //
    // [MED-3 FIX] Now records the cancellation block in rfq_escrow_timeout_block
    //             for on-chain auditability (was in v6 changelog but not implemented).
    // ═══════════════════════════════════════════════════════════════════════

    async transition cancel_rfq_no_escrow(
        public rfq_id:  field,
        public creator: address
    ) -> (RFQCancelled, Future) {
        let event: RFQCancelled = RFQCancelled {
            owner:   self.caller,
            rfq_id:  rfq_id,
            creator: creator,
        };
        let f: Future = finalize_cancel_no_escrow(rfq_id, creator);
        return (event, f);
    }

    async function finalize_cancel_no_escrow(rfq_id: field, creator: address) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_WINNER_SELECTED);

        let actual_creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(creator, actual_creator);

        let selected_block: u32 = Mapping::get(rfq_winner_selected_block, rfq_id);
        assert(block.height > selected_block + ESCROW_TIMEOUT_BLOCKS);

        // [MED-3 FIX] Record the block at which the escrow timeout cancellation occurred.
        Mapping::set(rfq_escrow_timeout_block, rfq_id, block.height);
        Mapping::set(rfq_status,               rfq_id, STATUS_CANCELLED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 13. REFUND STAKE — CANCELLED RFQ
    // Works for any vendor (revealed or not, winner or non-winner) on any
    // CANCELLED RFQ. Covers all cancellation paths including creator_reclaim_escrow.
    // ═══════════════════════════════════════════════════════════════════════

    async transition refund_stake_cancelled(
        public rfq_id: field,
        public bid_id: field,
        public stake:  u64
    ) -> (StakeRefunded, Future) {
        let unique_bid_key: field = BHP256::hash_to_field(BidKey {
            rfq_id: rfq_id,
            bid_id: bid_id,
        });
        let refund_future: Future = credits.aleo/transfer_public(self.caller, stake);

        let event: StakeRefunded = StakeRefunded {
            owner:  self.caller,
            rfq_id: rfq_id,
            bid_id: bid_id,
            amount: stake,
        };
        let f: Future = finalize_refund_cancelled(
            rfq_id, unique_bid_key, self.caller, stake, refund_future
        );
        return (event, f);
    }

    async function finalize_refund_cancelled(
        rfq_id:         field,
        unique_bid_key: field,
        caller:         address,
        stake:          u64,
        refund_future:  Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_CANCELLED);

        let owner: address = Mapping::get(bid_owner, unique_bid_key);
        assert_eq(owner, caller);

        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, unique_bid_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);

        // Zero stake before transfer (checks-effects-interactions).
        Mapping::set(bid_stakes, unique_bid_key, 0u64);

        refund_future.await();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 14. RECLAIM UNREVEALED STAKE
    // [MIN-2 FIX] Now accepts STATUS_REVEAL OR STATUS_WINNER_SELECTED.
    //
    // Previously only STATUS_REVEAL was accepted. If winner selection moved the
    // state to STATUS_WINNER_SELECTED before the slash window expired, an
    // unrevealed non-winner lost access to this function with no other path
    // available (CRIT-3 covers refund_stake; this provides defense-in-depth).
    //
    // The winner guard (unique_bid_key != winner_key) plus (revealed == 0) make
    // it impossible for the selected winner to use this path.
    // ═══════════════════════════════════════════════════════════════════════

    async transition reclaim_unrevealed_stake(
        public rfq_id: field,
        public bid_id: field,
        public stake:  u64
    ) -> (UnrevealedStakeReclaimed, Future) {
        let unique_bid_key: field = BHP256::hash_to_field(BidKey {
            rfq_id: rfq_id,
            bid_id: bid_id,
        });
        let refund_future: Future = credits.aleo/transfer_public(self.caller, stake);

        let event: UnrevealedStakeReclaimed = UnrevealedStakeReclaimed {
            owner:  self.caller,
            rfq_id: rfq_id,
            bid_id: bid_id,
            amount: stake,
        };

        let f: Future = finalize_reclaim_unrevealed(
            rfq_id, unique_bid_key, self.caller, stake, refund_future
        );
        return (event, f);
    }

    async function finalize_reclaim_unrevealed(
        rfq_id:         field,
        unique_bid_key: field,
        caller:         address,
        stake:          u64,
        refund_future:  Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        // [MIN-2 FIX] Accept STATUS_REVEAL (pre-selection) or STATUS_WINNER_SELECTED
        // (post-selection where slash window expired before or after selection).
        // STATUS_REVEAL = 2, STATUS_WINNER_SELECTED = 3 — these are adjacent values.
        assert(status >= STATUS_REVEAL);
        assert(status <= STATUS_WINNER_SELECTED);

        // Slash window must be fully expired — slashing is no longer possible.
        let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
        assert(block.height > reveal_deadline + SLASH_WINDOW);

        let owner: address = Mapping::get(bid_owner, unique_bid_key);
        assert_eq(owner, caller);

        // This path is only for non-revealers.
        let revealed: u64 = Mapping::get_or_use(revealed_bids, unique_bid_key, 0u64);
        assert_eq(revealed, 0u64);

        // Must have committed in the first place.
        let commitment: field = Mapping::get_or_use(bid_commitments, unique_bid_key, 0field);
        assert(commitment != 0field);

        // [MIN-2 FIX] In STATUS_WINNER_SELECTED, additionally guard against
        // the selected winner using this path (winner must have revealed, so
        // revealed==0 above is already sufficient — this is defense-in-depth).
        let winner_key: field = Mapping::get_or_use(winner_bids, rfq_id, 0field);
        assert(unique_bid_key != winner_key);

        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, unique_bid_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);

        // Zero before transfer (checks-effects-interactions).
        Mapping::set(bid_stakes, unique_bid_key, 0u64);

        refund_future.await();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 15. FUND ESCROW
    // Creator funds the escrow with exactly the winning bid amount.
    // Requires winner_accepted == true first.
    // ═══════════════════════════════════════════════════════════════════════

    async transition fund_escrow(
        public rfq_id: field,
        public amount: u64
    ) -> (EscrowFunded, Future) {
        assert(amount > 0u64);
        assert(amount < MAX_BID_AMOUNT);

        // Debit the wallet signer and credit the program account.
        let escrow_future: Future = credits.aleo/transfer_public_as_signer(self.address, amount);

        let event: EscrowFunded = EscrowFunded {
            owner:  self.caller,
            rfq_id: rfq_id,
            amount: amount,
        };

        let f: Future = finalize_fund_escrow(rfq_id, amount, self.caller, escrow_future);
        return (event, f);
    }

    async function finalize_fund_escrow(
        rfq_id:        field,
        amount:        u64,
        caller:        address,
        escrow_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_WINNER_SELECTED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        // Winner must have explicitly accepted before creator funds.
        let accepted: bool = Mapping::get_or_use(rfq_winner_accepted, rfq_id, false);
        assert_eq(accepted, true);

        // Amount must equal the winning bid exactly.
        let winner_key: field   = Mapping::get(winner_bids, rfq_id);
        let winning_amount: u64 = Mapping::get(revealed_bids, winner_key);
        assert_eq(amount, winning_amount);

        let winner_addr: address = Mapping::get(rfq_winner_address, rfq_id);
        assert(winner_addr != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);

        // Idempotency: escrow must not already be funded.
        let existing: u64 = Mapping::get_or_use(escrow_amounts, rfq_id, 0u64);
        assert_eq(existing, 0u64);

        escrow_future.await();

        Mapping::set(escrow_original,         rfq_id, amount);
        Mapping::set(escrow_amounts,          rfq_id, amount);
        Mapping::set(total_released,          rfq_id, 0u64);
        Mapping::set(final_payment_released,  rfq_id, false);
        Mapping::set(rfq_escrow_funded_block, rfq_id, block.height);
        Mapping::set(rfq_status,              rfq_id, STATUS_ESCROW_FUNDED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 16. RELEASE PARTIAL PAYMENT
    // Creator releases a percentage of REMAINING escrow to the winner.
    //
    // [BUG-5 from v6] If remaining balance reaches 0 after partial release,
    //   status auto-advances to STATUS_COMPLETED so winner's stake is released.
    //
    // [MED-2 FIX] effective_min = max(computed_min, 1u64).
    //   For escrows below 100 microcredits, (original * 1 / 100) = 0, which
    //   silently bypassed the dust guard. Now enforces at least 1 microcredit.
    // ═══════════════════════════════════════════════════════════════════════

    async transition release_partial_payment(
        public rfq_id:             field,
        public winner:             address,
        public release_amount:     u64,
        public percentage:         u8,
        public new_total_released: u64,
        public user_nonce:         u64
    ) -> (PartialPaymentReleased, Future) {
        assert(percentage         > 0u8);
        assert(percentage         <= 99u8);  // 100% must use release_final_payment
        assert(release_amount     > 0u64);
        assert(new_total_released > 0u64);

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 3u8,
            rfq_id:     rfq_id,
        });

        let payment_future: Future = credits.aleo/transfer_public(winner, release_amount);

        let f: Future = finalize_release_partial(
            rfq_id, percentage, self.caller, nonce_key, user_nonce,
            winner, release_amount, new_total_released, payment_future
        );

        let event: PartialPaymentReleased = PartialPaymentReleased {
            owner:          self.caller,
            rfq_id:         rfq_id,
            release_amount: release_amount,
            total_released: new_total_released,
            percentage:     percentage,
        };

        return (event, f);
    }

    async function finalize_release_partial(
        rfq_id:             field,
        percentage:         u8,
        caller:             address,
        nonce_key:          field,
        user_nonce:         u64,
        winner:             address,
        release_amount:     u64,
        new_total_released: u64,
        payment_future:     Future
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_payment_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let remaining: u64        = Mapping::get(escrow_amounts, rfq_id);
        let already_released: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        let original: u64         = Mapping::get(escrow_original, rfq_id);

        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        // Validate the caller-supplied release_amount matches the on-chain formula.
        let expected_release_amount: u64 = (remaining * (percentage as u64)) / 100u64;
        assert_eq(release_amount, expected_release_amount);
        assert(release_amount > 0u64);
        assert(release_amount <= remaining);

        // [MED-2 FIX] For escrows < 100 microcredits, integer division yields 0,
        // bypassing the dust guard. effective_min ensures at least 1 is enforced.
        let computed_min:  u64 = (original * (MIN_PARTIAL_RELEASE_PCT as u64)) / 100u64;
        let effective_min: u64 = computed_min > 0u64 ? computed_min : 1u64;
        assert(release_amount >= effective_min);

        assert_eq(new_total_released, already_released + release_amount);
        assert(new_total_released <= original);

        payment_future.await();

        let new_remaining: u64 = remaining - release_amount;
        Mapping::set(total_released,       rfq_id, new_total_released);
        Mapping::set(escrow_amounts,       rfq_id, new_remaining);
        Mapping::set(actor_payment_nonces, nonce_key, user_nonce);

        // [BUG-5 from v6] Auto-complete when escrow is fully drained.
        let is_complete: bool = new_remaining == 0u64;
        let next_status: u8   = is_complete ? STATUS_COMPLETED : STATUS_ESCROW_FUNDED;
        Mapping::set(rfq_status, rfq_id, next_status);
        let mark_final: bool = is_complete ? true : false;
        Mapping::set(final_payment_released, rfq_id, mark_final);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 17. RELEASE FINAL PAYMENT
    // Releases all remaining escrow to the winner and moves to STATUS_COMPLETED.
    // ═══════════════════════════════════════════════════════════════════════

    async transition release_final_payment(
        public rfq_id:     field,
        public winner:     address,
        public remaining:  u64,
        public user_nonce: u64
    ) -> (FinalPaymentReleased, Future) {
        assert(remaining > 0u64);

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 3u8,
            rfq_id:     rfq_id,
        });

        let payment_future: Future = credits.aleo/transfer_public(winner, remaining);
        let f: Future = finalize_release_final(
            rfq_id, self.caller, nonce_key, user_nonce, winner, remaining, payment_future
        );

        let event: FinalPaymentReleased = FinalPaymentReleased {
            owner:          self.caller,
            rfq_id:         rfq_id,
            release_amount: remaining,
        };

        return (event, f);
    }

    async function finalize_release_final(
        rfq_id:         field,
        caller:         address,
        nonce_key:      field,
        user_nonce:     u64,
        winner:         address,
        remaining:      u64,
        payment_future: Future
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_payment_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        let already_released: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);

        payment_future.await();

        Mapping::set(total_released,         rfq_id, already_released + remaining);
        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        Mapping::set(rfq_status,             rfq_id, STATUS_COMPLETED);
        Mapping::set(actor_payment_nonces,   nonce_key, user_nonce);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 18. SLASH NON-REVEALER
    // Status STRICTLY equals STATUS_REVEAL — no slashing after winner selection.
    // Creator receives the stake as compensation for disrupted procurement.
    // Only callable within the SLASH_WINDOW blocks after reveal_deadline.
    // ═══════════════════════════════════════════════════════════════════════

    async transition slash_non_revealer(
        public rfq_id: field,
        public bid_id: field,
        public stake:  u64
    ) -> (StakeSlashed, Future) {
        let unique_bid_key: field = BHP256::hash_to_field(BidKey {
            rfq_id: rfq_id,
            bid_id: bid_id,
        });
        let slash_future: Future = credits.aleo/transfer_public(self.caller, stake);

        let event: StakeSlashed = StakeSlashed {
            owner:   self.caller,
            rfq_id:  rfq_id,
            bid_id:  bid_id,
            amount:  stake,
            creator: self.caller,
        };

        let f: Future = finalize_slash_non_revealer(
            rfq_id, unique_bid_key, self.caller, stake, slash_future
        );
        return (event, f);
    }

    async function finalize_slash_non_revealer(
        rfq_id:         field,
        unique_bid_key: field,
        caller:         address,
        stake:          u64,
        slash_future:   Future
    ) {
        // Must be STRICTLY STATUS_REVEAL — slashing after winner selection is forbidden.
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_REVEAL);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        // Slash window: after reveal_deadline AND within SLASH_WINDOW blocks.
        let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
        assert(block.height >  reveal_deadline);
        assert(block.height <= reveal_deadline + SLASH_WINDOW);

        // Target must have committed (have a non-zero commitment).
        let commitment: field = Mapping::get_or_use(bid_commitments, unique_bid_key, 0field);
        assert(commitment != 0field);

        // Target must NOT have revealed.
        let revealed: u64 = Mapping::get_or_use(revealed_bids, unique_bid_key, 0u64);
        assert_eq(revealed, 0u64);

        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, unique_bid_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);

        // Zero before transfer (checks-effects-interactions).
        Mapping::set(bid_stakes, unique_bid_key, 0u64);

        slash_future.await();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 19. REFUND STAKE (non-winners, post winner selection)
    //
    // [CRIT-3 FIX] Removed the revealed > 0 requirement. Unrevealed non-winners
    //   can now reclaim their stakes after winner selection if they were not
    //   slashed and the RFQ was not cancelled. Re-entrancy protection is
    //   preserved by zeroing bid_stakes BEFORE the transfer.
    //
    // [MIN-3 FIX] Explicitly excludes STATUS_CANCELLED (6). Cancelled-RFQ
    //   refunds belong in refund_stake_cancelled. While not exploitable (stake
    //   zeroing prevents double claims), explicit exclusion eliminates ambiguity.
    //
    // Covers post-selection states:
    //   STATUS_WINNER_SELECTED (3), STATUS_ESCROW_FUNDED (4),
    //   STATUS_COMPLETED (5), STATUS_WINNER_DECLINED (7)
    // ═══════════════════════════════════════════════════════════════════════

    async transition refund_stake(
        public rfq_id: field,
        public bid_id: field,
        public stake:  u64
    ) -> (StakeRefunded, Future) {
        let unique_bid_key: field = BHP256::hash_to_field(BidKey {
            rfq_id: rfq_id,
            bid_id: bid_id,
        });
        let refund_future: Future = credits.aleo/transfer_public(self.caller, stake);

        let event: StakeRefunded = StakeRefunded {
            owner:  self.caller,
            rfq_id: rfq_id,
            bid_id: bid_id,
            amount: stake,
        };

        let f: Future = finalize_refund_stake(
            rfq_id, unique_bid_key, self.caller, stake, refund_future
        );
        return (event, f);
    }

    async function finalize_refund_stake(
        rfq_id:         field,
        unique_bid_key: field,
        caller:         address,
        stake:          u64,
        refund_future:  Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        // [MIN-3 FIX] Explicitly exclude STATUS_CANCELLED — use refund_stake_cancelled.
        // Remaining valid states: STATUS_WINNER_SELECTED (3), STATUS_ESCROW_FUNDED (4),
        // STATUS_COMPLETED (5), STATUS_WINNER_DECLINED (7).
        assert(status >= STATUS_WINNER_SELECTED);
        assert(status != STATUS_CANCELLED);

        let owner: address = Mapping::get(bid_owner, unique_bid_key);
        assert_eq(owner, caller);

        // Must not be the winner's bid key — winner uses release_winner_stake.
        let winner_key: field = Mapping::get(winner_bids, rfq_id);
        assert(unique_bid_key != winner_key);

        // [CRIT-3 FIX] Revealed guard removed. Unrevealed non-winners who missed
        // the slash window can reclaim. Stake zeroing below prevents double claims.

        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, unique_bid_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);

        // Zero before transfer (checks-effects-interactions).
        Mapping::set(bid_stakes, unique_bid_key, 0u64);

        refund_future.await();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 20. RELEASE WINNER STAKE (after STATUS_COMPLETED)
    // ═══════════════════════════════════════════════════════════════════════

    async transition release_winner_stake(
        public rfq_id: field,
        public stake:  u64
    ) -> (WinnerStakeReleased, Future) {
        let release_future: Future = credits.aleo/transfer_public(self.caller, stake);

        let event: WinnerStakeReleased = WinnerStakeReleased {
            owner:  self.caller,
            rfq_id: rfq_id,
            amount: stake,
        };

        let f: Future = finalize_release_winner_stake(
            rfq_id, self.caller, stake, release_future
        );
        return (event, f);
    }

    async function finalize_release_winner_stake(
        rfq_id:         field,
        caller:         address,
        stake:          u64,
        release_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_COMPLETED);

        let winner_key: field = Mapping::get(winner_bids, rfq_id);
        let owner: address    = Mapping::get(bid_owner, winner_key);
        assert_eq(owner, caller);

        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, winner_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);
        Mapping::set(bid_stakes, winner_key, 0u64);

        release_future.await();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 21. CLAIM LOCKED WINNER STAKE (escrow timeout — creator never funded)
    // NOTE: Prefer cancel_rfq_no_escrow (unblocks ALL vendors).
    // This transition provides a winner-only fallback when other vendors have
    // already recovered stakes via other paths. Does NOT cancel the RFQ.
    // ═══════════════════════════════════════════════════════════════════════

    async transition claim_locked_winner_stake(
        public rfq_id: field,
        public stake:  u64
    ) -> (WinnerStakeReleased, Future) {
        let release_future: Future = credits.aleo/transfer_public(self.caller, stake);

        let event: WinnerStakeReleased = WinnerStakeReleased {
            owner:  self.caller,
            rfq_id: rfq_id,
            amount: stake,
        };

        let f: Future = finalize_claim_winner_stake(
            rfq_id, self.caller, stake, release_future
        );
        return (event, f);
    }

    async function finalize_claim_winner_stake(
        rfq_id:         field,
        caller:         address,
        stake:          u64,
        release_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_WINNER_SELECTED);

        let selected_block: u32 = Mapping::get(rfq_winner_selected_block, rfq_id);
        assert(block.height > selected_block + ESCROW_TIMEOUT_BLOCKS);

        let winner_key: field = Mapping::get(winner_bids, rfq_id);
        let owner: address    = Mapping::get(bid_owner, winner_key);
        assert_eq(owner, caller);

        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, winner_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);
        Mapping::set(bid_stakes, winner_key, 0u64);

        release_future.await();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 22. CREATOR RECLAIM ESCROW (long recovery timeout)
    // Moves to STATUS_CANCELLED so all vendors (including winner) recover
    // stakes via refund_stake_cancelled. Used when delivery never completes
    // and the creator needs to recover stranded funds after ESCROW_RECOVERY_BLOCKS.
    // ═══════════════════════════════════════════════════════════════════════

    async transition creator_reclaim_escrow(
        public rfq_id:    field,
        public remaining: u64
    ) -> (EscrowReclaimed, Future) {
        let reclaim_future: Future = credits.aleo/transfer_public(self.caller, remaining);

        let event: EscrowReclaimed = EscrowReclaimed {
            owner:   self.caller,
            rfq_id:  rfq_id,
            creator: self.caller,
            amount:  remaining,
        };

        let f: Future = finalize_reclaim_escrow(
            rfq_id, self.caller, remaining, reclaim_future
        );
        return (event, f);
    }

    async function finalize_reclaim_escrow(
        rfq_id:         field,
        caller:         address,
        remaining:      u64,
        reclaim_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let funded_block: u32 = Mapping::get(rfq_escrow_funded_block, rfq_id);
        assert(block.height > funded_block + ESCROW_RECOVERY_BLOCKS);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        // STATUS_CANCELLED signals all vendors to use refund_stake_cancelled.
        Mapping::set(rfq_status,             rfq_id, STATUS_CANCELLED);

        reclaim_future.await();
    }
}
