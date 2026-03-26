import credits.aleo;

program sealvickrey_v2.aleo;

record AuctionCreated:
    owner as address.private;
    auction_id as field.private;
    creator as address.private;
    rfq_id as field.private;
    bidding_deadline as u32.private;
    reveal_deadline as u32.private;
    flat_stake as u64.private;

record BidCommitted:
    owner as address.private;
    auction_id as field.private;
    bid_id as field.private;
    vendor as address.private;
    stake as u64.private;

record BidRevealed:
    owner as address.private;
    auction_id as field.private;
    bid_id as field.private;
    amount as u64.private;

record AuctionFinalized:
    owner as address.private;
    auction_id as field.private;
    winner as address.private;
    winning_bid as u64.private;
    second_price as u64.private;

record StakeRefunded:
    owner as address.private;
    auction_id as field.private;
    bid_id as field.private;
    amount as u64.private;

record StakeSlashed:
    owner as address.private;
    auction_id as field.private;
    bid_id as field.private;
    amount as u64.private;

struct AuctionIdInput:
    creator as address;
    salt as field;

struct BidKey:
    auction_id as field;
    bid_id as field;

struct VendorAuctionKey:
    vendor as address;
    auction_id as field;

struct CommitmentInput:
    auction_id as field;
    bidder as address;
    amount as u64;
    salt as field;

mapping auction_status:
    key as field.public;
    value as u8.public;

mapping auction_creators:
    key as field.public;
    value as address.public;

mapping auction_bidding_deadlines:
    key as field.public;
    value as u32.public;

mapping auction_reveal_deadlines:
    key as field.public;
    value as u32.public;

mapping auction_bid_count:
    key as field.public;
    value as u64.public;

mapping auction_revealed_count:
    key as field.public;
    value as u64.public;

mapping auction_flat_stake:
    key as field.public;
    value as u64.public;

mapping auction_rfq_id:
    key as field.public;
    value as field.public;

mapping auction_lowest_bid:
    key as field.public;
    value as u64.public;

mapping auction_lowest_bid_id:
    key as field.public;
    value as field.public;

mapping auction_lowest_bidder:
    key as field.public;
    value as address.public;

mapping auction_second_lowest_bid:
    key as field.public;
    value as u64.public;

mapping bid_commitments:
    key as field.public;
    value as field.public;

mapping bid_owners:
    key as field.public;
    value as address.public;

mapping revealed_bids:
    key as field.public;
    value as u64.public;

mapping bid_stakes:
    key as field.public;
    value as u64.public;

mapping vendor_bid_count:
    key as field.public;
    value as u64.public;

mapping auction_final_winner:
    key as field.public;
    value as address.public;

mapping auction_final_price:
    key as field.public;
    value as u64.public;

mapping auction_finalized:
    key as field.public;
    value as boolean.public;

function create_auction:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as field.public;
    input r3 as u32.public;
    input r4 as u32.public;
    input r5 as u64.public;
    is.neq r0 0field into r6;
    assert.eq r6 true;
    is.neq r1 0field into r7;
    assert.eq r7 true;
    is.neq r2 0field into r8;
    assert.eq r8 true;
    gt r5 0u64 into r9;
    assert.eq r9 true;
    lt r5 18446744073709551615u64 into r10;
    assert.eq r10 true;
    gt r4 r3 into r11;
    assert.eq r11 true;
    cast self.caller r1 into r12 as AuctionIdInput;
    hash.bhp256 r12 into r13 as field;
    assert.eq r0 r13;
    div r5 10u64 into r14;
    gt r14 0u64 into r15;
    assert.eq r15 true;
    cast self.caller r0 self.caller r2 r3 r4 r14 into r16 as AuctionCreated.record;
    async create_auction r0 r2 r3 r4 r14 self.caller into r17;
    output r16 as AuctionCreated.record;
    output r17 as sealvickrey_v2.aleo/create_auction.future;

