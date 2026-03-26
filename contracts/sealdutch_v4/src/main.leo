import credits.aleo;

program sealdutch_v4.aleo;

record AuctionCreated:
    owner as address.private;
    auction_id as field.private;
    creator as address.private;
    rfq_id as field.private;
    start_price as u64.private;
    reserve_price as u64.private;
    price_decrement as u64.private;
    start_block as u32.private;
    end_block as u32.private;

record AcceptCommitted:
    owner as address.private;
    auction_id as field.private;
    acceptor as address.private;

record AuctionAccepted:
    owner as address.private;
    auction_id as field.private;
    acceptor as address.private;
    price as u64.private;

record CommitStakeRefunded:
    owner as address.private;
    auction_id as field.private;
    amount as u64.private;

struct AuctionIdInput:
    creator as address;
    salt as field;

struct AcceptCommitInput:
    auction_id as field;
    acceptor as address;
    salt as field;

struct AcceptorKey:
    auction_id as field;
    acceptor as address;

mapping auction_status:
    key as field.public;
    value as u8.public;

mapping auction_creators:
    key as field.public;
    value as address.public;

mapping auction_start_price:
    key as field.public;
    value as u64.public;

mapping auction_reserve_price:
    key as field.public;
    value as u64.public;

mapping auction_price_decrement:
    key as field.public;
    value as u64.public;

mapping auction_start_block:
    key as field.public;
    value as u32.public;

mapping auction_end_block:
    key as field.public;
    value as u32.public;

mapping auction_rfq_id:
    key as field.public;
    value as field.public;

mapping auction_final_winner:
    key as field.public;
    value as address.public;

mapping auction_final_price:
    key as field.public;
    value as u64.public;

mapping accept_commitments:
    key as field.public;
    value as field.public;

mapping accept_commit_block:
    key as field.public;
    value as u32.public;

mapping first_commit_block:
    key as field.public;
    value as u32.public;

mapping best_acceptor:
    key as field.public;
    value as address.public;

mapping best_commit_hash:
    key as field.public;
    value as field.public;

mapping commit_stakes:
    key as field.public;
    value as u64.public;

mapping auction_finalized:
    key as field.public;
    value as boolean.public;

function create_auction:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as field.public;
    input r3 as u64.public;
    input r4 as u64.public;
    input r5 as u64.public;
    input r6 as u32.public;
    input r7 as u32.public;
    is.neq r0 0field into r8;
    assert.eq r8 true;
    is.neq r1 0field into r9;
    assert.eq r9 true;
    is.neq r2 0field into r10;
    assert.eq r10 true;
    gt r3 0u64 into r11;
    assert.eq r11 true;
    gt r4 0u64 into r12;
    assert.eq r12 true;
    gt r5 0u64 into r13;
    assert.eq r13 true;
    gt r3 r4 into r14;
    assert.eq r14 true;
    gt r7 r6 into r15;
    assert.eq r15 true;
    cast self.caller r1 into r16 as AuctionIdInput;
    hash.bhp256 r16 into r17 as field;
    assert.eq r0 r17;
    cast self.caller r0 self.caller r2 r3 r4 r5 r6 r7 into r18 as AuctionCreated.record;
    async create_auction r0 r2 r3 r4 r5 r6 r7 self.caller into r19;
    output r18 as AuctionCreated.record;
    output r19 as sealdutch_v4.aleo/create_auction.future;

finalize create_auction:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as u64.public;
    input r5 as u32.public;
    input r6 as u32.public;
    input r7 as address.public;
    gte r5 block.height into r8;
    assert.eq r8 true;
    add block.height 100000u32 into r9;
    lte r6 r9 into r10;
    assert.eq r10 true;
    gt r6 r5 into r11;
    assert.eq r11 true;
    get.or_use auction_status[r0] 0u8 into r12;
    assert.eq r12 0u8;
    set 1u8 into auction_status[r0];
    set r7 into auction_creators[r0];
    set r1 into auction_rfq_id[r0];
    set r2 into auction_start_price[r0];
    set r3 into auction_reserve_price[r0];
    set r4 into auction_price_decrement[r0];
    set r5 into auction_start_block[r0];
    set r6 into auction_end_block[r0];

