import credits.aleo;
import test_usdcx_multisig_core.aleo;
import test_usdcx_freezelist.aleo;
import test_usdcx_stablecoin.aleo;
import test_usad_multisig_core.aleo;
import test_usad_freezelist.aleo;
import test_usad_stablecoin.aleo;

program sealvickrey_v9.aleo {

    struct AuctionIdInput {
        creator: address,
        salt: field,
    }

    struct BidKey {
        auction_id: field,
        bid_id: field,
    }

    struct VendorAuctionKey {
        vendor: address,
        auction_id: field,
    }

    struct CommitmentInput {
        auction_id: field,
        bidder: address,
        amount: u64,
        salt: field,
    }

    record AuctionCreated {
        owner: address,
        auction_id: field,
        creator: address,
        rfq_id: field,
        bidding_deadline: u32,
        reveal_deadline: u32,
        flat_stake: u64,
        token_type: u8,
    }

    record BidCommitted {
        owner: address,
        auction_id: field,
        bid_id: field,
        vendor: address,
        stake: u64,
    }

    record BidRevealed {
        owner: address,
        auction_id: field,
        bid_id: field,
        amount: u64,
    }

    record AuctionFinalized {
        owner: address,
        auction_id: field,
        winner: address,
        winning_bid: u64,
        second_price: u64,
    }

    record StakeRefunded {
        owner: address,
        auction_id: field,
        bid_id: field,
        amount: u64,
    }

    record StakeSlashed {
        owner: address,
        auction_id: field,
        bid_id: field,
        amount: u64,
    }

    mapping auction_status: field => u8;
    mapping auction_creators: field => address;
    mapping auction_bidding_deadlines: field => u32;
    mapping auction_reveal_deadlines: field => u32;
    mapping auction_bid_count: field => u64;
    mapping auction_revealed_count: field => u64;
    mapping auction_flat_stake: field => u64;
    mapping auction_rfq_id: field => field;
    mapping auction_token_type: field => u8;
    mapping auction_lowest_bid: field => u64;
    mapping auction_lowest_bid_id: field => field;
    mapping auction_lowest_bidder: field => address;
    mapping auction_second_lowest_bid: field => u64;
    mapping bid_commitments: field => field;
    mapping bid_owners: field => address;
    mapping revealed_bids: field => u64;
    mapping bid_stakes: field => u64;
    mapping vendor_bid_count: field => u64;
    mapping auction_final_winner: field => address;
    mapping auction_final_price: field => u64;
    mapping auction_finalized: field => bool;

    @noupgrade
    constructor() {}

    // STATUS: 0=unknown 1=bidding 2=reveal 3=finalized 4=cancelled
    // TOKEN_TYPE: 0=CREDITS 1=USDCX 2=USAD

    fn create_auction(
        public auction_id: field,
        public salt: field,
        public rfq_id: field,
        public bidding_deadline: u32,
        public reveal_deadline: u32,
        public flat_stake_full: u64,
        public token_type: u8,
    ) -> (AuctionCreated, Final) {
        assert(auction_id != 0field);
        assert(salt != 0field);
        assert(rfq_id != 0field);
        assert(flat_stake_full > 0u64);
        assert(flat_stake_full < 18446744073709551615u64);
        assert(reveal_deadline > bidding_deadline);
        assert_eq(auction_id, BHP256::hash_to_field(AuctionIdInput {
            creator: self.caller,
            salt: salt,
        }));
        let flat_stake: u64 = flat_stake_full / 10u64;
        assert(flat_stake > 0u64);
        assert(token_type <= 2u8);
        let out: AuctionCreated = AuctionCreated {
            owner: self.caller,
            auction_id: auction_id,
            creator: self.caller,
            rfq_id: rfq_id,
            bidding_deadline: bidding_deadline,
            reveal_deadline: reveal_deadline,
            flat_stake: flat_stake,
            token_type: token_type,
        };
        let creator: address = self.caller;
        return (out, final {
            assert(bidding_deadline > block.height);
            assert(bidding_deadline <= block.height + 100000u32);
            assert(reveal_deadline > block.height);
            assert(reveal_deadline <= block.height + 100000u32);
            assert(reveal_deadline > bidding_deadline);
            assert(reveal_deadline - bidding_deadline >= 10u32);
            assert_eq(Mapping::get_or_use(auction_status, auction_id, 0u8), 0u8);
            Mapping::set(auction_status, auction_id, 1u8);
            Mapping::set(auction_creators, auction_id, creator);
            Mapping::set(auction_rfq_id, auction_id, rfq_id);
            Mapping::set(auction_bidding_deadlines, auction_id, bidding_deadline);
            Mapping::set(auction_reveal_deadlines, auction_id, reveal_deadline);
            Mapping::set(auction_bid_count, auction_id, 0u64);
            Mapping::set(auction_revealed_count, auction_id, 0u64);
            Mapping::set(auction_flat_stake, auction_id, flat_stake);
            Mapping::set(auction_lowest_bid, auction_id, 18446744073709551615u64);
            Mapping::set(auction_lowest_bid_id, auction_id, 0field);
            Mapping::set(auction_second_lowest_bid, auction_id, 18446744073709551615u64);
            Mapping::set(auction_token_type, auction_id, token_type);
        });
    }

    fn commit_bid(
        public auction_id: field,
               amount: u64,
               salt: field,
        public stake: u64,
        public bid_id: field,
    ) -> (BidCommitted, Final) {
        assert(auction_id != 0field);
        assert(bid_id != 0field);
        assert(amount > 0u64);
        assert(amount < 18446744073709551615u64);
        assert(stake > 0u64);
        assert(salt != 0field);
        let commitment: field = BHP256::hash_to_field(CommitmentInput {
            auction_id: auction_id,
            bidder: self.caller,
            amount: amount,
            salt: salt,
        });
        let bid_key_hash: field = BHP256::hash_to_field(BidKey {
            auction_id: auction_id,
            bid_id: bid_id,
        });
        let vendor_key_hash: field = BHP256::hash_to_field(VendorAuctionKey {
            vendor: self.caller,
            auction_id: auction_id,
        });
        let transfer_future: Final = credits.aleo::transfer_public_as_signer(self.address, stake);
        let bidder: address = self.caller;
        let out: BidCommitted = BidCommitted {
            owner: self.caller,
            auction_id: auction_id,
            bid_id: bid_id,
            vendor: self.caller,
            stake: stake,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_status, auction_id), 1u8);
            assert_eq(Mapping::get(auction_token_type, auction_id), 0u8);
            let bidding_deadline: u32 = Mapping::get(auction_bidding_deadlines, auction_id);
            assert(block.height < bidding_deadline);
            let flat_stake: u64 = Mapping::get(auction_flat_stake, auction_id);
            assert(stake >= flat_stake);
            assert_eq(Mapping::get_or_use(bid_commitments, bid_key_hash, 0field), 0field);
            assert_eq(Mapping::get_or_use(vendor_bid_count, vendor_key_hash, 0u64), 0u64);
            transfer_future.run();
            Mapping::set(bid_commitments, bid_key_hash, commitment);
            Mapping::set(bid_owners, bid_key_hash, bidder);
            Mapping::set(bid_stakes, bid_key_hash, stake);
            Mapping::set(vendor_bid_count, vendor_key_hash, 1u64);
            let bid_count: u64 = Mapping::get_or_use(auction_bid_count, auction_id, 0u64);
            Mapping::set(auction_bid_count, auction_id, bid_count + 1u64);
        });
    }

    fn reveal_bid(
        public auction_id: field,
        public bid_id: field,
               amount: u64,
               salt: field,
    ) -> (BidRevealed, Final) {
        assert(auction_id != 0field);
        assert(bid_id != 0field);
        assert(amount > 0u64);
        assert(amount < 18446744073709551615u64);
        assert(salt != 0field);
        let bid_key_hash: field = BHP256::hash_to_field(BidKey {
            auction_id: auction_id,
            bid_id: bid_id,
        });
        let commitment: field = BHP256::hash_to_field(CommitmentInput {
            auction_id: auction_id,
            bidder: self.caller,
            amount: amount,
            salt: salt,
        });
        let bidder: address = self.caller;
        let out: BidRevealed = BidRevealed {
            owner: self.caller,
            auction_id: auction_id,
            bid_id: bid_id,
            amount: amount,
        };
        return (out, final {
            let status: u8 = Mapping::get(auction_status, auction_id);
            let bidding_deadline: u32 = Mapping::get(auction_bidding_deadlines, auction_id);
            if status == 1u8 {
                assert(block.height >= bidding_deadline);
                Mapping::set(auction_status, auction_id, 2u8);
            } else {
                assert_eq(status, 2u8);
            }
            let reveal_deadline: u32 = Mapping::get(auction_reveal_deadlines, auction_id);
            assert(block.height < reveal_deadline);
            assert_eq(Mapping::get(bid_owners, bid_key_hash), bidder);
            let stored_commitment: field = Mapping::get_or_use(bid_commitments, bid_key_hash, 0field);
            assert(stored_commitment != 0field);
            assert_eq(stored_commitment, commitment);
            assert_eq(Mapping::get_or_use(revealed_bids, bid_key_hash, 0u64), 0u64);
            let stake: u64 = Mapping::get(bid_stakes, bid_key_hash);
            let min_stake: u64 = amount / 10u64;
            let required_stake: u64 = min_stake > 0u64 ? min_stake : 1u64;
            assert(stake >= required_stake);
            Mapping::set(revealed_bids, bid_key_hash, amount);
            let revealed_count: u64 = Mapping::get(auction_revealed_count, auction_id);
            Mapping::set(auction_revealed_count, auction_id, revealed_count + 1u64);
            let current_lowest: u64 = Mapping::get(auction_lowest_bid, auction_id);
            let current_second: u64 = Mapping::get(auction_second_lowest_bid, auction_id);
            let current_bidder: address = Mapping::get_or_use(auction_lowest_bidder, auction_id, aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
            let current_bid_id: field = Mapping::get(auction_lowest_bid_id, auction_id);
            let is_strictly_lower: bool = amount < current_lowest;
            let bidder_hash: field = BHP256::hash_to_field(bidder);
            let current_bidder_hash: field = BHP256::hash_to_field(current_bidder);
            let is_tie: bool = amount == current_lowest;
            let tie_wins: bool = is_tie && bidder_hash < current_bidder_hash;
            let is_new_best: bool = is_strictly_lower || tie_wins;
            let tie_loses: bool = is_tie && !tie_wins;
            let second_candidate: u64 = amount < current_second ? amount : current_second;
            let second_if_tie_loss: u64 = tie_loses ? amount : second_candidate;
            let new_second: u64 = is_new_best ? current_lowest : second_if_tie_loss;
            let new_lowest: u64 = is_new_best ? amount : current_lowest;
            let new_lowest_bid_id: field = is_new_best ? bid_key_hash : current_bid_id;
            let new_lowest_bidder: address = is_new_best ? bidder : current_bidder;
            Mapping::set(auction_lowest_bid, auction_id, new_lowest);
            Mapping::set(auction_lowest_bid_id, auction_id, new_lowest_bid_id);
            Mapping::set(auction_lowest_bidder, auction_id, new_lowest_bidder);
            Mapping::set(auction_second_lowest_bid, auction_id, new_second);
        });
    }

    fn finalize_auction(
        public auction_id: field,
    ) -> (AuctionFinalized, Final) {
        assert(auction_id != 0field);
        let caller: address = self.caller;
        let out: AuctionFinalized = AuctionFinalized {
            owner: self.caller,
            auction_id: auction_id,
            winner: self.caller,
            winning_bid: 0u64,
            second_price: 0u64,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_creators, auction_id), caller);
            let status: u8 = Mapping::get(auction_status, auction_id);
            assert(status == 1u8 || status == 2u8);
            assert_eq(Mapping::get_or_use(auction_finalized, auction_id, false), false);
            let reveal_deadline: u32 = Mapping::get(auction_reveal_deadlines, auction_id);
            assert(block.height >= reveal_deadline);
            let revealed_count: u64 = Mapping::get(auction_revealed_count, auction_id);
            assert(revealed_count > 0u64);
            let lowest_bid: u64 = Mapping::get(auction_lowest_bid, auction_id);
            let second_lowest_bid: u64 = Mapping::get(auction_second_lowest_bid, auction_id);
            let winner: address = Mapping::get(auction_lowest_bidder, auction_id);
            let price: u64 = revealed_count >= 2u64 ? second_lowest_bid : lowest_bid;
            Mapping::set(auction_final_winner, auction_id, winner);
            Mapping::set(auction_final_price, auction_id, price);
            Mapping::set(auction_status, auction_id, 3u8);
            Mapping::set(auction_finalized, auction_id, true);
        });
    }

    fn cancel_auction(
        public auction_id: field,
    ) -> Final {
        assert(auction_id != 0field);
        let caller: address = self.caller;
        return final {
            assert_eq(Mapping::get(auction_creators, auction_id), caller);
            let status: u8 = Mapping::get(auction_status, auction_id);
            assert(status == 1u8 || status == 2u8);
            Mapping::set(auction_status, auction_id, 4u8);
        };
    }

    fn refund_stake(
        public auction_id: field,
        public bid_id: field,
        public amount: u64,
    ) -> (StakeRefunded, Final) {
        assert(auction_id != 0field);
        assert(bid_id != 0field);
        let bid_key_hash: field = BHP256::hash_to_field(BidKey {
            auction_id: auction_id,
            bid_id: bid_id,
        });
        let transfer_future: Final = credits.aleo::transfer_public(self.caller, amount);
        let caller: address = self.caller;
        let out: StakeRefunded = StakeRefunded {
            owner: self.caller,
            auction_id: auction_id,
            bid_id: bid_id,
            amount: amount,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_token_type, auction_id), 0u8);
            let status: u8 = Mapping::get(auction_status, auction_id);
            let is_cancelled: bool = status == 4u8;
            let is_finalized: bool = status == 3u8;
            assert(is_cancelled || is_finalized);
            assert_eq(Mapping::get(bid_owners, bid_key_hash), caller);
            let stored_stake: u64 = Mapping::get_or_use(bid_stakes, bid_key_hash, 0u64);
            assert_eq(amount, stored_stake);
            assert(amount > 0u64);
            let revealed_amount: u64 = Mapping::get_or_use(revealed_bids, bid_key_hash, 0u64);
            let did_reveal: bool = revealed_amount > 0u64;
            assert(is_cancelled || did_reveal);
            Mapping::set(bid_stakes, bid_key_hash, 0u64);
            transfer_future.run();
        });
    }

    fn slash_unrevealed(
        public auction_id: field,
        public bid_id: field,
        public amount: u64,
    ) -> (StakeSlashed, Final) {
        assert(auction_id != 0field);
        assert(bid_id != 0field);
        let bid_key_hash: field = BHP256::hash_to_field(BidKey {
            auction_id: auction_id,
            bid_id: bid_id,
        });
        let transfer_future: Final = credits.aleo::transfer_public(self.caller, amount);
        let caller: address = self.caller;
        let out: StakeSlashed = StakeSlashed {
            owner: self.caller,
            auction_id: auction_id,
            bid_id: bid_id,
            amount: amount,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_token_type, auction_id), 0u8);
            assert_eq(Mapping::get(auction_creators, auction_id), caller);
            let status: u8 = Mapping::get(auction_status, auction_id);
            assert(status == 2u8 || status == 3u8);
            let reveal_deadline: u32 = Mapping::get(auction_reveal_deadlines, auction_id);
            assert(block.height > reveal_deadline);
            assert(block.height <= reveal_deadline + 1440u32);
            let stored_commitment: field = Mapping::get_or_use(bid_commitments, bid_key_hash, 0field);
            assert(stored_commitment != 0field);
            assert_eq(Mapping::get_or_use(revealed_bids, bid_key_hash, 0u64), 0u64);
            let stored_stake: u64 = Mapping::get_or_use(bid_stakes, bid_key_hash, 0u64);
            assert_eq(amount, stored_stake);
            assert(amount > 0u64);
            Mapping::set(bid_stakes, bid_key_hash, 0u64);
            transfer_future.run();
        });
    }

    // ── USDCx staking variants ──────────────────────────────────────────────

    fn commit_bid_usdcx(
        public auction_id: field,
               amount: u64,
               salt: field,
        public stake: u64,
        public bid_id: field,
    ) -> (BidCommitted, Final) {
        assert(auction_id != 0field);
        assert(bid_id != 0field);
        assert(amount > 0u64);
        assert(amount < 18446744073709551615u64);
        assert(stake > 0u64);
        assert(salt != 0field);
        let commitment: field = BHP256::hash_to_field(CommitmentInput {
            auction_id: auction_id,
            bidder: self.caller,
            amount: amount,
            salt: salt,
        });
        let bid_key_hash: field = BHP256::hash_to_field(BidKey {
            auction_id: auction_id,
            bid_id: bid_id,
        });
        let vendor_key_hash: field = BHP256::hash_to_field(VendorAuctionKey {
            vendor: self.caller,
            auction_id: auction_id,
        });
        let transfer_future: Final = test_usdcx_stablecoin.aleo::transfer_public_as_signer(self.address, stake as u128);
        let bidder: address = self.caller;
        let out: BidCommitted = BidCommitted {
            owner: self.caller,
            auction_id: auction_id,
            bid_id: bid_id,
            vendor: self.caller,
            stake: stake,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_status, auction_id), 1u8);
            assert_eq(Mapping::get(auction_token_type, auction_id), 1u8);
            let bidding_deadline: u32 = Mapping::get(auction_bidding_deadlines, auction_id);
            assert(block.height < bidding_deadline);
            let flat_stake: u64 = Mapping::get(auction_flat_stake, auction_id);
            assert(stake >= flat_stake);
            assert_eq(Mapping::get_or_use(bid_commitments, bid_key_hash, 0field), 0field);
            assert_eq(Mapping::get_or_use(vendor_bid_count, vendor_key_hash, 0u64), 0u64);
            transfer_future.run();
            Mapping::set(bid_commitments, bid_key_hash, commitment);
            Mapping::set(bid_owners, bid_key_hash, bidder);
            Mapping::set(bid_stakes, bid_key_hash, stake);
            Mapping::set(vendor_bid_count, vendor_key_hash, 1u64);
            let bid_count: u64 = Mapping::get_or_use(auction_bid_count, auction_id, 0u64);
            Mapping::set(auction_bid_count, auction_id, bid_count + 1u64);
        });
    }

    fn refund_stake_usdcx(
        public auction_id: field,
        public bid_id: field,
        public amount: u64,
    ) -> (StakeRefunded, Final) {
        assert(auction_id != 0field);
        assert(bid_id != 0field);
        let bid_key_hash: field = BHP256::hash_to_field(BidKey {
            auction_id: auction_id,
            bid_id: bid_id,
        });
        let transfer_future: Final = test_usdcx_stablecoin.aleo::transfer_public(self.caller, amount as u128);
        let caller: address = self.caller;
        let out: StakeRefunded = StakeRefunded {
            owner: self.caller,
            auction_id: auction_id,
            bid_id: bid_id,
            amount: amount,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_token_type, auction_id), 1u8);
            let status: u8 = Mapping::get(auction_status, auction_id);
            let is_cancelled: bool = status == 4u8;
            let is_finalized: bool = status == 3u8;
            assert(is_cancelled || is_finalized);
            assert_eq(Mapping::get(bid_owners, bid_key_hash), caller);
            let stored_stake: u64 = Mapping::get_or_use(bid_stakes, bid_key_hash, 0u64);
            assert_eq(amount, stored_stake);
            assert(amount > 0u64);
            let revealed_amount: u64 = Mapping::get_or_use(revealed_bids, bid_key_hash, 0u64);
            let did_reveal: bool = revealed_amount > 0u64;
            assert(is_cancelled || did_reveal);
            Mapping::set(bid_stakes, bid_key_hash, 0u64);
            transfer_future.run();
        });
    }

    fn slash_unrevealed_usdcx(
        public auction_id: field,
        public bid_id: field,
        public amount: u64,
    ) -> (StakeSlashed, Final) {
        assert(auction_id != 0field);
        assert(bid_id != 0field);
        let bid_key_hash: field = BHP256::hash_to_field(BidKey {
            auction_id: auction_id,
            bid_id: bid_id,
        });
        let transfer_future: Final = test_usdcx_stablecoin.aleo::transfer_public(self.caller, amount as u128);
        let caller: address = self.caller;
        let out: StakeSlashed = StakeSlashed {
            owner: self.caller,
            auction_id: auction_id,
            bid_id: bid_id,
            amount: amount,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_token_type, auction_id), 1u8);
            assert_eq(Mapping::get(auction_creators, auction_id), caller);
            let status: u8 = Mapping::get(auction_status, auction_id);
            assert(status == 2u8 || status == 3u8);
            let reveal_deadline: u32 = Mapping::get(auction_reveal_deadlines, auction_id);
            assert(block.height > reveal_deadline);
            assert(block.height <= reveal_deadline + 1440u32);
            let stored_commitment: field = Mapping::get_or_use(bid_commitments, bid_key_hash, 0field);
            assert(stored_commitment != 0field);
            assert_eq(Mapping::get_or_use(revealed_bids, bid_key_hash, 0u64), 0u64);
            let stored_stake: u64 = Mapping::get_or_use(bid_stakes, bid_key_hash, 0u64);
            assert_eq(amount, stored_stake);
            assert(amount > 0u64);
            Mapping::set(bid_stakes, bid_key_hash, 0u64);
            transfer_future.run();
        });
    }

    // ── USAD staking variants ───────────────────────────────────────────────

    fn commit_bid_usad(
        public auction_id: field,
               amount: u64,
               salt: field,
        public stake: u64,
        public bid_id: field,
    ) -> (BidCommitted, Final) {
        assert(auction_id != 0field);
        assert(bid_id != 0field);
        assert(amount > 0u64);
        assert(amount < 18446744073709551615u64);
        assert(stake > 0u64);
        assert(salt != 0field);
        let commitment: field = BHP256::hash_to_field(CommitmentInput {
            auction_id: auction_id,
            bidder: self.caller,
            amount: amount,
            salt: salt,
        });
        let bid_key_hash: field = BHP256::hash_to_field(BidKey {
            auction_id: auction_id,
            bid_id: bid_id,
        });
        let vendor_key_hash: field = BHP256::hash_to_field(VendorAuctionKey {
            vendor: self.caller,
            auction_id: auction_id,
        });
        let transfer_future: Final = test_usad_stablecoin.aleo::transfer_public_as_signer(self.address, stake as u128);
        let bidder: address = self.caller;
        let out: BidCommitted = BidCommitted {
            owner: self.caller,
            auction_id: auction_id,
            bid_id: bid_id,
            vendor: self.caller,
            stake: stake,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_status, auction_id), 1u8);
            assert_eq(Mapping::get(auction_token_type, auction_id), 2u8);
            let bidding_deadline: u32 = Mapping::get(auction_bidding_deadlines, auction_id);
            assert(block.height < bidding_deadline);
            let flat_stake: u64 = Mapping::get(auction_flat_stake, auction_id);
            assert(stake >= flat_stake);
            assert_eq(Mapping::get_or_use(bid_commitments, bid_key_hash, 0field), 0field);
            assert_eq(Mapping::get_or_use(vendor_bid_count, vendor_key_hash, 0u64), 0u64);
            transfer_future.run();
            Mapping::set(bid_commitments, bid_key_hash, commitment);
            Mapping::set(bid_owners, bid_key_hash, bidder);
            Mapping::set(bid_stakes, bid_key_hash, stake);
            Mapping::set(vendor_bid_count, vendor_key_hash, 1u64);
            let bid_count: u64 = Mapping::get_or_use(auction_bid_count, auction_id, 0u64);
            Mapping::set(auction_bid_count, auction_id, bid_count + 1u64);
        });
    }

    fn refund_stake_usad(
        public auction_id: field,
        public bid_id: field,
        public amount: u64,
    ) -> (StakeRefunded, Final) {
        assert(auction_id != 0field);
        assert(bid_id != 0field);
        let bid_key_hash: field = BHP256::hash_to_field(BidKey {
            auction_id: auction_id,
            bid_id: bid_id,
        });
        let transfer_future: Final = test_usad_stablecoin.aleo::transfer_public(self.caller, amount as u128);
        let caller: address = self.caller;
        let out: StakeRefunded = StakeRefunded {
            owner: self.caller,
            auction_id: auction_id,
            bid_id: bid_id,
            amount: amount,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_token_type, auction_id), 2u8);
            let status: u8 = Mapping::get(auction_status, auction_id);
            let is_cancelled: bool = status == 4u8;
            let is_finalized: bool = status == 3u8;
            assert(is_cancelled || is_finalized);
            assert_eq(Mapping::get(bid_owners, bid_key_hash), caller);
            let stored_stake: u64 = Mapping::get_or_use(bid_stakes, bid_key_hash, 0u64);
            assert_eq(amount, stored_stake);
            assert(amount > 0u64);
            let revealed_amount: u64 = Mapping::get_or_use(revealed_bids, bid_key_hash, 0u64);
            let did_reveal: bool = revealed_amount > 0u64;
            assert(is_cancelled || did_reveal);
            Mapping::set(bid_stakes, bid_key_hash, 0u64);
            transfer_future.run();
        });
    }

    fn slash_unrevealed_usad(
        public auction_id: field,
        public bid_id: field,
        public amount: u64,
    ) -> (StakeSlashed, Final) {
        assert(auction_id != 0field);
        assert(bid_id != 0field);
        let bid_key_hash: field = BHP256::hash_to_field(BidKey {
            auction_id: auction_id,
            bid_id: bid_id,
        });
        let transfer_future: Final = test_usad_stablecoin.aleo::transfer_public(self.caller, amount as u128);
        let caller: address = self.caller;
        let out: StakeSlashed = StakeSlashed {
            owner: self.caller,
            auction_id: auction_id,
            bid_id: bid_id,
            amount: amount,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_token_type, auction_id), 2u8);
            assert_eq(Mapping::get(auction_creators, auction_id), caller);
            let status: u8 = Mapping::get(auction_status, auction_id);
            assert(status == 2u8 || status == 3u8);
            let reveal_deadline: u32 = Mapping::get(auction_reveal_deadlines, auction_id);
            assert(block.height > reveal_deadline);
            assert(block.height <= reveal_deadline + 1440u32);
            let stored_commitment: field = Mapping::get_or_use(bid_commitments, bid_key_hash, 0field);
            assert(stored_commitment != 0field);
            assert_eq(Mapping::get_or_use(revealed_bids, bid_key_hash, 0u64), 0u64);
            let stored_stake: u64 = Mapping::get_or_use(bid_stakes, bid_key_hash, 0u64);
            assert_eq(amount, stored_stake);
            assert(amount > 0u64);
            Mapping::set(bid_stakes, bid_key_hash, 0u64);
            transfer_future.run();
        });
    }
}