finalize create_auction:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u32.public;
    input r3 as u32.public;
    input r4 as u64.public;
    input r5 as address.public;
    gt r2 block.height into r6;
    assert.eq r6 true;
    add block.height 100000u32 into r7;
    lte r2 r7 into r8;
    assert.eq r8 true;
    gt r3 block.height into r9;
    assert.eq r9 true;
    lte r3 r7 into r10;
    assert.eq r10 true;
    gt r3 r2 into r11;
    assert.eq r11 true;
    sub r3 r2 into r12;
    gte r12 10u32 into r13;
    assert.eq r13 true;
    get.or_use auction_status[r0] 0u8 into r14;
    assert.eq r14 0u8;
    set 1u8 into auction_status[r0];
    set r5 into auction_creators[r0];
    set r1 into auction_rfq_id[r0];
    set r2 into auction_bidding_deadlines[r0];
    set r3 into auction_reveal_deadlines[r0];
    set 0u64 into auction_bid_count[r0];
    set 0u64 into auction_revealed_count[r0];
    set r4 into auction_flat_stake[r0];
    set 18446744073709551615u64 into auction_lowest_bid[r0];
    set 0field into auction_lowest_bid_id[r0];
    set 18446744073709551615u64 into auction_second_lowest_bid[r0];

function commit_bid:
    input r0 as field.public;
    input r1 as u64.private;
    input r2 as field.private;
    input r3 as u64.public;
    input r4 as field.public;
    is.neq r0 0field into r5;
    assert.eq r5 true;
    is.neq r4 0field into r6;
    assert.eq r6 true;
    gt r1 0u64 into r7;
    assert.eq r7 true;
    lt r1 18446744073709551615u64 into r8;
    assert.eq r8 true;
    gt r3 0u64 into r9;
    assert.eq r9 true;
    is.neq r2 0field into r10;
    assert.eq r10 true;
    cast r0 self.caller r1 r2 into r11 as CommitmentInput;
    hash.bhp256 r11 into r12 as field;
    cast r0 r4 into r13 as BidKey;
    hash.bhp256 r13 into r14 as field;
    cast self.caller r0 into r15 as VendorAuctionKey;
    hash.bhp256 r15 into r16 as field;
    call credits.aleo/transfer_public_as_signer sealvickrey_v2.aleo r3 into r17;
    cast self.caller r0 r4 self.caller r3 into r18 as BidCommitted.record;
    async commit_bid r0 r14 r12 r3 self.caller r16 r17 into r19;
    output r18 as BidCommitted.record;
    output r19 as sealvickrey_v2.aleo/commit_bid.future;

finalize commit_bid:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as field.public;
    input r3 as u64.public;
    input r4 as address.public;
    input r5 as field.public;
    input r6 as credits.aleo/transfer_public_as_signer.future;
    get auction_status[r0] into r7;
    assert.eq r7 1u8;
    get auction_bidding_deadlines[r0] into r8;
    lt block.height r8 into r9;
    assert.eq r9 true;
    get auction_flat_stake[r0] into r10;
    gte r3 r10 into r11;
    assert.eq r11 true;
    get.or_use bid_commitments[r1] 0field into r12;
    assert.eq r12 0field;
    get.or_use vendor_bid_count[r5] 0u64 into r13;
    assert.eq r13 0u64;
    await r6;
    set r2 into bid_commitments[r1];
    set r4 into bid_owners[r1];
    set r3 into bid_stakes[r1];
    set 1u64 into vendor_bid_count[r5];
    get.or_use auction_bid_count[r0] 0u64 into r14;
    add r14 1u64 into r15;
    set r15 into auction_bid_count[r0];

function reveal_bid:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u64.private;
    input r3 as field.private;
    is.neq r0 0field into r4;
    assert.eq r4 true;
    is.neq r1 0field into r5;
    assert.eq r5 true;
    gt r2 0u64 into r6;
    assert.eq r6 true;
    lt r2 18446744073709551615u64 into r7;
    assert.eq r7 true;
    is.neq r3 0field into r8;
    assert.eq r8 true;
    cast r0 r1 into r9 as BidKey;
    hash.bhp256 r9 into r10 as field;
    cast r0 self.caller r2 r3 into r11 as CommitmentInput;
    hash.bhp256 r11 into r12 as field;
    cast self.caller r0 r1 r2 into r13 as BidRevealed.record;
    async reveal_bid r0 r10 r2 r12 self.caller into r14;
    output r13 as BidRevealed.record;
    output r14 as sealvickrey_v2.aleo/reveal_bid.future;