function commit_accept:
    input r0 as field.public;
    input r1 as field.private;
    is.neq r0 0field into r2;
    assert.eq r2 true;
    is.neq r1 0field into r3;
    assert.eq r3 true;
    cast r0 self.caller r1 into r4 as AcceptCommitInput;
    hash.bhp256 r4 into r5 as field;
    cast r0 self.caller into r6 as AcceptorKey;
    hash.bhp256 r6 into r7 as field;
    call credits.aleo/transfer_public_as_signer sealdutch_v4.aleo 10000u64 into r8;
    cast self.caller r0 self.caller into r9 as AcceptCommitted.record;
    async commit_accept r0 r7 r5 self.caller r8 into r10;
    output r9 as AcceptCommitted.record;
    output r10 as sealdutch_v4.aleo/commit_accept.future;

finalize commit_accept:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as field.public;
    input r3 as address.public;
    input r4 as credits.aleo/transfer_public_as_signer.future;
    get auction_status[r0] into r5;
    assert.eq r5 1u8;
    get auction_start_block[r0] into r6;
    get auction_end_block[r0] into r7;
    gte block.height r6 into r8;
    assert.eq r8 true;
    lte block.height r7 into r9;
    assert.eq r9 true;
    get.or_use accept_commitments[r1] 0field into r10;
    get.or_use accept_commit_block[r1] 0u32 into r11;
    is.eq r10 0field into r12;
    gt r11 0u32 into r13;
    add r11 10u32 into r14;
    gt block.height r14 into r15;
    and r13 r15 into r16;
    or r12 r16 into r17;
    assert.eq r17 true;
    await r4;
    set r2 into accept_commitments[r1];
    set block.height into accept_commit_block[r1];
    set 10000u64 into commit_stakes[r1];
    get.or_use first_commit_block[r0] 4294967295u32 into r18;
    get.or_use best_acceptor[r0] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r19;
    get.or_use best_commit_hash[r0] 0field into r20;
    is.eq r19 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r21;
    not r21 into r22;
    add r18 10u32 into r23;
    gt block.height r23 into r24;
    and r22 r24 into r25;
    lt block.height r18 into r26;
    is.eq block.height r18 into r27;
    lt r2 r20 into r28;
    and r27 r28 into r29;
    or r21 r25 into r30;
    or r30 r26 into r31;
    or r31 r29 into r32;
    branch.eq r32 false to end_then_0_0;
    set block.height into first_commit_block[r0];
    set r3 into best_acceptor[r0];
    set r2 into best_commit_hash[r0];
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    position end_otherwise_0_1;

function confirm_accept:
    input r0 as field.public;
    input r1 as field.private;
    is.neq r0 0field into r2;
    assert.eq r2 true;
    is.neq r1 0field into r3;
    assert.eq r3 true;
    cast r0 self.caller r1 into r4 as AcceptCommitInput;
    hash.bhp256 r4 into r5 as field;
    cast r0 self.caller into r6 as AcceptorKey;
    hash.bhp256 r6 into r7 as field;
    cast self.caller r0 self.caller 0u64 into r8 as AuctionAccepted.record;
    async confirm_accept r0 r7 r5 self.caller into r9;
    output r8 as AuctionAccepted.record;
    output r9 as sealdutch_v4.aleo/confirm_accept.future;

finalize confirm_accept:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as field.public;
    input r3 as address.public;
    get auction_status[r0] into r4;
    assert.eq r4 1u8;
    get.or_use auction_finalized[r0] false into r5;
    assert.eq r5 false;
    get best_acceptor[r0] into r6;
    assert.eq r3 r6;
    get accept_commitments[r1] into r7;
    assert.eq r7 r2;
    is.neq r2 0field into r8;
    assert.eq r8 true;
    get accept_commit_block[r1] into r9;
    add r9 1u32 into r10;
    gte block.height r10 into r11;
    assert.eq r11 true;
    add r9 10u32 into r12;
    lte block.height r12 into r13;
    assert.eq r13 true;
    get auction_end_block[r0] into r14;
    lte block.height r14 into r15;
    assert.eq r15 true;
    get auction_start_block[r0] into r16;
    get auction_start_price[r0] into r17;
    get auction_reserve_price[r0] into r18;
    get auction_price_decrement[r0] into r19;
    sub r9 r16 into r20;
    cast r20 into r21 as u64;
    sub r17 r18 into r22;
    div r22 r19 into r23;
    rem r22 r19 into r24;
    is.eq r24 0u64 into r25;
    gte r21 r23 into r26;
    gt r21 r23 into r27;
    ternary r25 r26 r27 into r28;
    mul r21 r19 into r29;
    sub r17 r29 into r30;
    ternary r28 r18 r30 into r31;
    set 2u8 into auction_status[r0];
    set true into auction_finalized[r0];
    set r3 into auction_final_winner[r0];
    set r31 into auction_final_price[r0];

