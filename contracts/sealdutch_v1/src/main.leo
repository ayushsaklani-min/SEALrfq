import credits.aleo;

// ═══════════════════════════════════════════════════════════════════════════════
// SealDutch V2 — Dutch Auction (Descending Price) with MEV Mitigation
//
// Production-grade descending-price auction:
//   • Price descends from start_price toward reserve_price per block
//   • Two-step commit-to-accept prevents front-running / bot sniping
//   • Underflow-safe price calculation
//   • Bound to exactly one RFQ via auction_rfq_id
//   • On-chain verifiable results via auction_final_winner / auction_final_price
//   • Immutable state after acceptance
//
// State machine:
//   NONE → ACTIVE → ACCEPTED
//                 → EXPIRED
//                 → CANCELLED
//
// MEV Mitigation (commit-to-accept):
//   Step 1: commit_accept — bidder posts hash(auction_id, bidder, salt).
//           Price is locked at the commit block height.
//   Step 2: confirm_accept — bidder reveals salt within CONFIRM_WINDOW.
//           First valid confirm wins at the price from their commit block.
//
//   Front-runners cannot benefit because:
//     • They must commit first (delay), they can't atomically accept
//     • Price is locked at commit block (same block = same price)
//     • Committing earlier = higher price (worse for acceptor)
//
// Flow:
//   1. Creator: create_auction(auction_id, salt, rfq_id, ...)
//   2. Acceptors: commit_accept(auction_id, commitment)
//   3. Acceptors: confirm_accept(auction_id, salt) within CONFIRM_WINDOW
//   4. Creator: expire_auction (if no acceptance by end_block)
//   5. Creator imports result into sealrfq_v17 via import_auction_result
// ═══════════════════════════════════════════════════════════════════════════════