finalize reveal_bid:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u64.public;
    input r3 as field.public;
    input r4 as address.public;
    get auction_status[r0] into r5;
    get auction_bidding_deadlines[r0] into r6;
    is.eq r5 1u8 into r7;
    branch.eq r7 false to end_then_0_0;
    gte block.height r6 into r8;
    assert.eq r8 true;
    set 2u8 into auction_status[r0];
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    assert.eq r5 2u8;
    position end_otherwise_0_1;
    get auction_reveal_deadlines[r0] into r9;
    lt block.height r9 into r10;
    assert.eq r10 true;
    get bid_owners[r1] into r11;
    assert.eq r4 r11;
    get.or_use bid_commitments[r1] 0field into r12;
    is.neq r12 0field into r13;
    assert.eq r13 true;
    assert.eq r12 r3;
    get.or_use revealed_bids[r1] 0u64 into r14;
    assert.eq r14 0u64;
    get bid_stakes[r1] into r15;
    div r2 10u64 into r16;
    gt r16 0u64 into r17;
    ternary r17 r16 1u64 into r18;
    gte r15 r18 into r19;
    assert.eq r19 true;
    set r2 into revealed_bids[r1];
    get auction_revealed_count[r0] into r20;
    add r20 1u64 into r21;
    set r21 into auction_revealed_count[r0];
    get auction_lowest_bid[r0] into r22;
    get auction_second_lowest_bid[r0] into r23;
    get.or_use auction_lowest_bidder[r0] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r24;
    lt r2 r22 into r25;
    hash.bhp256 r4 into r26 as field;
    hash.bhp256 r24 into r27 as field;
    is.eq r2 r22 into r28;
    lt r26 r27 into r29;
    and r28 r29 into r30;
    or r25 r30 into r31;
    not r30 into r32;
    and r28 r32 into r33;
    lt r2 r23 into r34;
    ternary r34 r2 r23 into r35;
    ternary r33 r2 r35 into r36;
    ternary r31 r22 r36 into r37;
    ternary r31 r2 r22 into r38;
    get auction_lowest_bid_id[r0] into r39;
    ternary r31 r1 r39 into r40;
    ternary r31 r4 r24 into r41;
    set r38 into auction_lowest_bid[r0];
    set r40 into auction_lowest_bid_id[r0];
    set r41 into auction_lowest_bidder[r0];
    set r37 into auction_second_lowest_bid[r0];

function finalize_auction:
    input r0 as field.public;
    is.neq r0 0field into r1;
    assert.eq r1 true;
    cast self.caller r0 self.caller 0u64 0u64 into r2 as AuctionFinalized.record;
    async finalize_auction r0 self.caller into r3;
    output r2 as AuctionFinalized.record;
    output r3 as sealvickrey_v2.aleo/finalize_auction.future;

finalize finalize_auction:
    input r0 as field.public;
    input r1 as address.public;
    get auction_creators[r0] into r2;
    assert.eq r1 r2;
    get auction_status[r0] into r3;
    is.eq r3 2u8 into r4;
    is.eq r3 1u8 into r5;
    or r4 r5 into r6;
    assert.eq r6 true;
    get.or_use auction_finalized[r0] false into r7;
    assert.eq r7 false;
    get auction_reveal_deadlines[r0] into r8;
    gte block.height r8 into r9;
    assert.eq r9 true;
    get auction_revealed_count[r0] into r10;
    gt r10 0u64 into r11;
    assert.eq r11 true;
    get auction_lowest_bid[r0] into r12;
    get auction_second_lowest_bid[r0] into r13;
    get auction_lowest_bidder[r0] into r14;
    gte r10 2u64 into r15;
    ternary r15 r13 r12 into r16;
    set r14 into auction_final_winner[r0];
    set r16 into auction_final_price[r0];
    set 3u8 into auction_status[r0];
    set true into auction_finalized[r0];

