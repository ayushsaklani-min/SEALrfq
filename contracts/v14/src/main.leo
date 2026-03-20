import credits.aleo;
import test_usdcx_stablecoin.aleo;
import test_usad_stablecoin.aleo;

// ═══════════════════════════════════════════════════════════════════════════════
//
//   [Fix-A/v14] release_final_payment
//               — escrow is returned to the CREATOR (caller), not the winner.
//
//               Root cause: pay_invoice (transition #23) already privately transfers
//               winning_amount from the creator's own credits record to the winner.
//               Under v13 release_final_payment then ALSO transferred the entire
//               public escrow (also == winning_amount) to the winner, resulting in
//               the winner receiving 2 × winning_amount and the creator losing
//               2 × winning_amount.
//
//               Correct semantics: the escrow is a bond the creator posts to prove
//               solvency.  After confirming private delivery payment via pay_invoice
//               (paid=true), the creator calls release_final_payment to recover their
//               bond.  The winner's actual payment was the private transfer in
//               pay_invoice.
//
//               Change: `transfer_public(winner, remaining)` →
//                       `transfer_public(self.caller, remaining)`.
//               The `winner` parameter is retained for on-chain audit verification
//               in finalize but is no longer the payment recipient.
//
//   [Fix-B/v14] creator_reclaim_escrow
//               — added `assert_eq(is_paid, false)` guard.
//
//               Root cause: after pay_invoice sets paid=true the status remains
//               STATUS_ESCROW_FUNDED and final_payment_released stays false.
//               creator_reclaim_escrow checked neither, so the creator could call
//               pay_invoice (privately paying the winner) then wait out
//               ESCROW_RECOVERY_BLOCKS and additionally drain the public escrow
//               back to themselves via creator_reclaim_escrow, with no double-spend
//               guard.  The creator would effectively pay nothing net while the
//               winner's stake remained locked in a perpetual STATUS_ESCROW_FUNDED
//               limbo.
//
//               Fix: if pay_invoice has already been called (paid=true) the creator
//               must follow the normal release path (release_final_payment) to
//               recover the bond.  The emergency timeout path is reserved for the
//               case where pay_invoice was never called.
//
//   [Fix-C/v14] select_winner — creator authorization required.
//               — pass self.caller to finalize; assert caller == rfq_creators[rfq_id].
//
//               Root cause: any address could call select_winner with the correct
//               on-chain arguments (lowest bid id, correct amount, correct winner
//               address) and trigger the state transition without the creator's
//               consent.  While the outcome is fully constrained by on-chain state
//               the transition removes the creator's control over timing.
//
//               Liveness escape: cancel_rfq_stuck_reveal (#11) fires for any
//               revealed_count after reveal_deadline + SLASH_WINDOW, allowing all
//               bidders to recover stakes if the creator is unresponsive.
//
//   [Fix-D/v14] cancel_rfq — blocked after bidding deadline.
//               — added `assert(block.height < bidding_deadline)` in finalize.
//
//               Root cause: finalize_cancel_rfq only checked status == STATUS_OPEN
//               and caller == creator.  After the bidding deadline closed, status
//               is still STATUS_OPEN until close_bidding is called.  In this window
//               the creator could cancel despite bidders having irrevocably committed
//               stakes expecting the protocol to proceed to the reveal phase.
//
//               Fix: cancellation is only valid while bidding is still in progress.
//               Post-deadline paths: cancel_rfq_insufficient_bids (#10) if shortfall,
//               or bid deadline has not yet passed for normal creator-initiated cancel.
//
//   [Fix-E/v14] + winner_claim_escrow (new transition #25)
//               — explicit winner-protection path when the creator funds escrow but
//               never calls pay_invoice.
//
//               Gap: after Fix-B, creator_reclaim_escrow is blocked when paid=true.
//               But if the creator simply does nothing after fund_escrow (paid stays
//               false), after ESCROW_RECOVERY_BLOCKS the creator can still reclaim
//               the escrow via creator_reclaim_escrow, leaving the winner with no
//               compensation for the work performed under the winning bid.
//
//               Fix: the winner may claim the escrow as compensation after the same
//               ESCROW_RECOVERY_BLOCKS timeout if paid==false and total_released==0
//               (full-payment path only; partial-release abandonment is a known
//               remaining gap documented below).  On success the status transitions
//               to STATUS_COMPLETED, enabling release_winner_stake (#20) for the
//               winner's stake recovery.
//
//               Known remaining gap (not addressed in this version): if the creator
//               starts partial releases (Path A) but then abandons mid-way, the
//               remaining escrow is inaccessible to the winner.  creator_reclaim_escrow
//               can still recover it for the creator after ESCROW_RECOVERY_BLOCKS.
//               A future merged winner-claim mode transition would close this.
//
// Settlement paths after v14 — mutually exclusive:
//
//   Path A  (public partial releases, no private payment):
//     winner_accept → fund_escrow → [release_partial_payment]× → STATUS_COMPLETED
//     Invariant: paid==false, total_released grows with each call.
//
//   Path B  (private full payment + bond recovery):
//     winner_accept → fund_escrow → pay_invoice → release_final_payment
//     Invariant: paid==true, total_released==0 throughout.
//     Creator gets escrow back; winner's payment was the private transfer.
//
//   Path B-timeout (winner claims unpaid escrow):
//     winner_accept → fund_escrow → [creator ghosts] → winner_claim_escrow(mode=0)
//     Fires only when: paid==false, total_released==0, timeout elapsed, caller==winner.
//
// Invariants that did NOT change:
//   - all v12/v13 hardening (receipt nonce, invoice nonce, partial+private mixing guard)
//   - escrow funding (fund_escrow / finalize_fund_escrow)         — untouched
//   - stake transfers (all slash/refund/release paths)             — untouched
//   - commit-reveal logic                                          — untouched
//   - all existing public transfers                                — untouched
//   - cancel_rfq_insufficient_bids, cancel_rfq_stuck_reveal,
//     cancel_rfq_no_escrow                                         — untouched
program sealrfq_v17.aleo {

    // ─── CONSTANTS ───────────────────────────────────────────────────────────

    const MAX_BID_AMOUNT:          u64 = 1_000_000_000u64;
    const MIN_STAKE_PERCENTAGE:    u8  = 10u8;
    const MAX_RFQ_DURATION:        u32 = 100_000u32;
    const MIN_REVEAL_WINDOW:       u32 = 720u32;
    const ESCROW_TIMEOUT_BLOCKS:   u32 = 2160u32;
    const SLASH_WINDOW:            u32 = 1440u32;
    const ESCROW_RECOVERY_BLOCKS:  u32 = 2880u32;
    const MIN_PARTIAL_RELEASE_PCT: u8  = 1u8;
    const FEE_DENOMINATOR:         u64 = 10_000u64;
    // [v16] Anti-sniping tuning for bid commit extension.
    const SNIPE_WINDOW_BLOCKS:     u32 = 40u32;
    const SNIPE_EXTENSION_BLOCKS:  u32 = 40u32;

    // ─── STATUS CODES ────────────────────────────────────────────────────────
    const STATUS_NONE:             u8 = 0u8;
    const STATUS_OPEN:             u8 = 1u8;
    const STATUS_REVEAL:           u8 = 2u8;
    const STATUS_WINNER_SELECTED:  u8 = 3u8;
    const STATUS_ESCROW_FUNDED:    u8 = 4u8;
    const STATUS_COMPLETED:        u8 = 5u8;
    const STATUS_CANCELLED:        u8 = 6u8;
    const STATUS_WINNER_DECLINED:  u8 = 7u8;

    // ─── TOKEN TYPES ────────────────────────────────────────────────────────
    const TOKEN_CREDITS: u8 = 0u8;
    const TOKEN_USDCX:   u8 = 1u8;
    const TOKEN_USAD:    u8 = 2u8;
    const PROOF_TAG_SETTLEMENT: u8 = 1u8;
    const PROOF_TAG_PAYMENT:    u8 = 2u8;

    // ─── PRICING MODES ─────────────────────────────────────────────────────
    // Determines how the winner/price is discovered for this RFQ.
    //   RFQ     = internal sealed-bid lowest-price (existing select_winner)
    //   VICKREY = external Vickrey auction result (second-price)
    //   DUTCH   = external Dutch auction result (descending price)
    const MODE_RFQ:     u8 = 0u8;
    const MODE_VICKREY: u8 = 1u8;
    const MODE_DUTCH:   u8 = 2u8;

    // ─── STRUCTS ─────────────────────────────────────────────────────────────

    struct CommitmentInput {
        bid_amount: u64,
        nonce:      field,
    }

    struct NonceKey {
        actor:      address,
        action_tag: u8,
        rfq_id:     field,
    }

    struct VendorRFQKey {
        vendor: address,
        rfq_id: field,
    }

    struct BidKey {
        rfq_id: field,
        bid_id: field,
    }

    // [Fix-6/v13] Binds rfq_id to (creator, salt) so no other caller can claim
    // the same rfq_id by front-running.  Used exclusively in create_rfq.
    struct RFQIdInput {
        creator: address,
        salt:    field,
    }

    // [CRITICAL FIX] Auction↔RFQ binding hash for auditability + reuse prevention.
    // Stored in auction_source mapping — encodes (auction_id, rfq_id, winner, price)
    // so anyone can verify: (a) the imported result matches the auction on-chain,
    // (b) the auction was bound to THIS specific RFQ.
    // Cross-program defense: auction programs store auction_rfq_id[auction_id] = rfq_id
    // on-chain, so any mismatch is publicly detectable even though v14 cannot
    // read auction mappings directly.
    struct ResultHashInput {
        auction_id: field,
        rfq_id:     field,
        winner:     address,
        price:      u64,
    }

    // [v11] Preimage for the BHP256 receipt hash produced by pay_invoice.
    // [v12] Added `nonce` so each call produces a distinct hash even if all
    //       other fields are identical — prevents receipt-hash replay.
    // Binds rfq_id + payer + winner + amount + nonce.
    struct ReceiptInput {
        rfq_id: field,
        payer:  address,
        winner: address,
        amount: u64,
        nonce:  field,   // [v12] caller-supplied; committed into receipt_hash
    }

    // [v16] Tagged key for merged proof storage mapping.
    struct V16ProofKey {
        rfq_id:    field,
        proof_tag: u8,
    }

    // [v16] Public settlement integrity preimage for RFQ winner selection.
    struct RFQSettlementProof {
        rfq_id:         field,
        winning_bid_id: field,
        winning_amount: u64,
        winner_address: address,
        settled_at:     u32,
    }

    // [v16] Deterministic winner-certificate identifier input.
    struct WinnerCertificateInput {
        rfq_id:         field,
        winning_bid_id: field,
        winner_address: address,
    }

    // [v16] Platform controls for fee and protocol pause status.
    struct PlatformConfig {
        admin_hash:       field,
        fee_bps:          u64,
        paused:           bool,
        treasury_credits: u64,
        treasury_usdcx:   u64,
        treasury_usad:    u64,
    }

    // ─── RECORDS ─────────────────────────────────────────────────────────────

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

    // [v16] Private certificate proving the holder won a specific RFQ.
    record WinnerCertificate {
        owner:          address,
        rfq_id:         field,
        winning_bid_id: field,
        winner_address: address,
        certificate_id: field,
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

    // [Fix-A/v14] This record is now issued to the CREATOR as proof that the
    // escrow bond was returned after a successful pay_invoice confirmation.
    // The winner's payment was the private transfer in pay_invoice (#23).
    record FinalPaymentReleased {
        owner:          address,   // creator — recipient of the returned escrow bond
        rfq_id:         field,
        release_amount: u64,       // escrow amount returned to creator
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

    // [REMOVED] WinnerStakeReleased record — release_winner_stake is dead code.

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

    // [REMOVED] UnrevealedStakeReclaimed record — merged into refund_any_stake.

    // [v11] Private receipt issued to the caller on a successful pay_invoice.
    // Proves (off-chain) that a private transfer for rfq_id was executed.
    record InvoiceReceipt {
        owner:        address,
        rfq_id:       field,
        receipt_hash: field,
        amount:       u64,
    }

    // [Fix-E/v14] Issued to the winner when they successfully claim an unfunded
    // escrow (creator ghosted after fund_escrow without calling pay_invoice).
    // Status transitions to STATUS_COMPLETED, enabling release_winner_stake (#20).
    record WinnerEscrowClaimed {
        owner:  address,   // winner — recipient of the unclaimed escrow
        rfq_id: field,
        amount: u64,
    }

    // Issued when an external auction result is imported as the winner selection.
    record AuctionImported {
        owner:        address,   // creator
        rfq_id:       field,
        winner:       address,
        price:        u64,
        auction_type: u8,        // MODE_VICKREY or MODE_DUTCH
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
    mapping rfq_lifecycle_block:       field => u32;
    // [v15] rfq_escrow_timeout_block and rfq_metadata_hash removed — write-only,
    // never read by any finalize.  Freed 2 mapping slots for stablecoin support.
    mapping rfq_lowest_bid:            field => u64;
    mapping rfq_lowest_bid_id:         field => field;
    mapping rfq_flat_stake:            field => u64;

    // Bid-level state
    mapping bid_commitments:  field => field;
    mapping bid_owner:        field => address;
    mapping revealed_bids:    field => u64;
    mapping bid_stakes:       field => u64;
    mapping winner_bids:      field => field;
    mapping vendor_bid_count: field => u64;

    // Escrow accounting
    // [v15] escrow_token selects the settlement token: 0=Credits, 1=USDCx, 2=USAD.
    // Set once in create_rfq, enforced in all escrow transitions.
    // Escrow amounts stored as u64 for all tokens — u64 max ≈ 18.4 quintillion
    // micro-units which exceeds any real-world RFQ.  Stablecoin u128 amounts are
    // cast to/from u64 at the external call boundary.
    mapping escrow_token:           field => u8;
    mapping escrow_original:        field => u64;
    mapping escrow_amounts:         field => u64;
    mapping total_released:         field => u64;
    mapping final_payment_released: field => bool;

    // Replay-protection nonces
    // [Fix-v15] Merged 4 per-action nonce mappings into one: action_tag in the
    // BHP256 key hash already distinguishes commit(1)/reveal(2)/payment(3)/invoice(4).
    mapping actor_nonces: field => u64;

    // Winner acceptance gate
    mapping rfq_winner_accepted: field => bool;

    // [v11] Private payment layer
    // receipts: rfq_id => receipt_hash  — on-chain proof of pay_invoice execution
    // paid:     rfq_id => bool          — gate that release_final_payment asserts
    mapping receipts: field => field;
    mapping paid:     field => bool;

    // Pricing mode: 0=RFQ (default), 1=Vickrey, 2=Dutch
    mapping rfq_mode: field => u8;

    // [v16] Public proof storage: settlement and payment commitments.
    mapping v16_proofs: field => field;

    // [v16] Global platform configuration (admin_hash == 0field ⇒ uninitialized).
    mapping platform_config: u8 => PlatformConfig;

    // [CRITICAL FIX] Auction↔RFQ binding hash — stores hash(auction_id, rfq_id, winner, price).
    // 0field = not yet imported.  Non-zero = binding hash.
    // Prevents double-import AND cross-RFQ auction reuse.
    // Anyone can verify: recompute hash(auction_id, rfq_id, winner, price) and compare.
    mapping auction_source: field => field;
    // [v12] Sequential nonce per creator for pay_invoice — prevents tx replay.
    // (actor_nonces merged into actor_nonces above)

    @noupgrade
    async constructor() {}

    // ═══════════════════════════════════════════════════════════════════════
    // [v16] PLATFORM CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════

    // [v16] configure_platform merges initialize + pause control.
    // First call initializes admin/fee settings. Subsequent calls are admin-only updates.
    async transition configure_platform(
        public fee_bps: u64,
        public paused:  bool
    ) -> Future {
        assert(fee_bps < FEE_DENOMINATOR);
        return finalize_configure_platform(self.caller, fee_bps, paused);
    }

    async function finalize_configure_platform(
        caller:  address,
        fee_bps: u64,
        paused:  bool
    ) {
        let caller_hash: field = BHP256::hash_to_field(caller);
        let cfg: PlatformConfig = Mapping::get_or_use(platform_config, 0u8, PlatformConfig {
            admin_hash:       0field,
            fee_bps:          0u64,
            paused:           false,
            treasury_credits: 0u64,
            treasury_usdcx:   0u64,
            treasury_usad:    0u64,
        });

        let is_uninitialized: bool = cfg.admin_hash == 0field;
        if is_uninitialized {
            Mapping::set(platform_config, 0u8, PlatformConfig {
                admin_hash:       caller_hash,
                fee_bps:          fee_bps,
                paused:           paused,
                treasury_credits: cfg.treasury_credits,
                treasury_usdcx:   cfg.treasury_usdcx,
                treasury_usad:    cfg.treasury_usad,
            });
        } else {
            assert_eq(caller_hash, cfg.admin_hash);
            Mapping::set(platform_config, 0u8, PlatformConfig {
                admin_hash:       cfg.admin_hash,
                fee_bps:          fee_bps,
                paused:           paused,
                treasury_credits: cfg.treasury_credits,
                treasury_usdcx:   cfg.treasury_usdcx,
                treasury_usad:    cfg.treasury_usad,
            });
        }
    }

    // [v16] Admin-only fee withdrawal (Credits).
    async transition withdraw_fees(
        public amount: u64
    ) -> Future {
        assert(amount > 0u64);

        let payout_future: Future = credits.aleo/transfer_public(self.caller, amount);
        return finalize_withdraw_fees(self.caller, TOKEN_CREDITS, amount, payout_future);
    }

    // [v16] Admin-only fee withdrawal (USDCx).
    async transition withdraw_fees_usdcx(
        public amount: u64
    ) -> Future {
        assert(amount > 0u64);

        let payout_future: Future =
            test_usdcx_stablecoin.aleo/transfer_public(self.caller, amount as u128);
        return finalize_withdraw_fees(self.caller, TOKEN_USDCX, amount, payout_future);
    }

    async function finalize_withdraw_fees(
        caller:       address,
        token_type:   u8,
        amount:       u64,
        payout_future: Future
    ) {
        assert(token_type == TOKEN_CREDITS || token_type == TOKEN_USDCX);

        let cfg: PlatformConfig = Mapping::get_or_use(platform_config, 0u8, PlatformConfig {
            admin_hash:       0field,
            fee_bps:          0u64,
            paused:           false,
            treasury_credits: 0u64,
            treasury_usdcx:   0u64,
            treasury_usad:    0u64,
        });
        assert(cfg.admin_hash != 0field);

        let caller_hash: field = BHP256::hash_to_field(caller);
        assert_eq(caller_hash, cfg.admin_hash);

        let treasury: u64 = token_type == TOKEN_CREDITS
            ? cfg.treasury_credits
            : cfg.treasury_usdcx;
        assert(amount <= treasury);

        payout_future.await();

        Mapping::set(platform_config, 0u8, PlatformConfig {
            admin_hash:       cfg.admin_hash,
            fee_bps:          cfg.fee_bps,
            paused:           cfg.paused,
            treasury_credits: token_type == TOKEN_CREDITS ? (treasury - amount) : cfg.treasury_credits,
            treasury_usdcx:   token_type == TOKEN_USDCX   ? (treasury - amount) : cfg.treasury_usdcx,
            treasury_usad:    cfg.treasury_usad,
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 1. CREATE RFQ
    //
    // [Fix-6/v13] `salt` binds rfq_id to (creator, salt) via BHP256 hash,
    // eliminating front-running DoS.  Unchanged in v14.
    // ═══════════════════════════════════════════════════════════════════════

    async transition create_rfq(
        public rfq_id:           field,
        public salt:             field,
        public bidding_deadline: u32,
        public reveal_deadline:  u32,
        public min_bid:          u64,
        public min_bid_count:    u64,
        public metadata_hash:    field,
        public token_type:       u8,      // 0=Credits, 1=USDCx, 2=USAD
        public pricing_mode:     u8       // 0=RFQ, 1=Vickrey, 2=Dutch
    ) -> (RFQCreated, Future) {
        assert(rfq_id        != 0field);
        assert(salt          != 0field);
        assert(min_bid        > 0u64);
        assert(min_bid        < MAX_BID_AMOUNT);
        assert(min_bid_count  > 0u64);
        assert(metadata_hash != 0field);
        assert(reveal_deadline > bidding_deadline);
        assert(token_type <= TOKEN_USAD);
        assert(pricing_mode <= MODE_DUTCH);

        let derived_id: field = BHP256::hash_to_field(RFQIdInput {
            creator: self.caller,
            salt:    salt,
        });
        assert_eq(rfq_id, derived_id);

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
            min_bid, min_bid_count, metadata_hash, flat_stake, self.caller,
            token_type, pricing_mode
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
        creator:          address,
        token_type:       u8,
        pricing_mode:     u8
    ) {
        assert(rfq_id != 0field);

        let now: u32 = block.height;
        assert(bidding_deadline  > now);
        assert(bidding_deadline  <= now + MAX_RFQ_DURATION);
        assert(reveal_deadline   > now);
        assert(reveal_deadline   <= now + MAX_RFQ_DURATION);
        assert(reveal_deadline   > bidding_deadline);
        assert(reveal_deadline - bidding_deadline >= MIN_REVEAL_WINDOW);

        let existing: u8 = Mapping::get_or_use(rfq_status, rfq_id, STATUS_NONE);
        assert_eq(existing, STATUS_NONE);

        // [v16] Enforce platform pause gate at RFQ creation.
        let cfg: PlatformConfig = Mapping::get_or_use(platform_config, 0u8, PlatformConfig {
            admin_hash:       0field,
            fee_bps:          0u64,
            paused:           false,
            treasury_credits: 0u64,
            treasury_usdcx:   0u64,
            treasury_usad:    0u64,
        });
        assert(cfg.admin_hash != 0field);
        assert_eq(cfg.paused, false);

        Mapping::set(rfq_status,            rfq_id, STATUS_OPEN);
        Mapping::set(rfq_bidding_deadlines, rfq_id, bidding_deadline);
        Mapping::set(rfq_reveal_deadlines,  rfq_id, reveal_deadline);
        Mapping::set(rfq_min_bids,          rfq_id, min_bid);
        Mapping::set(rfq_min_bid_count,     rfq_id, min_bid_count);
        Mapping::set(rfq_creators,          rfq_id, creator);
        Mapping::set(rfq_bid_count,         rfq_id, 0u64);
        // [v15] rfq_metadata_hash removed (write-only).
        Mapping::set(rfq_lowest_bid,        rfq_id, MAX_BID_AMOUNT);
        Mapping::set(rfq_lowest_bid_id,     rfq_id, 0field);
        Mapping::set(rfq_flat_stake,        rfq_id, flat_stake);
        // [v15] Lock the token type for the entire RFQ lifecycle.
        Mapping::set(escrow_token,          rfq_id, token_type);
        // Lock the pricing mode for the entire RFQ lifecycle.
        Mapping::set(rfq_mode,             rfq_id, pricing_mode);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. SUBMIT BID COMMIT
    // ═══════════════════════════════════════════════════════════════════════

    async transition submit_bid_commit(
        public rfq_id:          field,
               bid_amount:      u64,
               nonce:           field,
        public stake:           u64,
        public bid_id:          field,
        public user_nonce:      u64,
        public claimed_min_bid: u64
    ) -> (BidCommitted, Future) {
        assert(bid_id          != 0field);
        assert(bid_amount       > 0u64);
        assert(bid_amount       < MAX_BID_AMOUNT);
        assert(stake            > 0u64);
        assert(stake            < MAX_BID_AMOUNT);
        assert(nonce           != 0field);
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
        unique_bid_key:  field,
        commitment:      field,
        rfq_id:          field,
        claimed_min_bid: u64,
        stake:           u64,
        nonce_key:       field,
        user_nonce:      u64,
        vendor:          address,
        vendor_rfq_key:  field,
        stake_future:    Future
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_OPEN);

        let bidding_deadline: u32 = Mapping::get(rfq_bidding_deadlines, rfq_id);
        assert(block.height < bidding_deadline);

        let actual_min_bid: u64 = Mapping::get(rfq_min_bids, rfq_id);
        assert_eq(claimed_min_bid, actual_min_bid);

        let expected_flat_stake: u64 = Mapping::get(rfq_flat_stake, rfq_id);
        assert_eq(stake, expected_flat_stake);

        let existing: field = Mapping::get_or_use(bid_commitments, unique_bid_key, 0field);
        assert_eq(existing, 0field);

        let existing_count: u64 = Mapping::get_or_use(vendor_bid_count, vendor_rfq_key, 0u64);
        assert_eq(existing_count, 0u64);

        stake_future.await();

        Mapping::set(bid_commitments,  unique_bid_key, commitment);
        Mapping::set(bid_owner,        unique_bid_key, vendor);
        Mapping::set(bid_stakes,       unique_bid_key, stake);
        Mapping::set(vendor_bid_count, vendor_rfq_key, 1u64);

        let count: u64 = Mapping::get_or_use(rfq_bid_count, rfq_id, 0u64);
        Mapping::set(rfq_bid_count, rfq_id, count + 1u64);

        // [v16] Anti-sniping: extend bidding/reveal windows for late commits.
        let snipe_threshold: u32 = bidding_deadline > SNIPE_WINDOW_BLOCKS
            ? bidding_deadline - SNIPE_WINDOW_BLOCKS
            : 0u32;
        let should_extend: bool = block.height > snipe_threshold;
        if should_extend {
            let extended_bidding_deadline: u32 = bidding_deadline + SNIPE_EXTENSION_BLOCKS;
            let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
            let extended_reveal_deadline: u32 = reveal_deadline + SNIPE_EXTENSION_BLOCKS;
            Mapping::set(rfq_bidding_deadlines, rfq_id, extended_bidding_deadline);
            Mapping::set(rfq_reveal_deadlines,  rfq_id, extended_reveal_deadline);
        }

        Mapping::set(actor_nonces, nonce_key, user_nonce);
    }

    // [v15] close_bidding (#3) removed — folded into reveal_bid (#4).
    // The first reveal past the bidding deadline auto-transitions STATUS_OPEN → STATUS_REVEAL.

    // ═══════════════════════════════════════════════════════════════════════
    // 4. REVEAL BID
    // ═══════════════════════════════════════════════════════════════════════

    async transition reveal_bid(
        public rfq_id:     field,
        public bid_id:     field,
               bid_amount: u64,
               nonce:      field,
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
        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        // [v15] Auto-close: accept STATUS_OPEN past bidding_deadline and transition
        // to STATUS_REVEAL on first reveal (replaces standalone close_bidding transition).
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert(status == STATUS_OPEN || status == STATUS_REVEAL);

        let bidding_deadline: u32 = Mapping::get(rfq_bidding_deadlines, rfq_id);
        if status == STATUS_OPEN {
            assert(block.height >= bidding_deadline);
            let bid_count: u64 = Mapping::get_or_use(rfq_bid_count, rfq_id, 0u64);
            let min_count: u64 = Mapping::get(rfq_min_bid_count, rfq_id);
            assert(bid_count >= min_count);
            Mapping::set(rfq_status, rfq_id, STATUS_REVEAL);
        }

        let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
        assert(block.height < reveal_deadline);

        let owner: address = Mapping::get(bid_owner, unique_bid_key);
        assert_eq(owner, caller);

        let stored: field = Mapping::get_or_use(bid_commitments, unique_bid_key, 0field);
        assert(stored != 0field);
        assert_eq(stored, commitment);

        let already_revealed: u64 = Mapping::get_or_use(revealed_bids, unique_bid_key, 0u64);
        assert_eq(already_revealed, 0u64);

        let min_bid: u64 = Mapping::get(rfq_min_bids, rfq_id);
        assert(bid_amount >= min_bid);

        Mapping::set(revealed_bids, unique_bid_key, bid_amount);

        let current_lowest: u64      = Mapping::get_or_use(rfq_lowest_bid,    rfq_id, MAX_BID_AMOUNT);
        let current_lowest_id: field = Mapping::get_or_use(rfq_lowest_bid_id, rfq_id, 0field);

        let is_lower: bool       = bid_amount < current_lowest;
        let new_lowest: u64      = is_lower ? bid_amount : current_lowest;
        let new_lowest_id: field = is_lower ? bid_id : current_lowest_id;

        Mapping::set(rfq_lowest_bid,    rfq_id, new_lowest);
        Mapping::set(rfq_lowest_bid_id, rfq_id, new_lowest_id);
        Mapping::set(actor_nonces, nonce_key, user_nonce);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. SELECT WINNER
    //
    // [Fix-C/v14] Added creator authorization.  self.caller is now passed to
    // finalize and asserted against rfq_creators[rfq_id].
    //
    // Previously any address could trigger this transition with the correct
    // on-chain arguments.  While the outcome was fully constrained by on-chain
    // state (lowest bid wins), the transition gave any external observer the
    // ability to advance the RFQ without the creator's consent.
    //
    // Liveness: if the creator is unresponsive, cancel_rfq_stuck_reveal (#11)
    // fires after reveal_deadline + SLASH_WINDOW, allowing all bidders to
    // recover stakes.
    // ═══════════════════════════════════════════════════════════════════════

    async transition select_winner(
        public rfq_id:         field,
        public winning_bid_id: field,
        public winning_amount: u64,
        public winner_address: address
    ) -> (WinnerSelected, WinnerCertificate, Future) {
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

        // [v16] Private winner certificate for selective disclosure.
        let certificate_id: field = BHP256::hash_to_field(WinnerCertificateInput {
            rfq_id:         rfq_id,
            winning_bid_id: winning_bid_id,
            winner_address: winner_address,
        });
        let cert: WinnerCertificate = WinnerCertificate {
            owner:          winner_address,
            rfq_id:         rfq_id,
            winning_bid_id: winning_bid_id,
            winner_address: winner_address,
            certificate_id: certificate_id,
        };

        // [Fix-C/v14] Pass self.caller to finalize for creator auth check.
        let f: Future = finalize_select_winner(
            rfq_id, winning_bid_id, unique_bid_key, winning_amount, winner_address, self.caller
        );

        return (event, cert, f);
    }

    async function finalize_select_winner(
        rfq_id:         field,
        winning_bid_id: field,
        unique_bid_key: field,
        winning_amount: u64,
        winner_address: address,
        caller:         address   // [Fix-C/v14]
    ) {
        // [Fix-C/v14] Only the creator may select the winner.
        // Liveness escape: cancel_rfq_stuck_reveal (#11) after
        // reveal_deadline + SLASH_WINDOW if creator is unresponsive.
        let actual_creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, actual_creator);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_REVEAL);

        let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
        assert(block.height >= reveal_deadline);

        let actual_winning_amount: u64 = Mapping::get_or_use(revealed_bids, unique_bid_key, 0u64);
        assert(actual_winning_amount > 0u64);
        assert_eq(winning_amount, actual_winning_amount);

        let lowest_bid_id: field = Mapping::get(rfq_lowest_bid_id, rfq_id);
        assert_eq(winning_bid_id, lowest_bid_id);

        let actual_winner: address = Mapping::get(bid_owner, unique_bid_key);
        assert_eq(winner_address, actual_winner);

        assert(actual_winner != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);

        // [v16] Tamper-evident winner selection proof for off-chain auditors.
        let settlement_hash: field = BHP256::hash_to_field(RFQSettlementProof {
            rfq_id:         rfq_id,
            winning_bid_id: winning_bid_id,
            winning_amount: actual_winning_amount,
            winner_address: actual_winner,
            settled_at:     block.height,
        });

        Mapping::set(winner_bids,               rfq_id, unique_bid_key);
        Mapping::set(rfq_winner_address,        rfq_id, actual_winner);
        Mapping::set(rfq_status,                rfq_id, STATUS_WINNER_SELECTED);
        Mapping::set(rfq_lifecycle_block,       rfq_id, block.height);
        Mapping::set(rfq_winner_accepted,       rfq_id, false);
        let settlement_key: field = BHP256::hash_to_field(V16ProofKey {
            rfq_id:    rfq_id,
            proof_tag: PROOF_TAG_SETTLEMENT,
        });
        Mapping::set(v16_proofs, settlement_key, settlement_hash);
    }

    // [v16] Selective-disclosure proof that caller holds a valid RFQ winner certificate.

    // ═══════════════════════════════════════════════════════════════════════
    // 6. WINNER RESPOND (accept or decline)
    //
    // Merged from winner_accept (#6) and winner_decline (#7).
    //   accept == true  → sets rfq_winner_accepted, returns stake to winner
    //   accept == false → slashes stake to creator, sets STATUS_WINNER_DECLINED
    //
    // NOTE: On accept, the stake is returned immediately to the winner.
    // Post-acceptance enforcement relies on the escrow mechanism: the creator
    // cannot release payment until work is verified, so the winner cannot
    // ghost without losing their right to payment.  The stake's sole purpose
    // here is to penalise a decline.
    // ═══════════════════════════════════════════════════════════════════════

    async transition winner_respond(
        public rfq_id:  field,
        public accept:  bool,
        public stake:   u64,
        public creator: address
    ) -> Future {
        assert(creator != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
        assert(stake > 0u64);

        // Transfer a non-zero winner stake back to the winner or slash it to the creator.
        let stake_future: Future = credits.aleo/transfer_public(
            accept ? self.caller : creator,
            stake
        );

        return fin_win_resp(
            rfq_id, self.caller, accept, stake, creator, stake_future
        );
    }

    // Imported auction winners have no RFQ bid stake, so this path finalizes
    // acceptance/decline without attempting a zero-value credits transfer.
    async transition winner_respond_imported(
        public rfq_id:  field,
        public accept:  bool,
        public creator: address
    ) -> Future {
        assert(creator != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
        return fin_win_resp_no_stake(rfq_id, self.caller, accept, creator);
    }

    async function fin_win_resp_no_stake(
        rfq_id:   field,
        caller:   address,
        accept:   bool,
        creator:  address
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_WINNER_SELECTED);

        let winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(caller, winner);

        let already_accepted: bool = Mapping::get_or_use(rfq_winner_accepted, rfq_id, false);
        assert_eq(already_accepted, false);

        let winner_key: field   = Mapping::get(winner_bids, rfq_id);
        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, winner_key, 0u64);
        assert_eq(expected_stake, 0u64);

        // Imported auction winners do not lock RFQ bid stake.
        let imported_source: field = Mapping::get_or_use(auction_source, rfq_id, 0field);
        assert(imported_source != 0field);

        if accept {
            Mapping::set(rfq_winner_accepted, rfq_id, true);
        } else {
            let actual_creator: address = Mapping::get(rfq_creators, rfq_id);
            assert_eq(creator, actual_creator);
            Mapping::set(rfq_status, rfq_id, STATUS_WINNER_DECLINED);
        }
    }

    async function fin_win_resp(
        rfq_id:       field,
        caller:       address,
        accept:       bool,
        stake:        u64,
        creator:      address,
        stake_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_WINNER_SELECTED);

        let winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(caller, winner);

        let already_accepted: bool = Mapping::get_or_use(rfq_winner_accepted, rfq_id, false);
        assert_eq(already_accepted, false);

        let winner_key: field   = Mapping::get(winner_bids, rfq_id);
        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, winner_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);

        let actual_creator: address = Mapping::get(rfq_creators, rfq_id);
        if !accept {
            assert_eq(creator, actual_creator);
        }

        Mapping::set(bid_stakes, winner_key, 0u64);
        stake_future.await();

        if accept {
            Mapping::set(rfq_winner_accepted, rfq_id, true);
        } else {
            Mapping::set(rfq_status, rfq_id, STATUS_WINNER_DECLINED);
        }
    }

    // [v15] refund_stake_declined (#8) removed — covered by refund_any_stake (#13).

    // ═══════════════════════════════════════════════════════════════════════
    // 9. CANCEL RFQ — CREATOR INITIATED
    //
    // [Fix-D/v14] Added `assert(block.height < bidding_deadline)`.
    //
    // Previously the only guards were status==STATUS_OPEN and caller==creator.
    // After the bidding deadline the status is still STATUS_OPEN until
    // close_bidding is called.  In that window the creator could cancel even
    // though bidders have already irrevocably committed stakes and posted them
    // on-chain, expecting the protocol to advance to the reveal phase.
    //
    // After the fix: creator-initiated cancellation is only valid while bidding
    // is actively in progress (block.height < bidding_deadline).
    // Post-deadline paths:
    //   - cancel_rfq_insufficient_bids (#10) if bid_count < min_bid_count
    //   - cancel_rfq_stuck_reveal (#11)      if reveal window expires without winner
    // ═══════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════
    // 9/10. CANCEL RFQ (merged)
    //
    // Merged from cancel_rfq (#9), cancel_rfq_insufficient_bids (#10),
    // cancel_rfq_stuck_reveal (#11), and cancel_rfq_no_escrow (#12).
    //
    //   mode == 3u8 → creator pre-deadline cancel (Fix-D path)
    //   mode == 0u8 → insufficient bids (STATUS_OPEN past bidding_deadline)
    //   mode == 1u8 → stuck reveal    (STATUS_REVEAL past reveal_deadline + SLASH_WINDOW)
    //   mode == 2u8 → no escrow funded after winner selection timeout
    //
    // [Fix-3/v13] revealed_count guard removed from stuck-reveal path.
    // ═══════════════════════════════════════════════════════════════════════

    async transition cancel_rfq_post_deadline(
        public rfq_id:  field,
        public creator: address,
        public mode:    u8
    ) -> (RFQCancelled, Future) {
        let event: RFQCancelled = RFQCancelled {
            owner:   self.caller,
            rfq_id:  rfq_id,
            creator: creator,
        };
        let f: Future = finalize_cancel_post_deadline(rfq_id, creator, mode, self.caller);
        return (event, f);
    }

    // Merged modes:
    //   0u8 = insufficient bids (STATUS_OPEN past bidding_deadline)
    //   1u8 = stuck reveal      (STATUS_REVEAL past reveal_deadline + SLASH_WINDOW)
    //   2u8 = no escrow funded  (STATUS_WINNER_SELECTED past ESCROW_TIMEOUT_BLOCKS)
    async function finalize_cancel_post_deadline(
        rfq_id:  field,
        creator: address,
        mode:    u8,
        caller:  address
    ) {
        let actual_creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(creator, actual_creator);

        if (mode == 3u8) {
            // [Fix-D/v14] Creator pre-deadline cancel only.
            assert_eq(caller, actual_creator);
            let status: u8 = Mapping::get(rfq_status, rfq_id);
            assert_eq(status, STATUS_OPEN);

            let bidding_deadline: u32 = Mapping::get(rfq_bidding_deadlines, rfq_id);
            assert(block.height < bidding_deadline);
        } else {
            if (mode == 0u8) {
                let status: u8 = Mapping::get(rfq_status, rfq_id);
                assert_eq(status, STATUS_OPEN);

                let bidding_deadline: u32 = Mapping::get(rfq_bidding_deadlines, rfq_id);
                assert(block.height >= bidding_deadline);

                let bid_count: u64 = Mapping::get_or_use(rfq_bid_count, rfq_id, 0u64);
                let min_count: u64 = Mapping::get(rfq_min_bid_count, rfq_id);
                assert(bid_count < min_count);
            } else {
                if (mode == 1u8) {
                    let status: u8 = Mapping::get(rfq_status, rfq_id);
                    assert_eq(status, STATUS_REVEAL);

                    let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
                    assert(block.height > reveal_deadline + SLASH_WINDOW);
                } else {
                    // [MECHANISM FIX] mode 2u8: no escrow funded after winner selection.
                    assert_eq(mode, 2u8);
                    let status: u8 = Mapping::get(rfq_status, rfq_id);
                    assert_eq(status, STATUS_WINNER_SELECTED);

                    let selected_block: u32 = Mapping::get(rfq_lifecycle_block, rfq_id);
                    assert(block.height > selected_block + ESCROW_TIMEOUT_BLOCKS);
                }
            }
        }

        Mapping::set(rfq_status, rfq_id, STATUS_CANCELLED);
    }

    // cancel_rfq_no_escrow (#12) merged into cancel_rfq_post_deadline mode 2u8.

    // ═══════════════════════════════════════════════════════════════════════
    // 13. REFUND STAKE — CANCELLED RFQ
    //
    // Note: this transition has NO winner exclusion, so the winning bidder may
    // also use it to recover their stake whenever status == CANCELLED.
    // Covered cancellation paths include cancel_rfq, cancel_rfq_insufficient_bids,
    // cancel_rfq_stuck_reveal (including partial reveals after Fix-3/v13),
    // cancel_rfq_no_escrow, and creator_reclaim_escrow.
    // For an explicit, well-documented winner-only path see transition #24
    // (release_winner_stake_cancelled).
    // ═══════════════════════════════════════════════════════════════════════

    async transition refund_any_stake(
        public rfq_id: field,
        public bid_id: field,
        public stake:  u64
    ) -> (StakeRefunded, Future) {
        assert(bid_id != 0field);
        assert(stake > 0u64);

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
        let f: Future = finalize_refund_any_stake(
            rfq_id, unique_bid_key, self.caller, stake, refund_future
        );
        return (event, f);
    }

    // Merged from refund_stake_cancelled (#13), refund_stake (#19), and
    // reclaim_unrevealed_stake (#14).
    // When cancelled: any bidder (including winner) may refund their stake.
    // When post-reveal/post-selection (not cancelled): only non-winners may refund.
    // When STATUS_REVEAL: requires SLASH_WINDOW to have passed (protects slashing rights).
    async function finalize_refund_any_stake(
        rfq_id:         field,
        unique_bid_key: field,
        caller:         address,
        stake:          u64,
        refund_future:  Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        let is_cancelled: bool = status == STATUS_CANCELLED;

        if is_cancelled {
            assert_eq(status, STATUS_CANCELLED);
        } else {
            // [H-2 MERGE] Post-reveal / post-selection non-winner refund.
            // Accepts STATUS_REVEAL (with SLASH_WINDOW guard) in addition to
            // the original >= STATUS_WINNER_SELECTED path.
            assert(status >= STATUS_REVEAL);

            // When in REVEAL status, the slash window must have passed to
            // prevent non-revealers from escaping the creator's slashing rights.
            let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
            let slash_window_passed: bool = block.height > reveal_deadline + SLASH_WINDOW;
            let post_selection: bool = status >= STATUS_WINNER_SELECTED;
            assert(post_selection || slash_window_passed);

            let winner_key: field = Mapping::get_or_use(winner_bids, rfq_id, 0field);
            assert(unique_bid_key != winner_key);
        }

        let owner: address = Mapping::get(bid_owner, unique_bid_key);
        assert_eq(owner, caller);

        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, unique_bid_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);

        Mapping::set(bid_stakes, unique_bid_key, 0u64);

        refund_future.await();
    }

    // [MERGED] reclaim_unrevealed_stake (#14) absorbed into refund_any_stake (#13).
    // Bidders with unrevealed stakes now use refund_any_stake after SLASH_WINDOW.

    // ═══════════════════════════════════════════════════════════════════════
    // 15. FUND ESCROW
    // ═══════════════════════════════════════════════════════════════════════

    async transition fund_escrow(
        public rfq_id: field,
        public amount: u64
    ) -> (EscrowFunded, Future) {
        assert(amount > 0u64);
        assert(amount < MAX_BID_AMOUNT);

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

        // [v15] Guard: this transition is for Credits-denominated RFQs only.
        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_CREDITS);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let accepted: bool = Mapping::get_or_use(rfq_winner_accepted, rfq_id, false);
        assert_eq(accepted, true);

        let winner_key: field   = Mapping::get(winner_bids, rfq_id);
        let winning_amount: u64 = Mapping::get(revealed_bids, winner_key);
        assert_eq(amount, winning_amount);

        let winner_addr: address = Mapping::get(rfq_winner_address, rfq_id);
        assert(winner_addr != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);

        let existing: u64 = Mapping::get_or_use(escrow_amounts, rfq_id, 0u64);
        assert_eq(existing, 0u64);

        escrow_future.await();

        Mapping::set(escrow_original,        rfq_id, amount);
        Mapping::set(escrow_amounts,         rfq_id, amount);
        Mapping::set(total_released,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, false);
        Mapping::set(rfq_lifecycle_block,    rfq_id, block.height);
        Mapping::set(rfq_status,             rfq_id, STATUS_ESCROW_FUNDED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 16. RELEASE PARTIAL PAYMENT
    //
    // [Fix-1/4/v13] assert paid[rfq_id] == false — unchanged in v14.
    // Settlement Path A (partial public releases).  Mutually exclusive with
    // Path B (pay_invoice → release_final_payment).
    // ═══════════════════════════════════════════════════════════════════════

    async transition release_partial_payment(
        public rfq_id:             field,
        public winner:             address,
        public release_amount:     u64,
        public percentage:         u8,
        public new_total_released: u64,
        public fee_bps:            u64,
        public user_nonce:         u64
    ) -> (PartialPaymentReleased, Future) {
        assert(percentage         > 0u8);
        assert(percentage         <= 100u8);
        assert(release_amount     > 0u64);
        assert(new_total_released > 0u64);
        assert(fee_bps < FEE_DENOMINATOR);

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 3u8,
            rfq_id:     rfq_id,
        });

        // [v16] Release payout is net-of-fee; fee stays in protocol treasury.
        let fee_amount: u64 = (release_amount * fee_bps) / FEE_DENOMINATOR;
        let payout_amount: u64 = release_amount - fee_amount;
        assert(payout_amount > 0u64);
        let payment_future: Future = credits.aleo/transfer_public(winner, payout_amount);

        let f: Future = finalize_release_partial(
            rfq_id, percentage, self.caller, nonce_key, user_nonce,
            winner, release_amount, fee_bps, fee_amount, payout_amount,
            new_total_released, payment_future
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
        fee_bps:            u64,
        fee_amount:         u64,
        payout_amount:      u64,
        new_total_released: u64,
        payment_future:     Future
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        // [v15] Credits-only guard.
        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_CREDITS);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        // [Fix-1/4/v13] Mutual-exclusion: block partial releases if pay_invoice
        // has already been called.  Combined with the mirror guard in
        // finalize_pay_invoice (total_released == 0), the two settlement paths
        // are fully mutually exclusive.
        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, false);

        // [v16] Verify caller-supplied fee inputs against platform config.
        let cfg: PlatformConfig = Mapping::get_or_use(platform_config, 0u8, PlatformConfig {
            admin_hash:       0field,
            fee_bps:          0u64,
            paused:           false,
            treasury_credits: 0u64,
            treasury_usdcx:   0u64,
            treasury_usad:    0u64,
        });
        assert(cfg.admin_hash != 0field);
        assert_eq(fee_bps, cfg.fee_bps);
        let expected_fee_amount: u64 = (release_amount * fee_bps) / FEE_DENOMINATOR;
        assert_eq(fee_amount, expected_fee_amount);
        let expected_payout_amount: u64 = release_amount - fee_amount;
        assert_eq(payout_amount, expected_payout_amount);
        assert(payout_amount > 0u64);

        let remaining: u64        = Mapping::get(escrow_amounts, rfq_id);
        let already_released: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        let original: u64         = Mapping::get(escrow_original, rfq_id);

        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        let expected_release_amount: u64 = (remaining * (percentage as u64)) / 100u64;
        assert_eq(release_amount, expected_release_amount);
        assert(release_amount > 0u64);
        assert(release_amount <= remaining);

        let computed_min:  u64 = (original * (MIN_PARTIAL_RELEASE_PCT as u64)) / 100u64;
        let effective_min: u64 = computed_min > 0u64 ? computed_min : 1u64;
        assert(release_amount >= effective_min);

        assert_eq(new_total_released, already_released + release_amount);
        assert(new_total_released <= original);

        payment_future.await();

        let new_remaining: u64 = remaining - release_amount;

        // [SECURITY FIX] Global accounting invariant.
        // original == total_released + remaining must hold after every mutation.
        assert_eq(original, new_total_released + new_remaining);

        Mapping::set(total_released,       rfq_id, new_total_released);
        Mapping::set(escrow_amounts,       rfq_id, new_remaining);
        Mapping::set(actor_nonces, nonce_key, user_nonce);
        Mapping::set(platform_config, 0u8, PlatformConfig {
            admin_hash:       cfg.admin_hash,
            fee_bps:          cfg.fee_bps,
            paused:           cfg.paused,
            treasury_credits: cfg.treasury_credits + fee_amount,
            treasury_usdcx:   cfg.treasury_usdcx,
            treasury_usad:    cfg.treasury_usad,
        });

        let is_complete: bool = new_remaining == 0u64;
        let next_status: u8   = is_complete ? STATUS_COMPLETED : STATUS_ESCROW_FUNDED;
        Mapping::set(rfq_status, rfq_id, next_status);
        let mark_final: bool = is_complete ? true : false;
        Mapping::set(final_payment_released, rfq_id, mark_final);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 17. RELEASE FINAL PAYMENT  [v11 — new; v12 — hardened; v14 — Fix-A]
    //
    // Settlement Path B — bond recovery after private payment.
    //
    // [Fix-A/v14] Escrow is returned to the CREATOR (caller), not the winner.
    //
    //   Correct calling order (Path B):
    //     winner_accept → fund_escrow → pay_invoice → release_final_payment
    //
    //   Flow:
    //     1. fund_escrow:           creator locks winning_amount in public escrow.
    //     2. pay_invoice:           creator privately transfers winning_amount to
    //                               winner from their own credits record (shielded).
    //                               Sets paid[rfq_id] = true.
    //     3. release_final_payment: creator recovers the escrow bond now that
    //                               private payment is confirmed on-chain.
    //
    //   The `winner` parameter is still required and verified against
    //   rfq_winner_address[rfq_id] in finalize for audit integrity, but the
    //   PAYMENT TARGET is now self.caller (the creator), not the winner.
    //
    //   Without this fix: winner received winning_amount via private transfer
    //   (pay_invoice) AND winning_amount from the public escrow (release_final),
    //   totalling 2 × winning_amount.  Creator lost 2 × winning_amount.
    //
    //   Note: action_tag 3u8 is shared with release_partial_payment.  Both draw
    //   from the same sequential nonce space — safe because Fix-1/4/v13 and
    //   Fix-B/v14 make the two paths fully mutually exclusive for any given RFQ.
    //   WARNING: Any future stablecoin parallel transitions (release_final_payment_usdcx,
    //   release_partial_payment_usdcx) MUST use new action_tags (5u8, 6u8, etc.) and
    //   their own separate nonce mappings to avoid colliding with this tag 3 nonce space.
    // ═══════════════════════════════════════════════════════════════════════

    async transition release_final_payment(
        public rfq_id:     field,
        public winner:     address,  // verification only — payment goes to creator
        public remaining:  u64,
        public fee_bps:    u64,
        public user_nonce: u64
    ) -> (FinalPaymentReleased, Future) {
        assert(remaining > 0u64);
        assert(fee_bps < FEE_DENOMINATOR);

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 3u8,
            rfq_id:     rfq_id,
        });

        // [v16] Final bond return is net-of-fee; fee stays in protocol treasury.
        let fee_amount: u64 = (remaining * fee_bps) / FEE_DENOMINATOR;
        let payout_amount: u64 = remaining - fee_amount;
        assert(payout_amount > 0u64);
        let payment_future: Future = credits.aleo/transfer_public(self.caller, payout_amount);
        let f: Future = finalize_release_final(
            rfq_id, self.caller, nonce_key, user_nonce, winner, remaining,
            fee_bps, fee_amount, payout_amount, payment_future
        );

        let event: FinalPaymentReleased = FinalPaymentReleased {
            owner:          self.caller,   // creator receives the escrow bond back
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
        winner:         address,   // kept for on-chain audit verification only
        remaining:      u64,
        fee_bps:        u64,
        fee_amount:     u64,
        payout_amount:  u64,
        payment_future: Future
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        // [v15] Credits-only guard.
        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_CREDITS);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        // [v11] Private-payment gate.
        // The creator must call pay_invoice before recovering the public escrow.
        // This confirms off-chain / private delivery payment was made and logged.
        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, true);

        // [v12] Defense-in-depth: a non-zero receipts entry proves pay_invoice
        // actually stored a receipt hash — guards against any future mapping
        // manipulation that could set paid=true without a receipt.
        let stored_receipt: field = Mapping::get_or_use(receipts, rfq_id, 0field);
        assert(stored_receipt != 0field);

        // [v16] Verify caller-supplied fee inputs against platform config.
        let cfg: PlatformConfig = Mapping::get_or_use(platform_config, 0u8, PlatformConfig {
            admin_hash:       0field,
            fee_bps:          0u64,
            paused:           false,
            treasury_credits: 0u64,
            treasury_usdcx:   0u64,
            treasury_usad:    0u64,
        });
        assert(cfg.admin_hash != 0field);
        assert_eq(fee_bps, cfg.fee_bps);
        let expected_fee_amount: u64 = (remaining * fee_bps) / FEE_DENOMINATOR;
        assert_eq(fee_amount, expected_fee_amount);
        let expected_payout_amount: u64 = remaining - fee_amount;
        assert_eq(payout_amount, expected_payout_amount);
        assert(payout_amount > 0u64);

        // Audit: verify the caller supplied the correct on-chain winner address.
        // [Fix-A/v14] winner is verified here but is NOT the payment recipient.
        //             The payment (payment_future) goes to caller (creator).
        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        let already_released: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        let original: u64 = Mapping::get(escrow_original, rfq_id);

        // [Fix-A/v14] Transfer returning escrow bond to creator.
        payment_future.await();

        let new_total_released: u64 = already_released + remaining;

        // [SECURITY FIX] Global accounting invariant.
        assert_eq(original, new_total_released);

        Mapping::set(total_released,         rfq_id, new_total_released);
        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        Mapping::set(rfq_status,             rfq_id, STATUS_COMPLETED);
        Mapping::set(platform_config, 0u8, PlatformConfig {
            admin_hash:       cfg.admin_hash,
            fee_bps:          cfg.fee_bps,
            paused:           cfg.paused,
            treasury_credits: cfg.treasury_credits + fee_amount,
            treasury_usdcx:   cfg.treasury_usdcx,
            treasury_usad:    cfg.treasury_usad,
        });
        Mapping::set(actor_nonces,   nonce_key, user_nonce);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 18. SLASH NON-REVEALER
    // ═══════════════════════════════════════════════════════════════════════

    async transition slash_non_revealer(
        public rfq_id: field,
        public bid_id: field,
        public stake:  u64
    ) -> (StakeSlashed, Future) {
        assert(bid_id != 0field);
        assert(stake > 0u64);

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
        // [SECURITY FIX H-1] Non-revealers must be slashable even after
        // select_winner advances status to STATUS_WINNER_SELECTED.
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert(status == STATUS_REVEAL || status == STATUS_WINNER_SELECTED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
        assert(block.height >  reveal_deadline);
        assert(block.height <= reveal_deadline + SLASH_WINDOW);

        let commitment: field = Mapping::get_or_use(bid_commitments, unique_bid_key, 0field);
        assert(commitment != 0field);

        let revealed: u64 = Mapping::get_or_use(revealed_bids, unique_bid_key, 0u64);
        assert_eq(revealed, 0u64);

        let expected_stake: u64 = Mapping::get_or_use(bid_stakes, unique_bid_key, 0u64);
        assert_eq(stake, expected_stake);
        assert(stake > 0u64);

        Mapping::set(bid_stakes, unique_bid_key, 0u64);

        slash_future.await();
    }

    // [v15] refund_stake (#19) merged into refund_any_stake (#13).
    // refund_any_stake covers both cancelled and post-winner-selection cases.

    // [REMOVED] release_winner_stake (#20) — dead code after C-1/C-2 fix.
    // The winner's stake is now returned and zeroed during winner_respond(accept=true).
    // By the time STATUS_COMPLETED is reached, bid_stakes[winner_key] == 0.

    // [v15] claim_locked_winner_stake (#21) removed — replaced by the flow:
    //   cancel_rfq_no_escrow (#12) → refund_stake_cancelled (#13).

    // ═══════════════════════════════════════════════════════════════════════
    // 22. CREATOR RECLAIM ESCROW
    //
    // [Fix-B/v14] Added `assert_eq(is_paid, false)`.
    //
    // Root cause: after pay_invoice sets paid=true the status remains
    // STATUS_ESCROW_FUNDED and final_payment_released stays false.
    // Previously, the creator could call pay_invoice (privately paying the
    // winner the full winning_amount) and then wait out ESCROW_RECOVERY_BLOCKS
    // and additionally drain the public escrow back to themselves here.
    // The winner would be left with only the private payment and the creator
    // would net zero cost.
    //
    // After the fix: this transition is only available when pay_invoice has NOT
    // been called (paid==false).  If pay_invoice was called, the creator must
    // use release_final_payment (#17) to recover the escrow bond.
    //
    // After this executes the winner's stake is still held at bid_stakes[winner_key].
    // The winner recovers it via transition #24 (release_winner_stake_cancelled)
    // or the general refund_stake_cancelled (#13), both of which accept STATUS_CANCELLED.
    // ═══════════════════════════════════════════════════════════════════════

    async transition creator_reclaim_escrow(
        public rfq_id:    field,
        public remaining: u64
    ) -> (EscrowReclaimed, Future) {
        assert(remaining > 0u64);

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

        // [v15] Credits-only guard.
        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_CREDITS);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let funded_block: u32 = Mapping::get(rfq_lifecycle_block, rfq_id);
        assert(block.height > funded_block + ESCROW_RECOVERY_BLOCKS);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        // [Fix-B/v14] Block reclaim if pay_invoice has already been called.
        // If paid==true the creator has already privately paid the winner; they
        // must use release_final_payment (#17) to recover the escrow bond.
        // Allowing this path after pay_invoice would produce STATUS_CANCELLED
        // instead of STATUS_COMPLETED and give the creator a windfall.
        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, false);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        Mapping::set(rfq_status,             rfq_id, STATUS_CANCELLED);

        reclaim_future.await();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 23. PAY INVOICE  [v11 — new, v12 — hardened, v13 — comment corrected]
    //
    // Settlement Path B — Step 1 of 2.
    //
    // The creator privately transfers exactly the winning bid amount to the
    // winner using credits.aleo/transfer_private (shielded UTXO model).
    // No public balance moves are visible on-chain from this call.
    //
    // On success:
    //   • credits change record    → returned to caller   (private)
    //   • credits payment record   → sent to winner       (private, the ACTUAL payment)
    //   • InvoiceReceipt record    → returned to caller   (private proof)
    //   • paid[rfq_id]             → set to true          (public gate)
    //   • receipts[rfq_id]         → receipt_hash stored  (public audit trail)
    //
    // Calling order (Path B):
    //   winner_accept → fund_escrow → pay_invoice → release_final_payment
    //
    // After pay_invoice the creator calls release_final_payment (#17) to
    // recover their escrow bond.  The winner's payment is complete at this step.
    //
    // Parameters:
    //   rfq_id         — target RFQ (public, used for on-chain validation)
    //   winner         — recipient of the private transfer (public, validated in finalize)
    //   amount         — payment amount in microcredits (public, == winning_amount)
    //   invoice_nonce  — [v12] strictly-sequential u64; prevents tx replay
    //   receipt_nonce  — [v12] field committed into receipt_hash; makes hash unique
    //   payment        — caller's private credits record funding the transfer
    // ═══════════════════════════════════════════════════════════════════════

    async transition pay_invoice(
        public rfq_id:        field,
        public winner:        address,
        public amount:        u64,
        public invoice_nonce: u64,
               receipt_nonce: field,
               payment:       credits.aleo/credits
    ) -> (credits.aleo/credits, credits.aleo/credits, InvoiceReceipt, Future) {
        assert(rfq_id        != 0field);
        assert(amount         > 0u64);
        assert(amount         < MAX_BID_AMOUNT);
        assert(winner        != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
        assert(receipt_nonce != 0field);

        let (change, recv): (credits.aleo/credits, credits.aleo/credits) =
            credits.aleo/transfer_private(payment, winner, amount);

        let receipt_hash: field = BHP256::hash_to_field(ReceiptInput {
            rfq_id: rfq_id,
            payer:  self.caller,
            winner: winner,
            amount: amount,
            nonce:  receipt_nonce,
        });

        // [v16] Hiding+binding commitment for selective payment disclosure.
        let nonce_scalar: scalar = BHP256::hash_to_scalar(receipt_nonce);
        let amount_field: field = amount as field;
        let payment_commitment: field = BHP256::commit_to_field(amount_field, nonce_scalar);

        let receipt: InvoiceReceipt = InvoiceReceipt {
            owner:        self.caller,
            rfq_id:       rfq_id,
            receipt_hash: receipt_hash,
            amount:       amount,
        };

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 4u8,
            rfq_id:     rfq_id,
        });

        let f: Future = finalize_pay_invoice(
            rfq_id, winner, amount, receipt_hash, self.caller,
            nonce_key, invoice_nonce, payment_commitment
        );

        return (change, recv, receipt, f);
    }

    async function finalize_pay_invoice(
        rfq_id:        field,
        winner:        address,
        amount:        u64,
        receipt_hash:  field,
        caller:        address,
        nonce_key:     field,
        invoice_nonce: u64,
        payment_commitment: field
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(invoice_nonce, stored_nonce + 1u64);

        // [v15] Credits-only guard.
        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_CREDITS);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        let winner_key: field   = Mapping::get(winner_bids, rfq_id);
        let winning_amount: u64 = Mapping::get(revealed_bids, winner_key);
        assert_eq(amount, winning_amount);

        // [v12] Guard: escrow must still be fully intact.
        let escrow_remaining: u64 = Mapping::get_or_use(escrow_amounts, rfq_id, 0u64);
        assert(escrow_remaining > 0u64);

        // [v12] Guard: no partial payments must have been released.
        let released_so_far: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        assert_eq(released_so_far, 0u64);

        let already_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(already_paid, false);

        Mapping::set(receipts, rfq_id, receipt_hash);
        Mapping::set(paid,     rfq_id, true);
        let payment_key: field = BHP256::hash_to_field(V16ProofKey {
            rfq_id:    rfq_id,
            proof_tag: PROOF_TAG_PAYMENT,
        });
        Mapping::set(v16_proofs, payment_key, payment_commitment);
        Mapping::set(actor_nonces, nonce_key, invoice_nonce);
    }

    // [v15] release_winner_stake_cancelled (#24) removed — redundant with
    // refund_stake_cancelled (#13) which has no winner exclusion.

    // ═══════════════════════════════════════════════════════════════════════
    // 25. WINNER CLAIM ESCROW (merged)
    //
    // Merged from winner_claim_unpaid_escrow and winner_claim_partial_remainder.
    //
    //   mode == 0u8 → unpaid full-escrow claim (released_so_far == 0)
    //   mode == 1u8 → partial-path remainder claim (released_so_far > 0)
    // ═══════════════════════════════════════════════════════════════════════

    async transition winner_claim_escrow(
        public rfq_id:    field,
        public remaining: u64,
        public mode:      u8
    ) -> (WinnerEscrowClaimed, Future) {
        assert(remaining > 0u64);

        let claim_future: Future = credits.aleo/transfer_public(self.caller, remaining);

        let event: WinnerEscrowClaimed = WinnerEscrowClaimed {
            owner:  self.caller,
            rfq_id: rfq_id,
            amount: remaining,
        };

        let f: Future = finalize_winner_claim_escrow(
            rfq_id, self.caller, remaining, mode, claim_future
        );
        return (event, f);
    }

    async function finalize_winner_claim_escrow(
        rfq_id:       field,
        caller:       address,
        remaining:    u64,
        mode:         u8,
        claim_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        // [v15] Credits-only guard.
        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_CREDITS);

        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, false);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(caller, winner);

        let funded_block: u32 = Mapping::get(rfq_lifecycle_block, rfq_id);
        assert(block.height > funded_block + ESCROW_RECOVERY_BLOCKS);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        let released_so_far: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        let original: u64 = Mapping::get(escrow_original, rfq_id);

        let is_mode_unpaid: bool = mode == 0u8;
        if mode == 0u8 {
            // Unpaid full-escrow claim.
            assert_eq(released_so_far, 0u64);
        } else {
            // Partial-path remainder claim.
            assert_eq(mode, 1u8);
            assert(released_so_far > 0u64);
            assert(released_so_far < original);
        }
        let new_total_released: u64 = is_mode_unpaid ? remaining : (released_so_far + remaining);
        assert_eq(original, new_total_released);

        claim_future.await();

        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        Mapping::set(total_released,         rfq_id, new_total_released);
        Mapping::set(rfq_status,             rfq_id, STATUS_COMPLETED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //
    //  ██╗   ██╗███████╗██████╗  ██████╗██╗  ██╗     ██╗   ██╗███████╗ █████╗ ██████╗
    //  ██║   ██║██╔════╝██╔══██╗██╔════╝╚██╗██╔╝    ██║   ██║██╔════╝██╔══██╗██╔══██╗
    //  ██║   ██║███████╗██║  ██║██║      ╚███╔╝     ██║   ██║███████╗███████║██║  ██║
    //  ██║   ██║╚════██║██║  ██║██║      ██╔██╗     ██║   ██║╚════██║██╔══██║██║  ██║
    //  ╚██████╔╝███████║██████╔╝╚██████╗██╔╝ ██╗    ╚██████╔╝███████║██║  ██║██████╔╝
    //   ╚═════╝ ╚══════╝╚═════╝  ╚═════╝╚═╝  ╚═╝     ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝
    //
    //  STABLECOIN ESCROW TRANSITIONS  (v15)
    //
    //  Each stablecoin transition mirrors its credits counterpart exactly,
    //  calling the appropriate token program instead of credits.aleo.
    //  Amounts are stored as u64 in shared escrow mappings (sufficient for
    //  any real-world amount) and cast to u128 at external call boundaries.
    //
    //  Stakes remain Credits-denominated regardless of escrow token type.
    //
    // ═══════════════════════════════════════════════════════════════════════

    // ─────────────────────────────────────────────────────────────────────
    // 26. FUND ESCROW — USDCx
    // ─────────────────────────────────────────────────────────────────────

    async transition fund_escrow_usdcx(
        public rfq_id: field,
        public amount: u64
    ) -> (EscrowFunded, Future) {
        assert(amount > 0u64);
        assert(amount < MAX_BID_AMOUNT);

        let escrow_future: Future =
            test_usdcx_stablecoin.aleo/transfer_public_as_signer(
                self.address, amount as u128
            );

        let event: EscrowFunded = EscrowFunded {
            owner:  self.caller,
            rfq_id: rfq_id,
            amount: amount,
        };

        let f: Future = fin_fund_escrow_usdcx(
            rfq_id, amount, self.caller, escrow_future
        );
        return (event, f);
    }

    async function fin_fund_escrow_usdcx(
        rfq_id:        field,
        amount:        u64,
        caller:        address,
        escrow_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_WINNER_SELECTED);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USDCX);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let accepted: bool = Mapping::get_or_use(rfq_winner_accepted, rfq_id, false);
        assert_eq(accepted, true);

        let winner_key: field   = Mapping::get(winner_bids, rfq_id);
        let winning_amount: u64 = Mapping::get(revealed_bids, winner_key);
        assert_eq(amount, winning_amount);

        let winner_addr: address = Mapping::get(rfq_winner_address, rfq_id);
        assert(winner_addr != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);

        let existing: u64 = Mapping::get_or_use(escrow_amounts, rfq_id, 0u64);
        assert_eq(existing, 0u64);

        escrow_future.await();

        Mapping::set(escrow_original,         rfq_id, amount);
        Mapping::set(escrow_amounts,          rfq_id, amount);
        Mapping::set(total_released,          rfq_id, 0u64);
        Mapping::set(final_payment_released,  rfq_id, false);
        Mapping::set(rfq_lifecycle_block,    rfq_id, block.height);
        Mapping::set(rfq_status,              rfq_id, STATUS_ESCROW_FUNDED);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 27. FUND ESCROW — USAD
    // ─────────────────────────────────────────────────────────────────────

    async transition fund_escrow_usad(
        public rfq_id: field,
        public amount: u64
    ) -> (EscrowFunded, Future) {
        assert(amount > 0u64);
        assert(amount < MAX_BID_AMOUNT);

        let escrow_future: Future =
            test_usad_stablecoin.aleo/transfer_public_as_signer(
                self.address, amount as u128
            );

        let event: EscrowFunded = EscrowFunded {
            owner:  self.caller,
            rfq_id: rfq_id,
            amount: amount,
        };

        let f: Future = fin_fund_escrow_usad(
            rfq_id, amount, self.caller, escrow_future
        );
        return (event, f);
    }

    async function fin_fund_escrow_usad(
        rfq_id:        field,
        amount:        u64,
        caller:        address,
        escrow_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_WINNER_SELECTED);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USAD);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let accepted: bool = Mapping::get_or_use(rfq_winner_accepted, rfq_id, false);
        assert_eq(accepted, true);

        let winner_key: field   = Mapping::get(winner_bids, rfq_id);
        let winning_amount: u64 = Mapping::get(revealed_bids, winner_key);
        assert_eq(amount, winning_amount);

        let winner_addr: address = Mapping::get(rfq_winner_address, rfq_id);
        assert(winner_addr != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);

        let existing: u64 = Mapping::get_or_use(escrow_amounts, rfq_id, 0u64);
        assert_eq(existing, 0u64);

        escrow_future.await();

        Mapping::set(escrow_original,         rfq_id, amount);
        Mapping::set(escrow_amounts,          rfq_id, amount);
        Mapping::set(total_released,          rfq_id, 0u64);
        Mapping::set(final_payment_released,  rfq_id, false);
        Mapping::set(rfq_lifecycle_block,    rfq_id, block.height);
        Mapping::set(rfq_status,              rfq_id, STATUS_ESCROW_FUNDED);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 28. RELEASE PARTIAL PAYMENT — USDCx  (Path A)
    // ─────────────────────────────────────────────────────────────────────

    async transition release_partial_usdcx(
        public rfq_id:             field,
        public winner:             address,
        public release_amount:     u64,
        public percentage:         u8,
        public new_total_released: u64,
        public fee_bps:            u64,
        public user_nonce:         u64
    ) -> (PartialPaymentReleased, Future) {
        assert(percentage         > 0u8);
        assert(percentage         <= 100u8);
        assert(release_amount     > 0u64);
        assert(new_total_released > 0u64);
        assert(fee_bps < FEE_DENOMINATOR);

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 9u8,   // [v15] USDCx partial (unique; final uses 5u8)
            rfq_id:     rfq_id,
        });

        // [v16] USDCx partial release is net-of-fee.
        let fee_amount: u64 = (release_amount * fee_bps) / FEE_DENOMINATOR;
        let payout_amount: u64 = release_amount - fee_amount;
        assert(payout_amount > 0u64);
        let payment_future: Future =
            test_usdcx_stablecoin.aleo/transfer_public(
                winner, payout_amount as u128
            );

        let event: PartialPaymentReleased = PartialPaymentReleased {
            owner:          self.caller,
            rfq_id:         rfq_id,
            release_amount: release_amount,
            total_released: new_total_released,
            percentage:     percentage,
        };

        let f: Future = fin_release_partial_usdcx(
            rfq_id, percentage, self.caller, nonce_key, user_nonce,
            winner, release_amount, fee_bps, fee_amount, payout_amount,
            new_total_released, payment_future
        );
        return (event, f);
    }

    async function fin_release_partial_usdcx(
        rfq_id:             field,
        percentage:         u8,
        caller:             address,
        nonce_key:          field,
        user_nonce:         u64,
        winner:             address,
        release_amount:     u64,
        fee_bps:            u64,
        fee_amount:         u64,
        payout_amount:      u64,
        new_total_released: u64,
        payment_future:     Future
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USDCX);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, false);

        // [v16] Verify caller-supplied fee inputs against platform config.
        let cfg: PlatformConfig = Mapping::get_or_use(platform_config, 0u8, PlatformConfig {
            admin_hash:       0field,
            fee_bps:          0u64,
            paused:           false,
            treasury_credits: 0u64,
            treasury_usdcx:   0u64,
            treasury_usad:    0u64,
        });
        assert(cfg.admin_hash != 0field);
        assert_eq(fee_bps, cfg.fee_bps);
        let expected_fee_amount: u64 = (release_amount * fee_bps) / FEE_DENOMINATOR;
        assert_eq(fee_amount, expected_fee_amount);
        let expected_payout_amount: u64 = release_amount - fee_amount;
        assert_eq(payout_amount, expected_payout_amount);
        assert(payout_amount > 0u64);

        let remaining: u64        = Mapping::get(escrow_amounts, rfq_id);
        let already_released: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        let original: u64         = Mapping::get(escrow_original, rfq_id);

        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        let expected_release_amount: u64 = (remaining * (percentage as u64)) / 100u64;
        assert_eq(release_amount, expected_release_amount);
        assert(release_amount > 0u64);
        assert(release_amount <= remaining);

        let computed_min:  u64 = (original * (MIN_PARTIAL_RELEASE_PCT as u64)) / 100u64;
        let effective_min: u64 = computed_min > 0u64 ? computed_min : 1u64;
        assert(release_amount >= effective_min);

        assert_eq(new_total_released, already_released + release_amount);
        assert(new_total_released <= original);

        payment_future.await();

        let new_remaining: u64 = remaining - release_amount;
        Mapping::set(total_released, rfq_id, new_total_released);
        Mapping::set(escrow_amounts, rfq_id, new_remaining);
        Mapping::set(platform_config, 0u8, PlatformConfig {
            admin_hash:       cfg.admin_hash,
            fee_bps:          cfg.fee_bps,
            paused:           cfg.paused,
            treasury_credits: cfg.treasury_credits,
            treasury_usdcx:   cfg.treasury_usdcx + fee_amount,
            treasury_usad:    cfg.treasury_usad,
        });
        Mapping::set(actor_nonces,   nonce_key, user_nonce);

        let is_complete: bool = new_remaining == 0u64;
        let next_status: u8   = is_complete ? STATUS_COMPLETED : STATUS_ESCROW_FUNDED;
        Mapping::set(rfq_status, rfq_id, next_status);
        let mark_final: bool = is_complete ? true : false;
        Mapping::set(final_payment_released, rfq_id, mark_final);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 29. RELEASE PARTIAL PAYMENT — USAD  (Path A)
    // ─────────────────────────────────────────────────────────────────────

    async transition release_partial_usad(
        public rfq_id:             field,
        public winner:             address,
        public release_amount:     u64,
        public percentage:         u8,
        public new_total_released: u64,
        public fee_bps:            u64,
        public user_nonce:         u64
    ) -> (PartialPaymentReleased, Future) {
        assert(percentage         > 0u8);
        assert(percentage         <= 100u8);
        assert(release_amount     > 0u64);
        assert(new_total_released > 0u64);
        assert_eq(fee_bps, 0u64);

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 10u8,  // [v15] USAD partial (unique; final uses 7u8)
            rfq_id:     rfq_id,
        });

        // [v16] USAD fee disabled (0 bps) to avoid locked treasury accumulation.
        let fee_amount: u64 = 0u64;
        let payout_amount: u64 = release_amount;
        assert(payout_amount > 0u64);
        let payment_future: Future =
            test_usad_stablecoin.aleo/transfer_public(
                winner, payout_amount as u128
            );

        let event: PartialPaymentReleased = PartialPaymentReleased {
            owner:          self.caller,
            rfq_id:         rfq_id,
            release_amount: release_amount,
            total_released: new_total_released,
            percentage:     percentage,
        };

        let f: Future = fin_release_partial_usad(
            rfq_id, percentage, self.caller, nonce_key, user_nonce,
            winner, release_amount, fee_bps, fee_amount, payout_amount,
            new_total_released, payment_future
        );
        return (event, f);
    }

    async function fin_release_partial_usad(
        rfq_id:             field,
        percentage:         u8,
        caller:             address,
        nonce_key:          field,
        user_nonce:         u64,
        winner:             address,
        release_amount:     u64,
        fee_bps:            u64,
        fee_amount:         u64,
        payout_amount:      u64,
        new_total_released: u64,
        payment_future:     Future
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USAD);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, false);

        // [v16] Verify caller-supplied fee inputs against platform config.
        let cfg: PlatformConfig = Mapping::get_or_use(platform_config, 0u8, PlatformConfig {
            admin_hash:       0field,
            fee_bps:          0u64,
            paused:           false,
            treasury_credits: 0u64,
            treasury_usdcx:   0u64,
            treasury_usad:    0u64,
        });
        assert(cfg.admin_hash != 0field);
        assert_eq(fee_bps, 0u64);
        let expected_fee_amount: u64 = 0u64;
        assert_eq(fee_amount, expected_fee_amount);
        let expected_payout_amount: u64 = release_amount;
        assert_eq(payout_amount, expected_payout_amount);
        assert(payout_amount > 0u64);

        let remaining: u64        = Mapping::get(escrow_amounts, rfq_id);
        let already_released: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        let original: u64         = Mapping::get(escrow_original, rfq_id);

        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        let expected_release_amount: u64 = (remaining * (percentage as u64)) / 100u64;
        assert_eq(release_amount, expected_release_amount);
        assert(release_amount > 0u64);
        assert(release_amount <= remaining);

        let computed_min:  u64 = (original * (MIN_PARTIAL_RELEASE_PCT as u64)) / 100u64;
        let effective_min: u64 = computed_min > 0u64 ? computed_min : 1u64;
        assert(release_amount >= effective_min);

        assert_eq(new_total_released, already_released + release_amount);
        assert(new_total_released <= original);

        payment_future.await();

        let new_remaining: u64 = remaining - release_amount;
        Mapping::set(total_released, rfq_id, new_total_released);
        Mapping::set(escrow_amounts, rfq_id, new_remaining);
        Mapping::set(platform_config, 0u8, PlatformConfig {
            admin_hash:       cfg.admin_hash,
            fee_bps:          cfg.fee_bps,
            paused:           cfg.paused,
            treasury_credits: cfg.treasury_credits,
            treasury_usdcx:   cfg.treasury_usdcx,
            treasury_usad:    cfg.treasury_usad,
        });
        Mapping::set(actor_nonces,   nonce_key, user_nonce);

        let is_complete: bool = new_remaining == 0u64;
        let next_status: u8   = is_complete ? STATUS_COMPLETED : STATUS_ESCROW_FUNDED;
        Mapping::set(rfq_status, rfq_id, next_status);
        let mark_final: bool = is_complete ? true : false;
        Mapping::set(final_payment_released, rfq_id, mark_final);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 30. RELEASE FINAL PAYMENT — USDCx  (Path B bond recovery)
    // ─────────────────────────────────────────────────────────────────────

    async transition release_final_usdcx(
        public rfq_id:     field,
        public winner:     address,
        public remaining:  u64,
        public fee_bps:    u64,
        public user_nonce: u64
    ) -> (FinalPaymentReleased, Future) {
        assert(remaining > 0u64);
        assert(fee_bps < FEE_DENOMINATOR);

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 5u8,   // [v15] USDCx final (partial uses 9u8)
            rfq_id:     rfq_id,
        });

        // [v16] USDCx final release is net-of-fee.
        let fee_amount: u64 = (remaining * fee_bps) / FEE_DENOMINATOR;
        let payout_amount: u64 = remaining - fee_amount;
        assert(payout_amount > 0u64);
        let payment_future: Future =
            test_usdcx_stablecoin.aleo/transfer_public(
                self.caller, payout_amount as u128
            );

        let event: FinalPaymentReleased = FinalPaymentReleased {
            owner:          self.caller,
            rfq_id:         rfq_id,
            release_amount: remaining,
        };

        let f: Future = fin_release_final_usdcx(
            rfq_id, self.caller, nonce_key, user_nonce, winner,
            remaining, fee_bps, fee_amount, payout_amount, payment_future
        );
        return (event, f);
    }

    async function fin_release_final_usdcx(
        rfq_id:         field,
        caller:         address,
        nonce_key:      field,
        user_nonce:     u64,
        winner:         address,
        remaining:      u64,
        fee_bps:        u64,
        fee_amount:     u64,
        payout_amount:  u64,
        payment_future: Future
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USDCX);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, true);

        let stored_receipt: field = Mapping::get_or_use(receipts, rfq_id, 0field);
        assert(stored_receipt != 0field);

        // [v16] Verify caller-supplied fee inputs against platform config.
        let cfg: PlatformConfig = Mapping::get_or_use(platform_config, 0u8, PlatformConfig {
            admin_hash:       0field,
            fee_bps:          0u64,
            paused:           false,
            treasury_credits: 0u64,
            treasury_usdcx:   0u64,
            treasury_usad:    0u64,
        });
        assert(cfg.admin_hash != 0field);
        assert_eq(fee_bps, cfg.fee_bps);
        let expected_fee_amount: u64 = (remaining * fee_bps) / FEE_DENOMINATOR;
        assert_eq(fee_amount, expected_fee_amount);
        let expected_payout_amount: u64 = remaining - fee_amount;
        assert_eq(payout_amount, expected_payout_amount);
        assert(payout_amount > 0u64);

        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        let already_released: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        let original: u64 = Mapping::get(escrow_original, rfq_id);

        payment_future.await();

        let new_total_released: u64 = already_released + remaining;

        // [SECURITY FIX M-1] Global accounting invariant.
        assert_eq(original, new_total_released);

        Mapping::set(total_released,         rfq_id, new_total_released);
        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        Mapping::set(rfq_status,             rfq_id, STATUS_COMPLETED);
        Mapping::set(platform_config, 0u8, PlatformConfig {
            admin_hash:       cfg.admin_hash,
            fee_bps:          cfg.fee_bps,
            paused:           cfg.paused,
            treasury_credits: cfg.treasury_credits,
            treasury_usdcx:   cfg.treasury_usdcx + fee_amount,
            treasury_usad:    cfg.treasury_usad,
        });
        Mapping::set(actor_nonces,           nonce_key, user_nonce);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 31. RELEASE FINAL PAYMENT — USAD  (Path B bond recovery)
    // ─────────────────────────────────────────────────────────────────────

    async transition release_final_usad(
        public rfq_id:     field,
        public winner:     address,
        public remaining:  u64,
        public fee_bps:    u64,
        public user_nonce: u64
    ) -> (FinalPaymentReleased, Future) {
        assert(remaining > 0u64);
        assert_eq(fee_bps, 0u64);

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 7u8,   // [v15] USAD final (partial uses 10u8)
            rfq_id:     rfq_id,
        });

        // [v16] USAD fee disabled (0 bps) to avoid locked treasury accumulation.
        let fee_amount: u64 = 0u64;
        let payout_amount: u64 = remaining;
        assert(payout_amount > 0u64);
        let payment_future: Future =
            test_usad_stablecoin.aleo/transfer_public(
                self.caller, payout_amount as u128
            );

        let event: FinalPaymentReleased = FinalPaymentReleased {
            owner:          self.caller,
            rfq_id:         rfq_id,
            release_amount: remaining,
        };

        let f: Future = fin_release_final_usad(
            rfq_id, self.caller, nonce_key, user_nonce, winner,
            remaining, fee_bps, fee_amount, payout_amount, payment_future
        );
        return (event, f);
    }

    async function fin_release_final_usad(
        rfq_id:         field,
        caller:         address,
        nonce_key:      field,
        user_nonce:     u64,
        winner:         address,
        remaining:      u64,
        fee_bps:        u64,
        fee_amount:     u64,
        payout_amount:  u64,
        payment_future: Future
    ) {
        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(user_nonce, stored_nonce + 1u64);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USAD);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, true);

        let stored_receipt: field = Mapping::get_or_use(receipts, rfq_id, 0field);
        assert(stored_receipt != 0field);

        // [v16] Verify caller-supplied fee inputs against platform config.
        let cfg: PlatformConfig = Mapping::get_or_use(platform_config, 0u8, PlatformConfig {
            admin_hash:       0field,
            fee_bps:          0u64,
            paused:           false,
            treasury_credits: 0u64,
            treasury_usdcx:   0u64,
            treasury_usad:    0u64,
        });
        assert(cfg.admin_hash != 0field);
        assert_eq(fee_bps, 0u64);
        let expected_fee_amount: u64 = 0u64;
        assert_eq(fee_amount, expected_fee_amount);
        let expected_payout_amount: u64 = remaining;
        assert_eq(payout_amount, expected_payout_amount);
        assert(payout_amount > 0u64);

        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        let already_released: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        let original: u64 = Mapping::get(escrow_original, rfq_id);

        payment_future.await();

        let new_total_released: u64 = already_released + remaining;

        // [SECURITY FIX M-1] Global accounting invariant.
        assert_eq(original, new_total_released);

        Mapping::set(total_released,         rfq_id, new_total_released);
        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        Mapping::set(rfq_status,             rfq_id, STATUS_COMPLETED);
        Mapping::set(platform_config, 0u8, PlatformConfig {
            admin_hash:       cfg.admin_hash,
            fee_bps:          cfg.fee_bps,
            paused:           cfg.paused,
            treasury_credits: cfg.treasury_credits,
            treasury_usdcx:   cfg.treasury_usdcx,
            treasury_usad:    cfg.treasury_usad,
        });
        Mapping::set(actor_nonces,           nonce_key, user_nonce);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 32. PAY INVOICE — USDCx  (Path B — private stablecoin payment)
    //
    // Creator privately transfers USDCx to winner via transfer_private.
    // Requires the caller's Token record and MerkleProof compliance data.
    // ─────────────────────────────────────────────────────────────────────

    async transition pay_invoice_usdcx(
        public rfq_id:        field,
        public winner:        address,
        public amount:        u64,
        public invoice_nonce: u64,
               receipt_nonce: field,
               payment:       test_usdcx_stablecoin.aleo/Token,
               proofs:        [test_usdcx_stablecoin.aleo/MerkleProof; 2]
    ) -> (test_usdcx_stablecoin.aleo/ComplianceRecord,
          test_usdcx_stablecoin.aleo/Token,
          test_usdcx_stablecoin.aleo/Token,
          InvoiceReceipt, Future) {
        assert(rfq_id        != 0field);
        assert(amount         > 0u64);
        assert(amount         < MAX_BID_AMOUNT);
        assert(winner        != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
        assert(receipt_nonce != 0field);

        let (compliance, recv, change, transfer_future):
            (test_usdcx_stablecoin.aleo/ComplianceRecord,
             test_usdcx_stablecoin.aleo/Token,
             test_usdcx_stablecoin.aleo/Token,
             Future) =
            test_usdcx_stablecoin.aleo/transfer_private(
                winner, amount as u128, payment, proofs
            );

        let receipt_hash: field = BHP256::hash_to_field(ReceiptInput {
            rfq_id: rfq_id,
            payer:  self.caller,
            winner: winner,
            amount: amount,
            nonce:  receipt_nonce,
        });

        // [v16] Hiding+binding commitment for selective payment disclosure.
        let nonce_scalar: scalar = BHP256::hash_to_scalar(receipt_nonce);
        let amount_field: field = amount as field;
        let payment_commitment: field = BHP256::commit_to_field(amount_field, nonce_scalar);

        let receipt: InvoiceReceipt = InvoiceReceipt {
            owner:        self.caller,
            rfq_id:       rfq_id,
            receipt_hash: receipt_hash,
            amount:       amount,
        };

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 6u8,   // [v15] USDCx invoice
            rfq_id:     rfq_id,
        });

        let f: Future = fin_pay_invoice_usdcx(
            rfq_id, winner, amount, receipt_hash, self.caller,
            nonce_key, invoice_nonce, payment_commitment, transfer_future
        );

        return (compliance, recv, change, receipt, f);
    }

    async function fin_pay_invoice_usdcx(
        rfq_id:        field,
        winner:        address,
        amount:        u64,
        receipt_hash:  field,
        caller:        address,
        nonce_key:     field,
        invoice_nonce: u64,
        payment_commitment: field,
        transfer_future: Future
    ) {
        transfer_future.await();

        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(invoice_nonce, stored_nonce + 1u64);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USDCX);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        let winner_key: field   = Mapping::get(winner_bids, rfq_id);
        let winning_amount: u64 = Mapping::get(revealed_bids, winner_key);
        assert_eq(amount, winning_amount);

        let escrow_remaining: u64 = Mapping::get_or_use(escrow_amounts, rfq_id, 0u64);
        assert(escrow_remaining > 0u64);

        let released_so_far: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        assert_eq(released_so_far, 0u64);

        let already_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(already_paid, false);

        Mapping::set(receipts,     rfq_id, receipt_hash);
        Mapping::set(paid,         rfq_id, true);
        let payment_key: field = BHP256::hash_to_field(V16ProofKey {
            rfq_id:    rfq_id,
            proof_tag: PROOF_TAG_PAYMENT,
        });
        Mapping::set(v16_proofs, payment_key, payment_commitment);
        Mapping::set(actor_nonces, nonce_key, invoice_nonce);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 33. PAY INVOICE — USAD  (Path B — private stablecoin payment)
    // ─────────────────────────────────────────────────────────────────────

    async transition pay_invoice_usad(
        public rfq_id:        field,
        public winner:        address,
        public amount:        u64,
        public invoice_nonce: u64,
               receipt_nonce: field,
               payment:       test_usad_stablecoin.aleo/Token,
               proofs:        [test_usad_stablecoin.aleo/MerkleProof; 2]
    ) -> (test_usad_stablecoin.aleo/ComplianceRecord,
          test_usad_stablecoin.aleo/Token,
          test_usad_stablecoin.aleo/Token,
          InvoiceReceipt, Future) {
        assert(rfq_id        != 0field);
        assert(amount         > 0u64);
        assert(amount         < MAX_BID_AMOUNT);
        assert(winner        != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
        assert(receipt_nonce != 0field);

        let (compliance, recv, change, transfer_future):
            (test_usad_stablecoin.aleo/ComplianceRecord,
             test_usad_stablecoin.aleo/Token,
             test_usad_stablecoin.aleo/Token,
             Future) =
            test_usad_stablecoin.aleo/transfer_private(
                winner, amount as u128, payment, proofs
            );

        let receipt_hash: field = BHP256::hash_to_field(ReceiptInput {
            rfq_id: rfq_id,
            payer:  self.caller,
            winner: winner,
            amount: amount,
            nonce:  receipt_nonce,
        });

        // [v16] Hiding+binding commitment for selective payment disclosure.
        let nonce_scalar: scalar = BHP256::hash_to_scalar(receipt_nonce);
        let amount_field: field = amount as field;
        let payment_commitment: field = BHP256::commit_to_field(amount_field, nonce_scalar);

        let receipt: InvoiceReceipt = InvoiceReceipt {
            owner:        self.caller,
            rfq_id:       rfq_id,
            receipt_hash: receipt_hash,
            amount:       amount,
        };

        let nonce_key: field = BHP256::hash_to_field(NonceKey {
            actor:      self.caller,
            action_tag: 8u8,   // [v15] USAD invoice
            rfq_id:     rfq_id,
        });

        let f: Future = fin_pay_invoice_usad(
            rfq_id, winner, amount, receipt_hash, self.caller,
            nonce_key, invoice_nonce, payment_commitment, transfer_future
        );

        return (compliance, recv, change, receipt, f);
    }

    async function fin_pay_invoice_usad(
        rfq_id:        field,
        winner:        address,
        amount:        u64,
        receipt_hash:  field,
        caller:        address,
        nonce_key:     field,
        invoice_nonce: u64,
        payment_commitment: field,
        transfer_future: Future
    ) {
        transfer_future.await();

        let stored_nonce: u64 = Mapping::get_or_use(actor_nonces, nonce_key, 0u64);
        assert_eq(invoice_nonce, stored_nonce + 1u64);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USAD);

        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let expected_winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(winner, expected_winner);

        let winner_key: field   = Mapping::get(winner_bids, rfq_id);
        let winning_amount: u64 = Mapping::get(revealed_bids, winner_key);
        assert_eq(amount, winning_amount);

        let escrow_remaining: u64 = Mapping::get_or_use(escrow_amounts, rfq_id, 0u64);
        assert(escrow_remaining > 0u64);

        let released_so_far: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        assert_eq(released_so_far, 0u64);

        let already_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(already_paid, false);

        Mapping::set(receipts,     rfq_id, receipt_hash);
        Mapping::set(paid,         rfq_id, true);
        let payment_key: field = BHP256::hash_to_field(V16ProofKey {
            rfq_id:    rfq_id,
            proof_tag: PROOF_TAG_PAYMENT,
        });
        Mapping::set(v16_proofs, payment_key, payment_commitment);
        Mapping::set(actor_nonces, nonce_key, invoice_nonce);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 34. CREATOR RECLAIM ESCROW — USDCx
    //
    // Mirrors creator_reclaim_escrow (#22) for USDCx-funded RFQs.
    // Fixes the fund-lock bug: without this, a USDCx escrow whose creator
    // ghosts is permanently locked (the Credits path asserts TOKEN_CREDITS).
    // ═══════════════════════════════════════════════════════════════════════

    async transition creator_reclaim_escrow_usdcx(
        public rfq_id:    field,
        public remaining: u64
    ) -> (EscrowReclaimed, Future) {
        assert(remaining > 0u64);

        let reclaim_future: Future =
            test_usdcx_stablecoin.aleo/transfer_public(
                self.caller, remaining as u128
            );

        let event: EscrowReclaimed = EscrowReclaimed {
            owner:   self.caller,
            rfq_id:  rfq_id,
            creator: self.caller,
            amount:  remaining,
        };

        let f: Future = fin_reclaim_escrow_usdcx(
            rfq_id, self.caller, remaining, reclaim_future
        );
        return (event, f);
    }

    async function fin_reclaim_escrow_usdcx(
        rfq_id:         field,
        caller:         address,
        remaining:      u64,
        reclaim_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USDCX);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let funded_block: u32 = Mapping::get(rfq_lifecycle_block, rfq_id);
        assert(block.height > funded_block + ESCROW_RECOVERY_BLOCKS);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, false);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        Mapping::set(rfq_status,             rfq_id, STATUS_CANCELLED);

        reclaim_future.await();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 35. CREATOR RECLAIM ESCROW — USAD
    //
    // Mirrors creator_reclaim_escrow (#22) for USAD-funded RFQs.
    // ═══════════════════════════════════════════════════════════════════════

    async transition creator_reclaim_escrow_usad(
        public rfq_id:    field,
        public remaining: u64
    ) -> (EscrowReclaimed, Future) {
        assert(remaining > 0u64);

        let reclaim_future: Future =
            test_usad_stablecoin.aleo/transfer_public(
                self.caller, remaining as u128
            );

        let event: EscrowReclaimed = EscrowReclaimed {
            owner:   self.caller,
            rfq_id:  rfq_id,
            creator: self.caller,
            amount:  remaining,
        };

        let f: Future = fin_reclaim_escrow_usad(
            rfq_id, self.caller, remaining, reclaim_future
        );
        return (event, f);
    }

    async function fin_reclaim_escrow_usad(
        rfq_id:         field,
        caller:         address,
        remaining:      u64,
        reclaim_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USAD);

        let creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, creator);

        let funded_block: u32 = Mapping::get(rfq_lifecycle_block, rfq_id);
        assert(block.height > funded_block + ESCROW_RECOVERY_BLOCKS);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, false);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        Mapping::set(rfq_status,             rfq_id, STATUS_CANCELLED);

        reclaim_future.await();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 36. WINNER CLAIM USDCx (merged)
    //
    // Merged from winner_claim_unpaid_usdcx and claim_remainder_usdcx.
    //
    //   mode == 0u8 → unpaid full-escrow claim (released_so_far == 0)
    //   mode == 1u8 → partial-path remainder claim (released_so_far > 0)
    // ═══════════════════════════════════════════════════════════════════════

    async transition winner_claim_usdcx(
        public rfq_id:    field,
        public remaining: u64,
        public mode:      u8
    ) -> (WinnerEscrowClaimed, Future) {
        assert(remaining > 0u64);

        let claim_future: Future =
            test_usdcx_stablecoin.aleo/transfer_public(
                self.caller, remaining as u128
            );

        let event: WinnerEscrowClaimed = WinnerEscrowClaimed {
            owner:  self.caller,
            rfq_id: rfq_id,
            amount: remaining,
        };

        let f: Future = fin_winner_claim_usdcx(
            rfq_id, self.caller, remaining, mode, claim_future
        );
        return (event, f);
    }

    async function fin_winner_claim_usdcx(
        rfq_id:       field,
        caller:       address,
        remaining:    u64,
        mode:         u8,
        claim_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USDCX);

        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, false);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(caller, winner);

        let funded_block: u32 = Mapping::get(rfq_lifecycle_block, rfq_id);
        assert(block.height > funded_block + ESCROW_RECOVERY_BLOCKS);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        let released_so_far: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        let original: u64 = Mapping::get(escrow_original, rfq_id);

        let is_mode_unpaid: bool = mode == 0u8;
        if mode == 0u8 {
            assert_eq(released_so_far, 0u64);
        } else {
            assert_eq(mode, 1u8);
            assert(released_so_far > 0u64);
            assert(released_so_far < original);
        }
        let new_total_released: u64 = is_mode_unpaid ? remaining : (released_so_far + remaining);
        assert_eq(original, new_total_released);

        claim_future.await();

        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        Mapping::set(total_released,         rfq_id, new_total_released);
        Mapping::set(rfq_status,             rfq_id, STATUS_COMPLETED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 37. WINNER CLAIM USAD (merged)
    //
    // Merged from winner_claim_unpaid_usad and claim_remainder_usad.
    //
    //   mode == 0u8 → unpaid full-escrow claim (released_so_far == 0)
    //   mode == 1u8 → partial-path remainder claim (released_so_far > 0)
    // ═══════════════════════════════════════════════════════════════════════

    async transition winner_claim_usad(
        public rfq_id:    field,
        public remaining: u64,
        public mode:      u8
    ) -> (WinnerEscrowClaimed, Future) {
        assert(remaining > 0u64);

        let claim_future: Future =
            test_usad_stablecoin.aleo/transfer_public(
                self.caller, remaining as u128
            );

        let event: WinnerEscrowClaimed = WinnerEscrowClaimed {
            owner:  self.caller,
            rfq_id: rfq_id,
            amount: remaining,
        };

        let f: Future = fin_winner_claim_usad(
            rfq_id, self.caller, remaining, mode, claim_future
        );
        return (event, f);
    }

    async function fin_winner_claim_usad(
        rfq_id:       field,
        caller:       address,
        remaining:    u64,
        mode:         u8,
        claim_future: Future
    ) {
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_ESCROW_FUNDED);

        let token: u8 = Mapping::get(escrow_token, rfq_id);
        assert_eq(token, TOKEN_USAD);

        let is_paid: bool = Mapping::get_or_use(paid, rfq_id, false);
        assert_eq(is_paid, false);

        let already_finalized: bool = Mapping::get_or_use(final_payment_released, rfq_id, false);
        assert_eq(already_finalized, false);

        let winner: address = Mapping::get(rfq_winner_address, rfq_id);
        assert_eq(caller, winner);

        let funded_block: u32 = Mapping::get(rfq_lifecycle_block, rfq_id);
        assert(block.height > funded_block + ESCROW_RECOVERY_BLOCKS);

        let expected_remaining: u64 = Mapping::get(escrow_amounts, rfq_id);
        assert_eq(remaining, expected_remaining);
        assert(remaining > 0u64);

        let released_so_far: u64 = Mapping::get_or_use(total_released, rfq_id, 0u64);
        let original: u64 = Mapping::get(escrow_original, rfq_id);

        let is_mode_unpaid: bool = mode == 0u8;
        if mode == 0u8 {
            assert_eq(released_so_far, 0u64);
        } else {
            assert_eq(mode, 1u8);
            assert(released_so_far > 0u64);
            assert(released_so_far < original);
        }
        let new_total_released: u64 = is_mode_unpaid ? remaining : (released_so_far + remaining);
        assert_eq(original, new_total_released);

        claim_future.await();

        Mapping::set(escrow_amounts,         rfq_id, 0u64);
        Mapping::set(final_payment_released, rfq_id, true);
        Mapping::set(total_released,         rfq_id, new_total_released);
        Mapping::set(rfq_status,             rfq_id, STATUS_COMPLETED);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // IMPORT AUCTION RESULT
    //
    // Bridge from external auction modules (sealvickrey / sealdutch) into
    // the RFQ settlement pipeline.  The creator calls this after the
    // auction contract has finalized, passing the winner and price.
    // The RFQ must have been created with pricing_mode != MODE_RFQ.
    // After import, the normal settlement flow continues (winner_respond,
    // fund_escrow, release/pay, etc.).
    //
    // Trust model: Aleo programs cannot read each other's mappings, so
    // winner/price are supplied by the creator. However:
    //   1. Both auction programs store results in public mappings
    //      (auction_final_winner, auction_final_price) — anyone can verify.
    //   2. The auction_id is encoded into the synthetic bid key on-chain,
    //      creating a verifiable link between RFQ and auction.
    //   3. Creator auth + single-import guard prevent manipulation.
    //   4. Pricing mode must match auction type (MODE_VICKREY/MODE_DUTCH).
    // ═══════════════════════════════════════════════════════════════════════

    async transition import_auction_result(
        public rfq_id:         field,
        public auction_id:     field,
        public winner_address: address,
        public price:          u64,
        public auction_type:   u8
    ) -> (AuctionImported, Future) {
        assert(rfq_id     != 0field);
        assert(auction_id != 0field);
        assert(price       > 0u64);
        assert(winner_address != aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
        assert(auction_type == MODE_VICKREY || auction_type == MODE_DUTCH);

        let event: AuctionImported = AuctionImported {
            owner:        self.caller,
            rfq_id:       rfq_id,
            winner:       winner_address,
            price:        price,
            auction_type: auction_type,
        };

        let f: Future = finalize_import_auction_result(
            rfq_id, auction_id, winner_address, price, auction_type, self.caller
        );
        return (event, f);
    }

    async function finalize_import_auction_result(
        rfq_id:         field,
        auction_id:     field,
        winner_address: address,
        price:          u64,
        auction_type:   u8,
        caller:         address
    ) {
        // Only the creator can import auction results.
        let actual_creator: address = Mapping::get(rfq_creators, rfq_id);
        assert_eq(caller, actual_creator);

        // RFQ must be in OPEN status (auction replaces the bid/reveal flow).
        let status: u8 = Mapping::get(rfq_status, rfq_id);
        assert_eq(status, STATUS_OPEN);

        // [SECURITY FIX M-3] Reject import if RFQ-mode bids already exist.
        // Mixing auction results with direct bids would corrupt state.
        let bid_count: u64 = Mapping::get_or_use(rfq_bid_count, rfq_id, 0u64);
        assert_eq(bid_count, 0u64);

        // Verify pricing mode matches the auction type.
        let mode: u8 = Mapping::get(rfq_mode, rfq_id);
        assert_eq(mode, auction_type);
        assert(mode != MODE_RFQ);

        // [SECURITY FIX] Double-import guard — auction_source must be 0field.
        // Prevents replay / override of a previously imported result.
        let already_imported: field = Mapping::get_or_use(auction_source, rfq_id, 0field);
        assert_eq(already_imported, 0field);

        // Ensure no winner has been selected yet (belt-and-suspenders with auction_source).
        let existing_winner: address = Mapping::get_or_use(
            rfq_winner_address, rfq_id,
            aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc
        );
        assert_eq(existing_winner, aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);

        // [SECURITY FIX] Staleness check — import must happen before the
        // RFQ's reveal deadline to prevent importing outdated results.
        let reveal_deadline: u32 = Mapping::get(rfq_reveal_deadlines, rfq_id);
        assert(block.height <= reveal_deadline);

        // Synthetic bid key encodes BOTH rfq_id and auction_id
        // for verifiable on-chain cross-reference.
        let synthetic_bid_key: field = BHP256::hash_to_field(BidKey {
            rfq_id: rfq_id,
            bid_id: auction_id,
        });

        // [CRITICAL FIX] Record auction↔RFQ binding hash for traceability + auditability.
        // Anyone can verify: hash(auction_id, rfq_id, winner, price) == auction_source[rfq_id].
        // Including rfq_id prevents the same auction result from being reused across RFQs —
        // a different rfq_id produces a different hash, making cross-RFQ replay detectable.
        let result_hash: field = BHP256::hash_to_field(ResultHashInput {
            auction_id: auction_id,
            rfq_id:     rfq_id,
            winner:     winner_address,
            price:      price,
        });
        Mapping::set(auction_source, rfq_id, result_hash);

        // Set winner state — same mappings as select_winner.
        Mapping::set(winner_bids,               rfq_id, synthetic_bid_key);
        Mapping::set(rfq_winner_address,        rfq_id, winner_address);
        Mapping::set(rfq_status,                rfq_id, STATUS_WINNER_SELECTED);
        Mapping::set(rfq_lifecycle_block,       rfq_id, block.height);
        Mapping::set(rfq_winner_accepted,       rfq_id, false);

        // Store the auction-determined price as the revealed bid amount
        // so fund_escrow and payment transitions can read it.
        Mapping::set(revealed_bids, synthetic_bid_key, price);
        Mapping::set(bid_owner,     synthetic_bid_key, winner_address);
    }

    

    

    

}