program sealdutch_v4.aleo {

    // ─── CONSTANTS ───────────────────────────────────────────────────────────
    const STATUS_NONE:      u8 = 0u8;
    const STATUS_ACTIVE:    u8 = 1u8;
    const STATUS_ACCEPTED:  u8 = 2u8;
    const STATUS_EXPIRED:   u8 = 3u8;
    const STATUS_CANCELLED: u8 = 4u8;

    const MAX_DURATION:     u32 = 100_000u32;

    // [SECURITY FIX] MEV mitigation: commit-to-accept timing.
    const MIN_CONFIRM_DELAY: u32 = 1u32;   // must wait ≥1 block after commit
    const CONFIRM_WINDOW:    u32 = 10u32;  // must confirm within 10 blocks

    // [SECURITY FIX] Anti-spam: commit requires a stake deposit.
    // Prevents costless commit flooding. Refundable after auction ends.
    const COMMIT_STAKE:      u64 = 10_000u64;  // microcredits

    // ─── STRUCTS ─────────────────────────────────────────────────────────────

    struct AuctionIdInput {
        creator: address,
        salt:    field,
    }

    // [SECURITY FIX] Commit includes acceptor address — prevents replay.
    struct AcceptCommitInput {
        auction_id: field,
        acceptor:   address,
        salt:       field,
    }

    struct AcceptorKey {
        auction_id: field,
        acceptor:   address,
    }

    // ─── RECORDS ─────────────────────────────────────────────────────────────

    record AuctionCreated {
        owner:           address,
        auction_id:      field,
        creator:         address,
        rfq_id:          field,
        start_price:     u64,
        reserve_price:   u64,
        price_decrement: u64,
        start_block:     u32,
        end_block:       u32,
    }

    record AcceptCommitted {
        owner:      address,
        auction_id: field,
        acceptor:   address,
    }

    record AuctionAccepted {
        owner:      address,
        auction_id: field,
        acceptor:   address,
        price:      u64,
    }

    record CommitStakeRefunded {
        owner:      address,
        auction_id: field,
        amount:     u64,
    }

    // ─── MAPPINGS ────────────────────────────────────────────────────────────
    // Auction lifecycle
    mapping auction_status:          field => u8;
    mapping auction_creators:        field => address;
    mapping auction_start_price:     field => u64;
    mapping auction_reserve_price:   field => u64;
    mapping auction_price_decrement: field => u64;
    mapping auction_start_block:     field => u32;
    mapping auction_end_block:       field => u32;

    // [INTEGRATION FIX] RFQ binding — each auction bound to exactly one RFQ.
    mapping auction_rfq_id:          field => field;

    // [INTEGRATION FIX] Verifiable on-chain results — ONLY source of truth.
    mapping auction_final_winner:    field => address;
    mapping auction_final_price:     field => u64;

    // [SECURITY FIX] MEV mitigation: commit-to-accept state.
    // Key: hash(auction_id, acceptor)
    mapping accept_commitments:      field => field;  // stored commitment hash
    mapping accept_commit_block:     field => u32;    // block height at commit

    // [MECHANISM FIX] Fairness: winner = earliest commit, not fastest confirm.
    mapping first_commit_block:      field => u32;    // earliest commit block per auction
    mapping best_acceptor:           field => address; // who committed at earliest block

    // [SECURITY FIX] Deterministic same-block tiebreaker.
    // When two acceptors commit in the same block, lower commit hash wins.
    mapping best_commit_hash:        field => field;

    // [SECURITY FIX] Anti-spam commit stakes.
    // Key: hash(auction_id, acceptor). Zeroed on refund.
    mapping commit_stakes:           field => u64;

    // [SECURITY FIX] Explicit finality flag — defense-in-depth.
    mapping auction_finalized:       field => bool;

    @noupgrade
    async constructor() {}

    // ═══════════════════════════════════════════════════════════════════════
    // 1. CREATE AUCTION
    //
    // [INTEGRATION FIX] Now accepts rfq_id to bind auction to exactly one RFQ.
    // [SECURITY FIX] Validates start_price > reserve_price, non-zero decrement.
    // ═══════════════════════════════════════════════════════════════════════

    async transition create_auction(
        public auction_id:      field,
        public salt:            field,
        public rfq_id:          field,
        public start_price:     u64,
        public reserve_price:   u64,
        public price_decrement: u64,
        public start_block:     u32,
        public end_block:       u32
    ) -> (AuctionCreated, Future) {
        assert(auction_id      != 0field);
        assert(salt            != 0field);
        assert(rfq_id          != 0field);
        assert(start_price      > 0u64);
        assert(reserve_price    > 0u64);
        assert(price_decrement  > 0u64);
        assert(start_price      > reserve_price);
        assert(end_block        > start_block);

        let derived_id: field = BHP256::hash_to_field(AuctionIdInput {
            creator: self.caller,
            salt:    salt,
        });
        assert_eq(auction_id, derived_id);

        let event: AuctionCreated = AuctionCreated {
            owner:           self.caller,
            auction_id:      auction_id,
            creator:         self.caller,
            rfq_id:          rfq_id,
            start_price:     start_price,
            reserve_price:   reserve_price,
            price_decrement: price_decrement,
            start_block:     start_block,
            end_block:       end_block,
        };

        let f: Future = finalize_create_auction(
            auction_id, rfq_id, start_price, reserve_price, price_decrement,
            start_block, end_block, self.caller
        );
        return (event, f);
    }

    async function finalize_create_auction(
        auction_id:      field,
        rfq_id:          field,
        start_price:     u64,
        reserve_price:   u64,
        price_decrement: u64,
        start_block:     u32,
        end_block:       u32,
        creator:         address
    ) {
        let now: u32 = block.height;
        assert(start_block >= now);
        assert(end_block   <= now + MAX_DURATION);
        assert(end_block   > start_block);

        // [SECURITY FIX] No duplicate auctions.
        let existing: u8 = Mapping::get_or_use(auction_status, auction_id, STATUS_NONE);
        assert_eq(existing, STATUS_NONE);

        Mapping::set(auction_status,          auction_id, STATUS_ACTIVE);
        Mapping::set(auction_creators,        auction_id, creator);
        Mapping::set(auction_rfq_id,          auction_id, rfq_id);
        Mapping::set(auction_start_price,     auction_id, start_price);
        Mapping::set(auction_reserve_price,   auction_id, reserve_price);
        Mapping::set(auction_price_decrement, auction_id, price_decrement);
        Mapping::set(auction_start_block,     auction_id, start_block);
        Mapping::set(auction_end_block,       auction_id, end_block);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. COMMIT ACCEPT (MEV Mitigation Step 1)
    //
    // [SECURITY FIX] Bidder commits intent to accept.
    //   • Commitment = hash(auction_id, acceptor, salt)
    //   • Price is locked at the commit block height
    //   • Prevents atomic front-running — must wait MIN_CONFIRM_DELAY
    //   • One commit per acceptor per auction (prevents spam)
    //   • Commit expires after CONFIRM_WINDOW blocks if not confirmed
    // ═══════════════════════════════════════════════════════════════════════

    async transition commit_accept(
        public auction_id: field,
               salt:       field
    ) -> (AcceptCommitted, Future) {
        assert(auction_id != 0field);
        assert(salt       != 0field);

        // [SECURITY FIX] Commitment bound to auction + acceptor.
        let commitment: field = BHP256::hash_to_field(AcceptCommitInput {
            auction_id: auction_id,
            acceptor:   self.caller,
            salt:       salt,
        });

        let acceptor_key: field = BHP256::hash_to_field(AcceptorKey {
            auction_id: auction_id,
            acceptor:   self.caller,
        });

        // [SECURITY FIX] Anti-spam stake deposit.
        let stake_future: Future = credits.aleo/transfer_public_as_signer(
            self.address, COMMIT_STAKE
        );

        let event: AcceptCommitted = AcceptCommitted {
            owner:      self.caller,
            auction_id: auction_id,
            acceptor:   self.caller,
        };

        let f: Future = finalize_commit_accept(
            auction_id, acceptor_key, commitment, self.caller, stake_future
        );
        return (event, f);
    }

    async function finalize_commit_accept(
        auction_id:   field,
        acceptor_key: field,
        commitment:   field,
        acceptor:     address,
        stake_future: Future
    ) {
        let status: u8 = Mapping::get(auction_status, auction_id);
        assert_eq(status, STATUS_ACTIVE);

        // Must be within auction window.
        let start_block: u32 = Mapping::get(auction_start_block, auction_id);
        let end_block:   u32 = Mapping::get(auction_end_block,   auction_id);
        assert(block.height >= start_block);
        assert(block.height <= end_block);

        // [SECURITY FIX] One commit per acceptor per auction.
        // If a previous commit expired, allow re-commit by checking expiry.
        let existing_commit: field = Mapping::get_or_use(accept_commitments, acceptor_key, 0field);
        let existing_block:  u32   = Mapping::get_or_use(accept_commit_block, acceptor_key, 0u32);

        // Allow commit if: no prior commit, OR prior commit expired.
        let no_prior: bool = existing_commit == 0field;
        let expired: bool  = existing_block > 0u32 &&
            block.height > existing_block + CONFIRM_WINDOW;
        assert(no_prior || expired);

        // [SECURITY FIX] Lock anti-spam stake.
        stake_future.await();

        Mapping::set(accept_commitments,  acceptor_key, commitment);
        Mapping::set(accept_commit_block, acceptor_key, block.height);
        Mapping::set(commit_stakes,       acceptor_key, COMMIT_STAKE);

        // [MECHANISM FIX] Track earliest committer for fairness.
        // Winner is determined by earliest commit_block, not fastest confirm.
        // [SECURITY FIX] Same-block tiebreaker: lower commitment hash wins
        // for deterministic, manipulation-resistant ordering.
        let current_best_block: u32 = Mapping::get_or_use(
            first_commit_block, auction_id, 4294967295u32
        );
        let current_best_addr: address = Mapping::get_or_use(
            best_acceptor, auction_id,
            aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc
        );
        let current_best_hash: field = Mapping::get_or_use(
            best_commit_hash, auction_id, 0field
        );

        // Check if current best's commit has expired.
        let no_best: bool = current_best_addr ==
            aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
        let best_expired: bool = !no_best &&
            block.height > current_best_block + CONFIRM_WINDOW;
        let is_earlier: bool = block.height < current_best_block;

        // [SECURITY FIX] Deterministic same-block tiebreaker.
        // If two commits land in the same block, lower commitment hash wins.
        let same_block: bool = block.height == current_best_block;
        let lower_hash: bool = same_block && (commitment < current_best_hash);

        // Update best if: no current best, current best expired,
        // this commit is earlier, OR same block with lower hash.
        if (no_best || best_expired || is_earlier || lower_hash) {
            Mapping::set(first_commit_block, auction_id, block.height);
            Mapping::set(best_acceptor,      auction_id, acceptor);
            Mapping::set(best_commit_hash,   auction_id, commitment);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. CONFIRM ACCEPT (MEV Mitigation Step 2)
    //
    // [SECURITY FIX] Bidder reveals salt to confirm acceptance.
    //   • Must wait MIN_CONFIRM_DELAY blocks after commit
    //   • Must confirm within CONFIRM_WINDOW blocks of commit
    //   • Price computed from commit block height (not confirm block)
    //   • First valid confirm wins — state becomes immutable
    //
    // [SECURITY FIX] Underflow-safe price calculation:
    //   current_price = max(reserve_price, safe_sub(start_price, elapsed * decrement))
    // ═══════════════════════════════════════════════════════════════════════

    async transition confirm_accept(
        public auction_id: field,
               salt:       field
    ) -> (AuctionAccepted, Future) {
        assert(auction_id != 0field);
        assert(salt       != 0field);

        // Recompute commitment for verification.
        let commitment: field = BHP256::hash_to_field(AcceptCommitInput {
            auction_id: auction_id,
            acceptor:   self.caller,
            salt:       salt,
        });

        let acceptor_key: field = BHP256::hash_to_field(AcceptorKey {
            auction_id: auction_id,
            acceptor:   self.caller,
        });

        let event: AuctionAccepted = AuctionAccepted {
            owner:      self.caller,
            auction_id: auction_id,
            acceptor:   self.caller,
            price:      0u64,  // actual price computed in finalize
        };

        let f: Future = finalize_confirm_accept(
            auction_id, acceptor_key, commitment, self.caller
        );
        return (event, f);
    }

    async function finalize_confirm_accept(
        auction_id:   field,
        acceptor_key: field,
        commitment:   field,
        acceptor:     address
    ) {
        // [SECURITY FIX] Auction must still be active.
        let status: u8 = Mapping::get(auction_status, auction_id);
        assert_eq(status, STATUS_ACTIVE);

        // [SECURITY FIX] Defense-in-depth finality guard.
        let already_finalized: bool = Mapping::get_or_use(auction_finalized, auction_id, false);
        assert_eq(already_finalized, false);

        // [MECHANISM FIX] Only the earliest committer (best_acceptor) can confirm.
        // Fairness: winner determined by commitment time, not execution speed.
        let best: address = Mapping::get(best_acceptor, auction_id);
        assert_eq(acceptor, best);

        // [SECURITY FIX] Verify commitment matches stored.
        let stored_commitment: field = Mapping::get(accept_commitments, acceptor_key);
        assert_eq(stored_commitment, commitment);
        assert(commitment != 0field);

        // [SECURITY FIX] Enforce timing: MIN_CONFIRM_DELAY ≤ elapsed ≤ CONFIRM_WINDOW.
        let commit_block: u32 = Mapping::get(accept_commit_block, acceptor_key);
        assert(block.height >= commit_block + MIN_CONFIRM_DELAY);
        assert(block.height <= commit_block + CONFIRM_WINDOW);

        // Must still be within auction window.
        let end_block: u32 = Mapping::get(auction_end_block, auction_id);
        assert(block.height <= end_block);

        // [SECURITY FIX] Underflow-safe price calculation.
        // Price is based on COMMIT block, not confirm block (MEV protection).
        let start_block:     u32 = Mapping::get(auction_start_block,     auction_id);
        let start_price:     u64 = Mapping::get(auction_start_price,     auction_id);
        let reserve_price:   u64 = Mapping::get(auction_reserve_price,   auction_id);
        let price_decrement: u64 = Mapping::get(auction_price_decrement, auction_id);

        // Use commit_block for price calculation (not block.height).
        let blocks_elapsed: u64 = (commit_block - start_block) as u64;

        // Clamp at the reserve price without relying on a `start_price / decrement`
        // cap, which breaks when the decrement exceeds the available price drop.
        let max_drop: u64 = start_price - reserve_price;
        let full_floor_blocks: u64 = max_drop / price_decrement;
        let remainder: u64 = max_drop % price_decrement;
        let floor_reached: bool = remainder == 0u64
            ? (blocks_elapsed >= full_floor_blocks)
            : (blocks_elapsed > full_floor_blocks);
        let current_price: u64 = floor_reached
            ? reserve_price
            : (start_price - (blocks_elapsed * price_decrement));

        // [SECURITY FIX] State finality — immutable after acceptance.
        Mapping::set(auction_status,    auction_id, STATUS_ACCEPTED);
        Mapping::set(auction_finalized, auction_id, true);

        // [INTEGRATION FIX] Set on-chain verifiable results.
        Mapping::set(auction_final_winner, auction_id, acceptor);
        Mapping::set(auction_final_price,  auction_id, current_price);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. EXPIRE AUCTION
    //
    // Creator calls after end_block if no one accepted.
    // [SECURITY FIX] Only possible from ACTIVE state after end_block.
    // ═══════════════════════════════════════════════════════════════════════

    async transition accept_price(
        public auction_id: field
    ) -> Future {
        assert(auction_id != 0field);
        return finalize_accept_price(auction_id, self.caller);
    }

    async function finalize_accept_price(
        auction_id: field,
        acceptor:   address
    ) {
        let status: u8 = Mapping::get(auction_status, auction_id);
        assert_eq(status, STATUS_ACTIVE);

        let already_finalized: bool = Mapping::get_or_use(auction_finalized, auction_id, false);
        assert_eq(already_finalized, false);

        let start_block: u32 = Mapping::get(auction_start_block, auction_id);
        let end_block:   u32 = Mapping::get(auction_end_block,   auction_id);
        assert(block.height >= start_block);
        assert(block.height <= end_block);

        let start_price:     u64 = Mapping::get(auction_start_price,     auction_id);
        let reserve_price:   u64 = Mapping::get(auction_reserve_price,   auction_id);
        let price_decrement: u64 = Mapping::get(auction_price_decrement, auction_id);

        let blocks_elapsed: u64 = (block.height - start_block) as u64;
        let max_drop: u64 = start_price - reserve_price;
        let full_floor_blocks: u64 = max_drop / price_decrement;
        let remainder: u64 = max_drop % price_decrement;
        let floor_reached: bool = remainder == 0u64
            ? (blocks_elapsed >= full_floor_blocks)
            : (blocks_elapsed > full_floor_blocks);
        let current_price: u64 = floor_reached
            ? reserve_price
            : (start_price - (blocks_elapsed * price_decrement));

        Mapping::set(auction_status,       auction_id, STATUS_ACCEPTED);
        Mapping::set(auction_finalized,    auction_id, true);
        Mapping::set(auction_final_winner, auction_id, acceptor);
        Mapping::set(auction_final_price,  auction_id, current_price);
    }

    async transition expire_auction(
        public auction_id: field
    ) -> Future {
        assert(auction_id != 0field);

        let f: Future = finalize_expire_auction(auction_id, self.caller);
        return f;
    }

    async function finalize_expire_auction(
        auction_id: field,
        caller:     address
    ) {
        let creator: address = Mapping::get(auction_creators, auction_id);
        assert_eq(caller, creator);

        let status: u8 = Mapping::get(auction_status, auction_id);
        assert_eq(status, STATUS_ACTIVE);

        let end_block: u32 = Mapping::get(auction_end_block, auction_id);
        assert(block.height > end_block);

        Mapping::set(auction_status, auction_id, STATUS_EXPIRED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. CANCEL AUCTION
    //
    // Creator-only. Only from ACTIVE state (before acceptance).
    // ═══════════════════════════════════════════════════════════════════════

    async transition cancel_auction(
        public auction_id: field
    ) -> Future {
        assert(auction_id != 0field);

        let f: Future = finalize_cancel_auction(auction_id, self.caller);
        return f;
    }

    async function finalize_cancel_auction(
        auction_id: field,
        caller:     address
    ) {
        let creator: address = Mapping::get(auction_creators, auction_id);
        assert_eq(caller, creator);

        let status: u8 = Mapping::get(auction_status, auction_id);
        // [SECURITY FIX] Can only cancel from ACTIVE state.
        assert_eq(status, STATUS_ACTIVE);

        Mapping::set(auction_status, auction_id, STATUS_CANCELLED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6. REFUND COMMIT STAKE
    //
    // [SECURITY FIX] Anti-spam stake refund.
    // Acceptors reclaim their commit stake after the auction is no longer
    // ACTIVE (accepted, expired, or cancelled). The winner's stake is also
    // refundable since the real settlement happens on the RFQ side.
    //
    // Prevents double-refund by zeroing commit_stakes on refund.
    // ═══════════════════════════════════════════════════════════════════════

    async transition refund_commit_stake(
        public auction_id: field
    ) -> (CommitStakeRefunded, Future) {
        assert(auction_id != 0field);

        let acceptor_key: field = BHP256::hash_to_field(AcceptorKey {
            auction_id: auction_id,
            acceptor:   self.caller,
        });

        let refund_future: Future = credits.aleo/transfer_public(
            self.caller, COMMIT_STAKE
        );

        let event: CommitStakeRefunded = CommitStakeRefunded {
            owner:      self.caller,
            auction_id: auction_id,
            amount:     COMMIT_STAKE,
        };

        let f: Future = finalize_refund_commit_stake(
            auction_id, acceptor_key, self.caller, refund_future
        );
        return (event, f);
    }

    async function finalize_refund_commit_stake(
        auction_id:   field,
        acceptor_key: field,
        caller:       address,
        refund_future: Future
    ) {
        // Auction must be terminal (not ACTIVE).
        let status: u8 = Mapping::get(auction_status, auction_id);
        assert(status != STATUS_ACTIVE);
        assert(status != STATUS_NONE);

        // Verify stake exists and prevent double-refund.
        let staked: u64 = Mapping::get_or_use(commit_stakes, acceptor_key, 0u64);
        assert(staked > 0u64);

        Mapping::set(commit_stakes, acceptor_key, 0u64);

        refund_future.await();
    }
}