function cancel_auction:
    input r0 as field.public;
    is.neq r0 0field into r1;
    assert.eq r1 true;
    async cancel_auction r0 self.caller into r2;
    output r2 as sealvickrey_v2.aleo/cancel_auction.future;

finalize cancel_auction:
    input r0 as field.public;
    input r1 as address.public;
    get auction_creators[r0] into r2;
    assert.eq r1 r2;
    get auction_status[r0] into r3;
    is.eq r3 1u8 into r4;
    is.eq r3 2u8 into r5;
    or r4 r5 into r6;
    assert.eq r6 true;
    set 4u8 into auction_status[r0];

function refund_stake:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u64.public;
    is.neq r0 0field into r3;
    assert.eq r3 true;
    is.neq r1 0field into r4;
    assert.eq r4 true;
    cast r0 r1 into r5 as BidKey;
    hash.bhp256 r5 into r6 as field;
    call credits.aleo/transfer_public self.caller r2 into r7;
    cast self.caller r0 r1 r2 into r8 as StakeRefunded.record;
    async refund_stake r0 r6 self.caller r2 r7 into r9;
    output r8 as StakeRefunded.record;
    output r9 as sealvickrey_v2.aleo/refund_stake.future;

finalize refund_stake:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as address.public;
    input r3 as u64.public;
    input r4 as credits.aleo/transfer_public.future;
    get auction_status[r0] into r5;
    is.eq r5 4u8 into r6;
    is.eq r5 3u8 into r7;
    or r6 r7 into r8;
    assert.eq r8 true;
    get bid_owners[r1] into r9;
    assert.eq r9 r2;
    get.or_use bid_stakes[r1] 0u64 into r10;
    assert.eq r3 r10;
    gt r3 0u64 into r11;
    assert.eq r11 true;
    get.or_use revealed_bids[r1] 0u64 into r12;
    gt r12 0u64 into r13;
    or r6 r13 into r14;
    assert.eq r14 true;
    set 0u64 into bid_stakes[r1];
    await r4;

function slash_unrevealed:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u64.public;
    is.neq r0 0field into r3;
    assert.eq r3 true;
    is.neq r1 0field into r4;
    assert.eq r4 true;
    cast r0 r1 into r5 as BidKey;
    hash.bhp256 r5 into r6 as field;
    call credits.aleo/transfer_public self.caller r2 into r7;
    cast self.caller r0 r1 r2 into r8 as StakeSlashed.record;
    async slash_unrevealed r0 r6 self.caller r2 r7 into r9;
    output r8 as StakeSlashed.record;
    output r9 as sealvickrey_v2.aleo/slash_unrevealed.future;

finalize slash_unrevealed:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as address.public;
    input r3 as u64.public;
    input r4 as credits.aleo/transfer_public.future;
    get auction_creators[r0] into r5;
    assert.eq r2 r5;
    get auction_status[r0] into r6;
    is.eq r6 2u8 into r7;
    is.eq r6 3u8 into r8;
    or r7 r8 into r9;
    assert.eq r9 true;
    get auction_reveal_deadlines[r0] into r10;
    gt block.height r10 into r11;
    assert.eq r11 true;
    add r10 1440u32 into r12;
    lte block.height r12 into r13;
    assert.eq r13 true;
    get.or_use bid_commitments[r1] 0field into r14;
    is.neq r14 0field into r15;
    assert.eq r15 true;
    get.or_use revealed_bids[r1] 0u64 into r16;
    assert.eq r16 0u64;
    get.or_use bid_stakes[r1] 0u64 into r17;
    assert.eq r3 r17;
    gt r3 0u64 into r18;
    assert.eq r18 true;
    set 0u64 into bid_stakes[r1];
    await r4;

constructor:
    assert.eq edition 0u16;
