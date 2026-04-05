import credits.aleo;
import test_usdcx_multisig_core.aleo;
import test_usdcx_freezelist.aleo;
import test_usdcx_stablecoin.aleo;
import test_usad_multisig_core.aleo;
import test_usad_freezelist.aleo;
import test_usad_stablecoin.aleo;

program sealdutch_v9.aleo {

    struct AuctionIdInput {
        creator: address,
        salt: field,
    }

    struct AcceptCommitInput {
        auction_id: field,
        acceptor: address,
        salt: field,
    }

    struct AcceptorKey {
        auction_id: field,
        acceptor: address,
    }

    record AuctionCreated {
        owner: address,
        auction_id: field,
        creator: address,
        rfq_id: field,
        start_price: u64,
        reserve_price: u64,
        price_decrement: u64,
        start_block: u32,
        end_block: u32,
        token_type: u8,
    }

    record AcceptCommitted {
        owner: address,
        auction_id: field,
        acceptor: address,
    }

    record AuctionAccepted {
        owner: address,
        auction_id: field,
        acceptor: address,
        price: u64,
    }

    record CommitStakeRefunded {
        owner: address,
        auction_id: field,
        amount: u64,
    }

    mapping auction_status: field => u8;
    mapping auction_creators: field => address;
    mapping auction_start_price: field => u64;
    mapping auction_reserve_price: field => u64;
    mapping auction_price_decrement: field => u64;
    mapping auction_start_block: field => u32;
    mapping auction_end_block: field => u32;
    mapping auction_rfq_id: field => field;
    mapping auction_token_type: field => u8;
    mapping auction_final_winner: field => address;
    mapping auction_final_price: field => u64;
    mapping accept_commitments: field => field;
    mapping accept_commit_block: field => u32;
    mapping first_commit_block: field => u32;
    mapping best_acceptor: field => address;
    mapping best_commit_hash: field => field;
    mapping commit_stakes: field => u64;
    mapping auction_finalized: field => bool;

    @noupgrade
    constructor() {}

    // STATUS: 0=unknown 1=active 2=accepted 3=expired 4=cancelled
    // TOKEN_TYPE: 0=CREDITS 1=USDCX 2=USAD

    fn create_auction(
        public auction_id: field,
        public salt: field,
        public rfq_id: field,
        public start_price: u64,
        public reserve_price: u64,
        public price_decrement: u64,
        public start_block: u32,
        public end_block: u32,
        public token_type: u8,
    ) -> (AuctionCreated, Final) {
        assert(auction_id != 0field);
        assert(salt != 0field);
        assert(rfq_id != 0field);
        assert(start_price > 0u64);
        assert(reserve_price > 0u64);
        assert(price_decrement > 0u64);
        assert(start_price > reserve_price);
        assert(end_block > start_block);
        assert_eq(auction_id, BHP256::hash_to_field(AuctionIdInput {
            creator: self.caller,
            salt: salt,
        }));
        assert(token_type <= 2u8);
        let creator: address = self.caller;
        let out: AuctionCreated = AuctionCreated {
            owner: self.caller,
            auction_id: auction_id,
            creator: self.caller,
            rfq_id: rfq_id,
            start_price: start_price,
            reserve_price: reserve_price,
            price_decrement: price_decrement,
            start_block: start_block,
            end_block: end_block,
            token_type: token_type,
        };
        return (out, final {
            assert(start_block >= block.height);
            assert(end_block <= block.height + 100000u32);
            assert(end_block > start_block);
            assert_eq(Mapping::get_or_use(auction_status, auction_id, 0u8), 0u8);
            Mapping::set(auction_status, auction_id, 1u8);
            Mapping::set(auction_creators, auction_id, creator);
            Mapping::set(auction_rfq_id, auction_id, rfq_id);
            Mapping::set(auction_start_price, auction_id, start_price);
            Mapping::set(auction_reserve_price, auction_id, reserve_price);
            Mapping::set(auction_price_decrement, auction_id, price_decrement);
            Mapping::set(auction_start_block, auction_id, start_block);
            Mapping::set(auction_end_block, auction_id, end_block);
            Mapping::set(auction_token_type, auction_id, token_type);
        });
    }

    fn commit_accept(
        public auction_id: field,
               salt: field,
    ) -> (AcceptCommitted, Final) {
        assert(auction_id != 0field);
        assert(salt != 0field);
        let commit_hash: field = BHP256::hash_to_field(AcceptCommitInput {
            auction_id: auction_id,
            acceptor: self.caller,
            salt: salt,
        });
        let key_hash: field = BHP256::hash_to_field(AcceptorKey {
            auction_id: auction_id,
            acceptor: self.caller,
        });
        let transfer_future: Final = credits.aleo::transfer_public_as_signer(self.address, 10000u64);
        let acceptor: address = self.caller;
        let out: AcceptCommitted = AcceptCommitted {
            owner: self.caller,
            auction_id: auction_id,
            acceptor: self.caller,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_status, auction_id), 1u8);
            assert_eq(Mapping::get(auction_token_type, auction_id), 0u8);
            let start_block: u32 = Mapping::get(auction_start_block, auction_id);
            let end_block: u32 = Mapping::get(auction_end_block, auction_id);
            assert(block.height >= start_block);
            assert(block.height <= end_block);
            let existing_commitment: field = Mapping::get_or_use(accept_commitments, key_hash, 0field);
            let existing_commit_block: u32 = Mapping::get_or_use(accept_commit_block, key_hash, 0u32);
            let no_commitment: bool = existing_commitment == 0field;
            let can_replace: bool = existing_commit_block > 0u32 && block.height > existing_commit_block + 10u32;
            assert(no_commitment || can_replace);
            transfer_future.run();
            Mapping::set(accept_commitments, key_hash, commit_hash);
            Mapping::set(accept_commit_block, key_hash, block.height);
            Mapping::set(commit_stakes, key_hash, 10000u64);
            let first_commit: u32 = Mapping::get_or_use(first_commit_block, auction_id, 4294967295u32);
            let best_addr: address = Mapping::get_or_use(best_acceptor, auction_id, aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
            let best_hash: field = Mapping::get_or_use(best_commit_hash, auction_id, 0field);
            let no_acceptor: bool = best_addr == aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
            let old_acceptor: bool = !no_acceptor && block.height > first_commit + 10u32;
            let earlier_block: bool = block.height < first_commit;
            let same_block_lower_hash: bool = block.height == first_commit && commit_hash < best_hash;
            let should_update: bool = no_acceptor || old_acceptor || earlier_block || same_block_lower_hash;
            if should_update {
                Mapping::set(first_commit_block, auction_id, block.height);
                Mapping::set(best_acceptor, auction_id, acceptor);
                Mapping::set(best_commit_hash, auction_id, commit_hash);
            }
        });
    }

    fn confirm_accept(
        public auction_id: field,
               salt: field,
    ) -> (AuctionAccepted, Final) {
        assert(auction_id != 0field);
        assert(salt != 0field);
        let commit_hash: field = BHP256::hash_to_field(AcceptCommitInput {
            auction_id: auction_id,
            acceptor: self.caller,
            salt: salt,
        });
        let key_hash: field = BHP256::hash_to_field(AcceptorKey {
            auction_id: auction_id,
            acceptor: self.caller,
        });
        let acceptor: address = self.caller;
        let out: AuctionAccepted = AuctionAccepted {
            owner: self.caller,
            auction_id: auction_id,
            acceptor: self.caller,
            price: 0u64,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_status, auction_id), 1u8);
            assert_eq(Mapping::get_or_use(auction_finalized, auction_id, false), false);
            assert_eq(Mapping::get(best_acceptor, auction_id), acceptor);
            let stored_commitment: field = Mapping::get(accept_commitments, key_hash);
            assert_eq(stored_commitment, commit_hash);
            assert(commit_hash != 0field);
            let commit_blk: u32 = Mapping::get(accept_commit_block, key_hash);
            assert(block.height >= commit_blk + 1u32);
            assert(block.height <= commit_blk + 10u32);
            assert(block.height <= Mapping::get(auction_end_block, auction_id));
            let start_block: u32 = Mapping::get(auction_start_block, auction_id);
            let start_price: u64 = Mapping::get(auction_start_price, auction_id);
            let reserve_price: u64 = Mapping::get(auction_reserve_price, auction_id);
            let price_decrement: u64 = Mapping::get(auction_price_decrement, auction_id);
            let blocks_elapsed: u64 = (commit_blk - start_block) as u64;
            let full_range: u64 = start_price - reserve_price;
            let steps: u64 = full_range / price_decrement;
            let remainder: u64 = full_range % price_decrement;
            let exactly_divisible: bool = remainder == 0u64;
            let past_floor: bool = exactly_divisible ? blocks_elapsed >= steps : blocks_elapsed > steps;
            let computed_price: u64 = start_price - blocks_elapsed * price_decrement;
            let final_price: u64 = past_floor ? reserve_price : computed_price;
            Mapping::set(auction_status, auction_id, 2u8);
            Mapping::set(auction_finalized, auction_id, true);
            Mapping::set(auction_final_winner, auction_id, acceptor);
            Mapping::set(auction_final_price, auction_id, final_price);
        });
    }

    fn accept_price(
        public auction_id: field,
    ) -> Final {
        assert(auction_id != 0field);
        let acceptor: address = self.caller;
        return final {
            assert_eq(Mapping::get(auction_status, auction_id), 1u8);
            assert_eq(Mapping::get_or_use(auction_finalized, auction_id, false), false);
            let start_block: u32 = Mapping::get(auction_start_block, auction_id);
            let end_block: u32 = Mapping::get(auction_end_block, auction_id);
            assert(block.height >= start_block);
            assert(block.height <= end_block);
            let start_price: u64 = Mapping::get(auction_start_price, auction_id);
            let reserve_price: u64 = Mapping::get(auction_reserve_price, auction_id);
            let price_decrement: u64 = Mapping::get(auction_price_decrement, auction_id);
            let blocks_elapsed: u64 = (block.height - start_block) as u64;
            let full_range: u64 = start_price - reserve_price;
            let steps: u64 = full_range / price_decrement;
            let remainder: u64 = full_range % price_decrement;
            let exactly_divisible: bool = remainder == 0u64;
            let past_floor: bool = exactly_divisible ? blocks_elapsed >= steps : blocks_elapsed > steps;
            let computed_price: u64 = start_price - blocks_elapsed * price_decrement;
            let final_price: u64 = past_floor ? reserve_price : computed_price;
            Mapping::set(auction_status, auction_id, 2u8);
            Mapping::set(auction_finalized, auction_id, true);
            Mapping::set(auction_final_winner, auction_id, acceptor);
            Mapping::set(auction_final_price, auction_id, final_price);
        };
    }

    fn expire_auction(
        public auction_id: field,
    ) -> Final {
        assert(auction_id != 0field);
        let caller: address = self.caller;
        return final {
            assert_eq(Mapping::get(auction_creators, auction_id), caller);
            assert_eq(Mapping::get(auction_status, auction_id), 1u8);
            assert(block.height > Mapping::get(auction_end_block, auction_id));
            Mapping::set(auction_status, auction_id, 3u8);
        };
    }

    fn cancel_auction(
        public auction_id: field,
    ) -> Final {
        assert(auction_id != 0field);
        let caller: address = self.caller;
        return final {
            assert_eq(Mapping::get(auction_creators, auction_id), caller);
            assert_eq(Mapping::get(auction_status, auction_id), 1u8);
            Mapping::set(auction_status, auction_id, 4u8);
        };
    }

    fn refund_commit_stake(
        public auction_id: field,
    ) -> (CommitStakeRefunded, Final) {
        assert(auction_id != 0field);
        let key_hash: field = BHP256::hash_to_field(AcceptorKey {
            auction_id: auction_id,
            acceptor: self.caller,
        });
        let transfer_future: Final = credits.aleo::transfer_public(self.caller, 10000u64);
        let out: CommitStakeRefunded = CommitStakeRefunded {
            owner: self.caller,
            auction_id: auction_id,
            amount: 10000u64,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_token_type, auction_id), 0u8);
            let status: u8 = Mapping::get(auction_status, auction_id);
            assert(status != 1u8);
            assert(status != 0u8);
            let stake: u64 = Mapping::get_or_use(commit_stakes, key_hash, 0u64);
            assert(stake > 0u64);
            Mapping::set(commit_stakes, key_hash, 0u64);
            transfer_future.run();
        });
    }

    // ── USDCx staking variants ──────────────────────────────────────────────

    fn commit_accept_usdcx(
        public auction_id: field,
               salt: field,
    ) -> (AcceptCommitted, Final) {
        assert(auction_id != 0field);
        assert(salt != 0field);
        let commit_hash: field = BHP256::hash_to_field(AcceptCommitInput {
            auction_id: auction_id,
            acceptor: self.caller,
            salt: salt,
        });
        let key_hash: field = BHP256::hash_to_field(AcceptorKey {
            auction_id: auction_id,
            acceptor: self.caller,
        });
        let transfer_future: Final = test_usdcx_stablecoin.aleo::transfer_public_as_signer(self.address, 10000u128);
        let acceptor: address = self.caller;
        let out: AcceptCommitted = AcceptCommitted {
            owner: self.caller,
            auction_id: auction_id,
            acceptor: self.caller,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_status, auction_id), 1u8);
            assert_eq(Mapping::get(auction_token_type, auction_id), 1u8);
            let start_block: u32 = Mapping::get(auction_start_block, auction_id);
            let end_block: u32 = Mapping::get(auction_end_block, auction_id);
            assert(block.height >= start_block);
            assert(block.height <= end_block);
            let existing_commitment: field = Mapping::get_or_use(accept_commitments, key_hash, 0field);
            let existing_commit_block: u32 = Mapping::get_or_use(accept_commit_block, key_hash, 0u32);
            let no_commitment: bool = existing_commitment == 0field;
            let can_replace: bool = existing_commit_block > 0u32 && block.height > existing_commit_block + 10u32;
            assert(no_commitment || can_replace);
            transfer_future.run();
            Mapping::set(accept_commitments, key_hash, commit_hash);
            Mapping::set(accept_commit_block, key_hash, block.height);
            Mapping::set(commit_stakes, key_hash, 10000u64);
            let first_commit: u32 = Mapping::get_or_use(first_commit_block, auction_id, 4294967295u32);
            let best_addr: address = Mapping::get_or_use(best_acceptor, auction_id, aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
            let best_hash: field = Mapping::get_or_use(best_commit_hash, auction_id, 0field);
            let no_acceptor: bool = best_addr == aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
            let old_acceptor: bool = !no_acceptor && block.height > first_commit + 10u32;
            let earlier_block: bool = block.height < first_commit;
            let same_block_lower_hash: bool = block.height == first_commit && commit_hash < best_hash;
            let should_update: bool = no_acceptor || old_acceptor || earlier_block || same_block_lower_hash;
            if should_update {
                Mapping::set(first_commit_block, auction_id, block.height);
                Mapping::set(best_acceptor, auction_id, acceptor);
                Mapping::set(best_commit_hash, auction_id, commit_hash);
            }
        });
    }

    fn refund_commit_stake_usdcx(
        public auction_id: field,
    ) -> (CommitStakeRefunded, Final) {
        assert(auction_id != 0field);
        let key_hash: field = BHP256::hash_to_field(AcceptorKey {
            auction_id: auction_id,
            acceptor: self.caller,
        });
        let transfer_future: Final = test_usdcx_stablecoin.aleo::transfer_public(self.caller, 10000u128);
        let out: CommitStakeRefunded = CommitStakeRefunded {
            owner: self.caller,
            auction_id: auction_id,
            amount: 10000u64,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_token_type, auction_id), 1u8);
            let status: u8 = Mapping::get(auction_status, auction_id);
            assert(status != 1u8);
            assert(status != 0u8);
            let stake: u64 = Mapping::get_or_use(commit_stakes, key_hash, 0u64);
            assert(stake > 0u64);
            Mapping::set(commit_stakes, key_hash, 0u64);
            transfer_future.run();
        });
    }

    // ── USAD staking variants ───────────────────────────────────────────────

    fn commit_accept_usad(
        public auction_id: field,
               salt: field,
    ) -> (AcceptCommitted, Final) {
        assert(auction_id != 0field);
        assert(salt != 0field);
        let commit_hash: field = BHP256::hash_to_field(AcceptCommitInput {
            auction_id: auction_id,
            acceptor: self.caller,
            salt: salt,
        });
        let key_hash: field = BHP256::hash_to_field(AcceptorKey {
            auction_id: auction_id,
            acceptor: self.caller,
        });
        let transfer_future: Final = test_usad_stablecoin.aleo::transfer_public_as_signer(self.address, 10000u128);
        let acceptor: address = self.caller;
        let out: AcceptCommitted = AcceptCommitted {
            owner: self.caller,
            auction_id: auction_id,
            acceptor: self.caller,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_status, auction_id), 1u8);
            assert_eq(Mapping::get(auction_token_type, auction_id), 2u8);
            let start_block: u32 = Mapping::get(auction_start_block, auction_id);
            let end_block: u32 = Mapping::get(auction_end_block, auction_id);
            assert(block.height >= start_block);
            assert(block.height <= end_block);
            let existing_commitment: field = Mapping::get_or_use(accept_commitments, key_hash, 0field);
            let existing_commit_block: u32 = Mapping::get_or_use(accept_commit_block, key_hash, 0u32);
            let no_commitment: bool = existing_commitment == 0field;
            let can_replace: bool = existing_commit_block > 0u32 && block.height > existing_commit_block + 10u32;
            assert(no_commitment || can_replace);
            transfer_future.run();
            Mapping::set(accept_commitments, key_hash, commit_hash);
            Mapping::set(accept_commit_block, key_hash, block.height);
            Mapping::set(commit_stakes, key_hash, 10000u64);
            let first_commit: u32 = Mapping::get_or_use(first_commit_block, auction_id, 4294967295u32);
            let best_addr: address = Mapping::get_or_use(best_acceptor, auction_id, aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc);
            let best_hash: field = Mapping::get_or_use(best_commit_hash, auction_id, 0field);
            let no_acceptor: bool = best_addr == aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
            let old_acceptor: bool = !no_acceptor && block.height > first_commit + 10u32;
            let earlier_block: bool = block.height < first_commit;
            let same_block_lower_hash: bool = block.height == first_commit && commit_hash < best_hash;
            let should_update: bool = no_acceptor || old_acceptor || earlier_block || same_block_lower_hash;
            if should_update {
                Mapping::set(first_commit_block, auction_id, block.height);
                Mapping::set(best_acceptor, auction_id, acceptor);
                Mapping::set(best_commit_hash, auction_id, commit_hash);
            }
        });
    }

    fn refund_commit_stake_usad(
        public auction_id: field,
    ) -> (CommitStakeRefunded, Final) {
        assert(auction_id != 0field);
        let key_hash: field = BHP256::hash_to_field(AcceptorKey {
            auction_id: auction_id,
            acceptor: self.caller,
        });
        let transfer_future: Final = test_usad_stablecoin.aleo::transfer_public(self.caller, 10000u128);
        let out: CommitStakeRefunded = CommitStakeRefunded {
            owner: self.caller,
            auction_id: auction_id,
            amount: 10000u64,
        };
        return (out, final {
            assert_eq(Mapping::get(auction_token_type, auction_id), 2u8);
            let status: u8 = Mapping::get(auction_status, auction_id);
            assert(status != 1u8);
            assert(status != 0u8);
            let stake: u64 = Mapping::get_or_use(commit_stakes, key_hash, 0u64);
            assert(stake > 0u64);
            Mapping::set(commit_stakes, key_hash, 0u64);
            transfer_future.run();
        });
    }
}