function accept_price:
    input r0 as field.public;
    is.neq r0 0field into r1;
    assert.eq r1 true;
    async accept_price r0 self.caller into r2;
    output r2 as sealdutch_v4.aleo/accept_price.future;

finalize accept_price:
    input r0 as field.public;
    input r1 as address.public;
    get auction_status[r0] into r2;
    assert.eq r2 1u8;
    get.or_use auction_finalized[r0] false into r3;
    assert.eq r3 false;
    get auction_start_block[r0] into r4;
    get auction_end_block[r0] into r5;
    gte block.height r4 into r6;
    assert.eq r6 true;
    lte block.height r5 into r7;
    assert.eq r7 true;
    get auction_start_price[r0] into r8;
    get auction_reserve_price[r0] into r9;
    get auction_price_decrement[r0] into r10;
    sub block.height r4 into r11;
    cast r11 into r12 as u64;
    sub r8 r9 into r13;
    div r13 r10 into r14;
    rem r13 r10 into r15;
    is.eq r15 0u64 into r16;
    gte r12 r14 into r17;
    gt r12 r14 into r18;
    ternary r16 r17 r18 into r19;
    mul r12 r10 into r20;
    sub r8 r20 into r21;
    ternary r19 r9 r21 into r22;
    set 2u8 into auction_status[r0];
    set true into auction_finalized[r0];
    set r1 into auction_final_winner[r0];
    set r22 into auction_final_price[r0];

function expire_auction:
    input r0 as field.public;
    is.neq r0 0field into r1;
    assert.eq r1 true;
    async expire_auction r0 self.caller into r2;
    output r2 as sealdutch_v4.aleo/expire_auction.future;

finalize expire_auction:
    input r0 as field.public;
    input r1 as address.public;
    get auction_creators[r0] into r2;
    assert.eq r1 r2;
    get auction_status[r0] into r3;
    assert.eq r3 1u8;
    get auction_end_block[r0] into r4;
    gt block.height r4 into r5;
    assert.eq r5 true;
    set 3u8 into auction_status[r0];

function cancel_auction:
    input r0 as field.public;
    is.neq r0 0field into r1;
    assert.eq r1 true;
    async cancel_auction r0 self.caller into r2;
    output r2 as sealdutch_v4.aleo/cancel_auction.future;

finalize cancel_auction:
    input r0 as field.public;
    input r1 as address.public;
    get auction_creators[r0] into r2;
    assert.eq r1 r2;
    get auction_status[r0] into r3;
    assert.eq r3 1u8;
    set 4u8 into auction_status[r0];

function refund_commit_stake:
    input r0 as field.public;
    is.neq r0 0field into r1;
    assert.eq r1 true;
    cast r0 self.caller into r2 as AcceptorKey;
    hash.bhp256 r2 into r3 as field;
    call credits.aleo/transfer_public self.caller 10000u64 into r4;
    cast self.caller r0 10000u64 into r5 as CommitStakeRefunded.record;
    async refund_commit_stake r0 r3 self.caller r4 into r6;
    output r5 as CommitStakeRefunded.record;
    output r6 as sealdutch_v4.aleo/refund_commit_stake.future;

finalize refund_commit_stake:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as address.public;
    input r3 as credits.aleo/transfer_public.future;
    get auction_status[r0] into r4;
    is.neq r4 1u8 into r5;
    assert.eq r5 true;
    is.neq r4 0u8 into r6;
    assert.eq r6 true;
    get.or_use commit_stakes[r1] 0u64 into r7;
    gt r7 0u64 into r8;
    assert.eq r8 true;
    set 0u64 into commit_stakes[r1];
    await r3;

constructor:
    assert.eq edition 0u16;
