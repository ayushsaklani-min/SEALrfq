// SEAL RFQ v18 — B2B Zero-Knowledge Procurement Protocol
//
// This contract is written directly in Leo IR (Aleo Instructions).
// During development, Leo's high-level compiler wasn't producing deployable output.
// The Provable team's documented solution was to compile down to Aleo Instructions
// manually and deploy via snarkOS built from source. That is exactly what we did.
// The result: every register is explicit, every constraint is intentional, and there
// is zero compiler indirection between what is written here and what the AVM executes.
// Anyone auditing this contract reads exactly what runs on-chain — no build step required.
//
// Deployed on Aleo Testnet:
// https://testnet.explorer.provable.com/program/sealrfq_v18.aleo

import credits.aleo;
import merkle_tree.aleo;
import test_usdcx_multisig_core.aleo;
import test_usdcx_freezelist.aleo;
import test_usdcx_stablecoin.aleo;
import test_usad_multisig_core.aleo;
import test_usad_freezelist.aleo;
import test_usad_stablecoin.aleo;

program sealrfq_v18.aleo;

record RFQCreated:
    owner as address.private;
    rfq_id as field.private;
    creator as address.private;
    bidding_deadline as u32.private;
    reveal_deadline as u32.private;
    min_bid as u64.private;
    min_bid_count as u64.private;
    flat_stake as u64.private;
    metadata_hash as field.private;

record BidCommitted:
    owner as address.private;
    rfq_id as field.private;
    bid_id as field.private;
    vendor as address.private;
    stake as u64.private;

record BidRevealed:
    owner as address.private;
    rfq_id as field.private;
    bid_id as field.private;
    bid_amount as u64.private;

record WinnerSelected:
    owner as address.private;
    rfq_id as field.private;
    winning_bid_id as field.private;
    winner_address as address.private;
    winning_amount as u64.private;

record WinnerCertificate:
    owner as address.private;
    rfq_id as field.private;
    winning_bid_id as field.private;
    winner_address as address.private;
    certificate_id as field.private;

record EscrowFunded:
    owner as address.private;
    rfq_id as field.private;
    amount as u64.private;

record PartialPaymentReleased:
    owner as address.private;
    rfq_id as field.private;
    release_amount as u64.private;
    total_released as u64.private;
    percentage as u8.private;

record FinalPaymentReleased:
    owner as address.private;
    rfq_id as field.private;
    release_amount as u64.private;

record StakeRefunded:
    owner as address.private;
    rfq_id as field.private;
    bid_id as field.private;
    amount as u64.private;

record StakeSlashed:
    owner as address.private;
    rfq_id as field.private;
    bid_id as field.private;
    amount as u64.private;
    creator as address.private;

record EscrowReclaimed:
    owner as address.private;
    rfq_id as field.private;
    creator as address.private;
    amount as u64.private;

record RFQCancelled:
    owner as address.private;
    rfq_id as field.private;
    creator as address.private;

record InvoiceReceipt:
    owner as address.private;
    rfq_id as field.private;
    receipt_hash as field.private;
    amount as u64.private;

record WinnerEscrowClaimed:
    owner as address.private;
    rfq_id as field.private;
    amount as u64.private;

record AuctionImported:
    owner as address.private;
    rfq_id as field.private;
    winner as address.private;
    price as u64.private;
    auction_type as u8.private;

struct CommitmentInput:
    bid_amount as u64;
    nonce as field;

struct NonceKey:
    actor as address;
    action_tag as u8;
    rfq_id as field;

struct VendorRFQKey:
    vendor as address;
    rfq_id as field;

struct BidKey:
    rfq_id as field;
    bid_id as field;

struct RFQIdInput:
    creator as address;
    salt as field;

struct ResultHashInput:
    auction_id as field;
    rfq_id as field;
    winner as address;
    price as u64;

struct ReceiptInput:
    rfq_id as field;
    payer as address;
    winner as address;
    amount as u64;
    nonce as field;

struct V16ProofKey:
    rfq_id as field;
    proof_tag as u8;

struct RFQSettlementProof:
    rfq_id as field;
    winning_bid_id as field;
    winning_amount as u64;
    winner_address as address;
    settled_at as u32;

struct WinnerCertificateInput:
    rfq_id as field;
    winning_bid_id as field;
    winner_address as address;

struct PlatformConfig:
    admin_hash as field;
    fee_bps as u64;
    paused as boolean;
    treasury_credits as u64;
    treasury_usdcx as u64;
    treasury_usad as u64;

mapping rfq_status:
    key as field.public;
    value as u8.public;

mapping rfq_bidding_deadlines:
    key as field.public;
    value as u32.public;

mapping rfq_reveal_deadlines:
    key as field.public;
    value as u32.public;

mapping rfq_min_bids:
    key as field.public;
    value as u64.public;

mapping rfq_min_bid_count:
    key as field.public;
    value as u64.public;

mapping rfq_creators:
    key as field.public;
    value as address.public;

mapping rfq_bid_count:
    key as field.public;
    value as u64.public;

mapping rfq_winner_address:
    key as field.public;
    value as address.public;

mapping rfq_lifecycle_block:
    key as field.public;
    value as u32.public;

mapping rfq_lowest_bid:
    key as field.public;
    value as u64.public;

mapping rfq_lowest_bid_id:
    key as field.public;
    value as field.public;

mapping rfq_flat_stake:
    key as field.public;
    value as u64.public;

mapping bid_commitments:
    key as field.public;
    value as field.public;

mapping bid_owner:
    key as field.public;
    value as address.public;

mapping revealed_bids:
    key as field.public;
    value as u64.public;

mapping bid_stakes:
    key as field.public;
    value as u64.public;

mapping winner_bids:
    key as field.public;
    value as field.public;

mapping vendor_bid_count:
    key as field.public;
    value as u64.public;

mapping escrow_token:
    key as field.public;
    value as u8.public;

mapping escrow_original:
    key as field.public;
    value as u64.public;

mapping escrow_amounts:
    key as field.public;
    value as u64.public;

mapping total_released:
    key as field.public;
    value as u64.public;

mapping final_payment_released:
    key as field.public;
    value as boolean.public;

mapping actor_nonces:
    key as field.public;
    value as u64.public;

mapping rfq_winner_accepted:
    key as field.public;
    value as boolean.public;

mapping receipts:
    key as field.public;
    value as field.public;

mapping paid:
    key as field.public;
    value as boolean.public;

mapping rfq_mode:
    key as field.public;
    value as u8.public;

mapping v16_proofs:
    key as field.public;
    value as field.public;

mapping platform_config:
    key as u8.public;
    value as PlatformConfig.public;

mapping auction_source:
    key as field.public;
    value as field.public;

function configure_platform:
    input r0 as u64.public;
    input r1 as boolean.public;
    lt r0 10000u64 into r2;
    assert.eq r2 true;
    async configure_platform self.caller r0 r1 into r3;
    output r3 as sealrfq_v18.aleo/configure_platform.future;

finalize configure_platform:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as boolean.public;
    hash.bhp256 r0 into r3 as field;
    cast 0field 0u64 false 0u64 0u64 0u64 into r4 as PlatformConfig;
    get.or_use platform_config[0u8] r4 into r5;
    is.eq r5.admin_hash 0field into r6;
    branch.eq r6 false to end_then_0_0;
    cast r3 r1 r2 r5.treasury_credits r5.treasury_usdcx r5.treasury_usad into r7 as PlatformConfig;
    set r7 into platform_config[0u8];
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    assert.eq r3 r5.admin_hash;
    cast r5.admin_hash r1 r2 r5.treasury_credits r5.treasury_usdcx r5.treasury_usad into r8 as PlatformConfig;
    set r8 into platform_config[0u8];
    position end_otherwise_0_1;

function withdraw_fees:
    input r0 as u64.public;
    gt r0 0u64 into r1;
    assert.eq r1 true;
    call credits.aleo/transfer_public self.caller r0 into r2;
    async withdraw_fees self.caller 0u8 r0 r2 into r3;
    output r3 as sealrfq_v18.aleo/withdraw_fees.future;

finalize withdraw_fees:
    input r0 as address.public;
    input r1 as u8.public;
    input r2 as u64.public;
    input r3 as credits.aleo/transfer_public.future;
    is.eq r1 0u8 into r4;
    is.eq r1 1u8 into r5;
    or r4 r5 into r6;
    assert.eq r6 true;
    cast 0field 0u64 false 0u64 0u64 0u64 into r7 as PlatformConfig;
    get.or_use platform_config[0u8] r7 into r8;
    is.neq r8.admin_hash 0field into r9;
    assert.eq r9 true;
    hash.bhp256 r0 into r10 as field;
    assert.eq r10 r8.admin_hash;
    ternary r4 r8.treasury_credits r8.treasury_usdcx into r11;
    lte r2 r11 into r12;
    assert.eq r12 true;
    await r3;
    sub r11 r2 into r13;
    ternary r4 r13 r8.treasury_credits into r14;
    ternary r5 r13 r8.treasury_usdcx into r15;
    cast r8.admin_hash r8.fee_bps r8.paused r14 r15 r8.treasury_usad into r16 as PlatformConfig;
    set r16 into platform_config[0u8];

function withdraw_fees_usdcx:
    input r0 as u64.public;
    gt r0 0u64 into r1;
    assert.eq r1 true;
    cast r0 into r2 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public self.caller r2 into r3;
    async withdraw_fees_usdcx self.caller 1u8 r0 r3 into r4;
    output r4 as sealrfq_v18.aleo/withdraw_fees_usdcx.future;

finalize withdraw_fees_usdcx:
    input r0 as address.public;
    input r1 as u8.public;
    input r2 as u64.public;
    input r3 as test_usdcx_stablecoin.aleo/transfer_public.future;
    is.eq r1 0u8 into r4;
    is.eq r1 1u8 into r5;
    or r4 r5 into r6;
    assert.eq r6 true;
    cast 0field 0u64 false 0u64 0u64 0u64 into r7 as PlatformConfig;
    get.or_use platform_config[0u8] r7 into r8;
    is.neq r8.admin_hash 0field into r9;
    assert.eq r9 true;
    hash.bhp256 r0 into r10 as field;
    assert.eq r10 r8.admin_hash;
    ternary r4 r8.treasury_credits r8.treasury_usdcx into r11;
    lte r2 r11 into r12;
    assert.eq r12 true;
    await r3;
    sub r11 r2 into r13;
    ternary r4 r13 r8.treasury_credits into r14;
    ternary r5 r13 r8.treasury_usdcx into r15;
    cast r8.admin_hash r8.fee_bps r8.paused r14 r15 r8.treasury_usad into r16 as PlatformConfig;
    set r16 into platform_config[0u8];

function create_rfq:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u32.public;
    input r3 as u32.public;
    input r4 as u64.public;
    input r5 as u64.public;
    input r6 as field.public;
    input r7 as u8.public;
    input r8 as u8.public;
    is.neq r0 0field into r9;
    assert.eq r9 true;
    is.neq r1 0field into r10;
    assert.eq r10 true;
    gt r4 0u64 into r11;
    assert.eq r11 true;
    lt r4 1000000000u64 into r12;
    assert.eq r12 true;
    gt r5 0u64 into r13;
    assert.eq r13 true;
    is.neq r6 0field into r14;
    assert.eq r14 true;
    gt r3 r2 into r15;
    assert.eq r15 true;
    lte r7 2u8 into r16;
    assert.eq r16 true;
    lte r8 2u8 into r17;
    assert.eq r17 true;
    cast self.caller r1 into r18 as RFQIdInput;
    hash.bhp256 r18 into r19 as field;
    assert.eq r0 r19;
    mul r4 10u64 into r20;
    div r20 100u64 into r21;
    gt r21 0u64 into r22;
    assert.eq r22 true;
    cast self.caller r0 self.caller r2 r3 r4 r5 r21 r6 into r23 as RFQCreated.record;
    async create_rfq r0 r2 r3 r4 r5 r6 r21 self.caller r7 r8 into r24;
    output r23 as RFQCreated.record;
    output r24 as sealrfq_v18.aleo/create_rfq.future;

finalize create_rfq:
    input r0 as field.public;
    input r1 as u32.public;
    input r2 as u32.public;
    input r3 as u64.public;
    input r4 as u64.public;
    input r5 as field.public;
    input r6 as u64.public;
    input r7 as address.public;
    input r8 as u8.public;
    input r9 as u8.public;
    is.neq r0 0field into r10;
    assert.eq r10 true;
    gt r1 block.height into r11;
    assert.eq r11 true;
    add block.height 100000u32 into r12;
    lte r1 r12 into r13;
    assert.eq r13 true;
    gt r2 block.height into r14;
    assert.eq r14 true;
    lte r2 r12 into r15;
    assert.eq r15 true;
    gt r2 r1 into r16;
    assert.eq r16 true;
    sub r2 r1 into r17;
    gte r17 720u32 into r18;
    assert.eq r18 true;
    get.or_use rfq_status[r0] 0u8 into r19;
    assert.eq r19 0u8;
    cast 0field 0u64 false 0u64 0u64 0u64 into r20 as PlatformConfig;
    get.or_use platform_config[0u8] r20 into r21;
    is.neq r21.admin_hash 0field into r22;
    assert.eq r22 true;
    assert.eq r21.paused false;
    set 1u8 into rfq_status[r0];
    set r1 into rfq_bidding_deadlines[r0];
    set r2 into rfq_reveal_deadlines[r0];
    set r3 into rfq_min_bids[r0];
    set r4 into rfq_min_bid_count[r0];
    set r7 into rfq_creators[r0];
    set 0u64 into rfq_bid_count[r0];
    set 1000000000u64 into rfq_lowest_bid[r0];
    set 0field into rfq_lowest_bid_id[r0];
    set r6 into rfq_flat_stake[r0];
    set r8 into escrow_token[r0];
    set r9 into rfq_mode[r0];

function submit_bid_commit:
    input r0 as field.public;
    input r1 as u64.private;
    input r2 as field.private;
    input r3 as u64.public;
    input r4 as field.public;
    input r5 as u64.public;
    input r6 as u64.public;
    is.neq r4 0field into r7;
    assert.eq r7 true;
    gt r1 0u64 into r8;
    assert.eq r8 true;
    lt r1 1000000000u64 into r9;
    assert.eq r9 true;
    gt r3 0u64 into r10;
    assert.eq r10 true;
    lt r3 1000000000u64 into r11;
    assert.eq r11 true;
    is.neq r2 0field into r12;
    assert.eq r12 true;
    gte r1 r6 into r13;
    assert.eq r13 true;
    cast r1 r2 into r14 as CommitmentInput;
    hash.bhp256 r14 into r15 as field;
    cast self.caller 1u8 r0 into r16 as NonceKey;
    hash.bhp256 r16 into r17 as field;
    cast self.caller r0 into r18 as VendorRFQKey;
    hash.bhp256 r18 into r19 as field;
    cast r0 r4 into r20 as BidKey;
    hash.bhp256 r20 into r21 as field;
    call credits.aleo/transfer_public_as_signer sealrfq_v18.aleo r3 into r22;
    cast self.caller r0 r4 self.caller r3 into r23 as BidCommitted.record;
    async submit_bid_commit r21 r15 r0 r6 r3 r17 r5 self.caller r19 r22 into r24;
    output r23 as BidCommitted.record;
    output r24 as sealrfq_v18.aleo/submit_bid_commit.future;

finalize submit_bid_commit:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as field.public;
    input r3 as u64.public;
    input r4 as u64.public;
    input r5 as field.public;
    input r6 as u64.public;
    input r7 as address.public;
    input r8 as field.public;
    input r9 as credits.aleo/transfer_public_as_signer.future;
    get.or_use actor_nonces[r5] 0u64 into r10;
    add r10 1u64 into r11;
    assert.eq r6 r11;
    get rfq_status[r2] into r12;
    assert.eq r12 1u8;
    get rfq_bidding_deadlines[r2] into r13;
    lt block.height r13 into r14;
    assert.eq r14 true;
    get rfq_min_bids[r2] into r15;
    assert.eq r3 r15;
    get rfq_flat_stake[r2] into r16;
    assert.eq r4 r16;
    get.or_use bid_commitments[r0] 0field into r17;
    assert.eq r17 0field;
    get.or_use vendor_bid_count[r8] 0u64 into r18;
    assert.eq r18 0u64;
    await r9;
    set r1 into bid_commitments[r0];
    set r7 into bid_owner[r0];
    set r4 into bid_stakes[r0];
    set 1u64 into vendor_bid_count[r8];
    get.or_use rfq_bid_count[r2] 0u64 into r19;
    add r19 1u64 into r20;
    set r20 into rfq_bid_count[r2];
    gt r13 40u32 into r21;
    sub r13 40u32 into r22;
    ternary r21 r22 0u32 into r23;
    gt block.height r23 into r24;
    branch.eq r24 false to end_then_0_2;
    add r13 40u32 into r25;
    get rfq_reveal_deadlines[r2] into r26;
    add r26 40u32 into r27;
    set r25 into rfq_bidding_deadlines[r2];
    set r27 into rfq_reveal_deadlines[r2];
    branch.eq true true to end_otherwise_0_3;
    position end_then_0_2;
    position end_otherwise_0_3;
    set r6 into actor_nonces[r5];

function reveal_bid:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u64.private;
    input r3 as field.private;
    input r4 as u64.public;
    gt r2 0u64 into r5;
    assert.eq r5 true;
    lt r2 1000000000u64 into r6;
    assert.eq r6 true;
    is.neq r3 0field into r7;
    assert.eq r7 true;
    cast r2 r3 into r8 as CommitmentInput;
    hash.bhp256 r8 into r9 as field;
    cast self.caller 2u8 r0 into r10 as NonceKey;
    hash.bhp256 r10 into r11 as field;
    cast r0 r1 into r12 as BidKey;
    hash.bhp256 r12 into r13 as field;
    cast self.caller r0 r1 r2 into r14 as BidRevealed.record;
    async reveal_bid r13 r1 r2 r0 r9 r11 r4 self.caller into r15;
    output r14 as BidRevealed.record;
    output r15 as sealrfq_v18.aleo/reveal_bid.future;

finalize reveal_bid:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u64.public;
    input r3 as field.public;
    input r4 as field.public;
    input r5 as field.public;
    input r6 as u64.public;
    input r7 as address.public;
    get.or_use actor_nonces[r5] 0u64 into r8;
    add r8 1u64 into r9;
    assert.eq r6 r9;
    get rfq_status[r3] into r10;
    is.eq r10 1u8 into r11;
    is.eq r10 2u8 into r12;
    or r11 r12 into r13;
    assert.eq r13 true;
    get rfq_bidding_deadlines[r3] into r14;
    branch.eq r11 false to end_then_0_4;
    gte block.height r14 into r15;
    assert.eq r15 true;
    get.or_use rfq_bid_count[r3] 0u64 into r16;
    get rfq_min_bid_count[r3] into r17;
    gte r16 r17 into r18;
    assert.eq r18 true;
    set 2u8 into rfq_status[r3];
    branch.eq true true to end_otherwise_0_5;
    position end_then_0_4;
    position end_otherwise_0_5;
    get rfq_reveal_deadlines[r3] into r19;
    lt block.height r19 into r20;
    assert.eq r20 true;
    get bid_owner[r0] into r21;
    assert.eq r21 r7;
    get.or_use bid_commitments[r0] 0field into r22;
    is.neq r22 0field into r23;
    assert.eq r23 true;
    assert.eq r22 r4;
    get.or_use revealed_bids[r0] 0u64 into r24;
    assert.eq r24 0u64;
    get rfq_min_bids[r3] into r25;
    gte r2 r25 into r26;
    assert.eq r26 true;
    set r2 into revealed_bids[r0];
    get.or_use rfq_lowest_bid[r3] 1000000000u64 into r27;
    get.or_use rfq_lowest_bid_id[r3] 0field into r28;
    lt r2 r27 into r29;
    ternary r29 r2 r27 into r30;
    ternary r29 r1 r28 into r31;
    set r30 into rfq_lowest_bid[r3];
    set r31 into rfq_lowest_bid_id[r3];
    set r6 into actor_nonces[r5];

function select_winner:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u64.public;
    input r3 as address.public;
    is.neq r1 0field into r4;
    assert.eq r4 true;
    gt r2 0u64 into r5;
    assert.eq r5 true;
    is.neq r3 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r6;
    assert.eq r6 true;
    cast r0 r1 into r7 as BidKey;
    hash.bhp256 r7 into r8 as field;
    cast self.caller r0 r1 r3 r2 into r9 as WinnerSelected.record;
    cast r0 r1 r3 into r10 as WinnerCertificateInput;
    hash.bhp256 r10 into r11 as field;
    cast r3 r0 r1 r3 r11 into r12 as WinnerCertificate.record;
    async select_winner r0 r1 r8 r2 r3 self.caller into r13;
    output r9 as WinnerSelected.record;
    output r12 as WinnerCertificate.record;
    output r13 as sealrfq_v18.aleo/select_winner.future;

finalize select_winner:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as field.public;
    input r3 as u64.public;
    input r4 as address.public;
    input r5 as address.public;
    get rfq_creators[r0] into r6;
    assert.eq r5 r6;
    get rfq_status[r0] into r7;
    assert.eq r7 2u8;
    get rfq_reveal_deadlines[r0] into r8;
    gte block.height r8 into r9;
    assert.eq r9 true;
    get.or_use revealed_bids[r2] 0u64 into r10;
    gt r10 0u64 into r11;
    assert.eq r11 true;
    assert.eq r3 r10;
    get rfq_lowest_bid_id[r0] into r12;
    assert.eq r1 r12;
    get bid_owner[r2] into r13;
    assert.eq r4 r13;
    is.neq r13 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r14;
    assert.eq r14 true;
    cast r0 r1 r10 r13 block.height into r15 as RFQSettlementProof;
    hash.bhp256 r15 into r16 as field;
    set r2 into winner_bids[r0];
    set r13 into rfq_winner_address[r0];
    set 3u8 into rfq_status[r0];
    set block.height into rfq_lifecycle_block[r0];
    set false into rfq_winner_accepted[r0];
    cast r0 1u8 into r17 as V16ProofKey;
    hash.bhp256 r17 into r18 as field;
    set r16 into v16_proofs[r18];

function winner_respond:
    input r0 as field.public;
    input r1 as boolean.public;
    input r2 as u64.public;
    input r3 as address.public;
    is.neq r3 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r4;
    assert.eq r4 true;
    gt r2 0u64 into r5;
    assert.eq r5 true;
    ternary r1 self.caller r3 into r6;
    call credits.aleo/transfer_public r6 r2 into r7;
    async winner_respond r0 self.caller r1 r2 r3 r7 into r8;
    output r8 as sealrfq_v18.aleo/winner_respond.future;

finalize winner_respond:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as boolean.public;
    input r3 as u64.public;
    input r4 as address.public;
    input r5 as credits.aleo/transfer_public.future;
    get rfq_status[r0] into r6;
    assert.eq r6 3u8;
    get rfq_winner_address[r0] into r7;
    assert.eq r1 r7;
    get.or_use rfq_winner_accepted[r0] false into r8;
    assert.eq r8 false;
    get winner_bids[r0] into r9;
    get.or_use bid_stakes[r9] 0u64 into r10;
    assert.eq r3 r10;
    gt r3 0u64 into r11;
    assert.eq r11 true;
    get rfq_creators[r0] into r12;
    not r2 into r13;
    branch.eq r13 false to end_then_0_6;
    assert.eq r4 r12;
    branch.eq true true to end_otherwise_0_7;
    position end_then_0_6;
    position end_otherwise_0_7;
    set 0u64 into bid_stakes[r9];
    await r5;
    branch.eq r2 false to end_then_0_8;
    set true into rfq_winner_accepted[r0];
    branch.eq true true to end_otherwise_0_9;
    position end_then_0_8;
    set 7u8 into rfq_status[r0];
    position end_otherwise_0_9;

function winner_respond_imported:
    input r0 as field.public;
    input r1 as boolean.public;
    input r2 as address.public;
    is.neq r2 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r3;
    assert.eq r3 true;
    async winner_respond_imported r0 self.caller r1 r2 into r4;
    output r4 as sealrfq_v18.aleo/winner_respond_imported.future;

finalize winner_respond_imported:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as boolean.public;
    input r3 as address.public;
    get rfq_status[r0] into r4;
    assert.eq r4 3u8;
    get rfq_winner_address[r0] into r5;
    assert.eq r1 r5;
    get.or_use rfq_winner_accepted[r0] false into r6;
    assert.eq r6 false;
    get winner_bids[r0] into r7;
    get.or_use bid_stakes[r7] 0u64 into r8;
    assert.eq r8 0u64;
    get.or_use auction_source[r0] 0field into r9;
    is.neq r9 0field into r10;
    assert.eq r10 true;
    branch.eq r2 false to end_then_0_10;
    set true into rfq_winner_accepted[r0];
    branch.eq true true to end_otherwise_0_11;
    position end_then_0_10;
    get rfq_creators[r0] into r11;
    assert.eq r3 r11;
    set 7u8 into rfq_status[r0];
    position end_otherwise_0_11;

function cancel_rfq_post_deadline:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u8.public;
    cast self.caller r0 r1 into r3 as RFQCancelled.record;
    async cancel_rfq_post_deadline r0 r1 r2 self.caller into r4;
    output r3 as RFQCancelled.record;
    output r4 as sealrfq_v18.aleo/cancel_rfq_post_deadline.future;

finalize cancel_rfq_post_deadline:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u8.public;
    input r3 as address.public;
    get rfq_creators[r0] into r4;
    assert.eq r1 r4;
    is.eq r2 3u8 into r5;
    branch.eq r5 false to end_then_0_12;
    assert.eq r3 r4;
    get rfq_status[r0] into r6;
    assert.eq r6 1u8;
    get rfq_bidding_deadlines[r0] into r7;
    lt block.height r7 into r8;
    assert.eq r8 true;
    branch.eq true true to end_otherwise_0_13;
    position end_then_0_12;
    is.eq r2 0u8 into r9;
    branch.eq r9 false to end_then_1_14;
    get rfq_status[r0] into r10;
    assert.eq r10 1u8;
    get rfq_bidding_deadlines[r0] into r11;
    gte block.height r11 into r12;
    assert.eq r12 true;
    get.or_use rfq_bid_count[r0] 0u64 into r13;
    get rfq_min_bid_count[r0] into r14;
    lt r13 r14 into r15;
    assert.eq r15 true;
    branch.eq true true to end_otherwise_1_15;
    position end_then_1_14;
    is.eq r2 1u8 into r16;
    branch.eq r16 false to end_then_2_16;
    get rfq_status[r0] into r17;
    assert.eq r17 2u8;
    get rfq_reveal_deadlines[r0] into r18;
    add r18 1440u32 into r19;
    gt block.height r19 into r20;
    assert.eq r20 true;
    branch.eq true true to end_otherwise_2_17;
    position end_then_2_16;
    assert.eq r2 2u8;
    get rfq_status[r0] into r21;
    assert.eq r21 3u8;
    get rfq_lifecycle_block[r0] into r22;
    add r22 2160u32 into r23;
    gt block.height r23 into r24;
    assert.eq r24 true;
    position end_otherwise_2_17;
    position end_otherwise_1_15;
    position end_otherwise_0_13;
    set 6u8 into rfq_status[r0];

function refund_any_stake:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u64.public;
    is.neq r1 0field into r3;
    assert.eq r3 true;
    gt r2 0u64 into r4;
    assert.eq r4 true;
    cast r0 r1 into r5 as BidKey;
    hash.bhp256 r5 into r6 as field;
    call credits.aleo/transfer_public self.caller r2 into r7;
    cast self.caller r0 r1 r2 into r8 as StakeRefunded.record;
    async refund_any_stake r0 r6 self.caller r2 r7 into r9;
    output r8 as StakeRefunded.record;
    output r9 as sealrfq_v18.aleo/refund_any_stake.future;

finalize refund_any_stake:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as address.public;
    input r3 as u64.public;
    input r4 as credits.aleo/transfer_public.future;
    get rfq_status[r0] into r5;
    is.eq r5 6u8 into r6;
    branch.eq r6 false to end_then_0_18;
    assert.eq r5 6u8;
    branch.eq true true to end_otherwise_0_19;
    position end_then_0_18;
    gte r5 2u8 into r7;
    assert.eq r7 true;
    get rfq_reveal_deadlines[r0] into r8;
    add r8 1440u32 into r9;
    gt block.height r9 into r10;
    gte r5 3u8 into r11;
    or r11 r10 into r12;
    assert.eq r12 true;
    get.or_use winner_bids[r0] 0field into r13;
    is.neq r1 r13 into r14;
    assert.eq r14 true;
    position end_otherwise_0_19;
    get bid_owner[r1] into r15;
    assert.eq r15 r2;
    get.or_use bid_stakes[r1] 0u64 into r16;
    assert.eq r3 r16;
    gt r3 0u64 into r17;
    assert.eq r17 true;
    set 0u64 into bid_stakes[r1];
    await r4;

function fund_escrow:
    input r0 as field.public;
    input r1 as u64.public;
    gt r1 0u64 into r2;
    assert.eq r2 true;
    lt r1 1000000000u64 into r3;
    assert.eq r3 true;
    call credits.aleo/transfer_public_as_signer sealrfq_v18.aleo r1 into r4;
    cast self.caller r0 r1 into r5 as EscrowFunded.record;
    async fund_escrow r0 r1 self.caller r4 into r6;
    output r5 as EscrowFunded.record;
    output r6 as sealrfq_v18.aleo/fund_escrow.future;

finalize fund_escrow:
    input r0 as field.public;
    input r1 as u64.public;
    input r2 as address.public;
    input r3 as credits.aleo/transfer_public_as_signer.future;
    get rfq_status[r0] into r4;
    assert.eq r4 3u8;
    get escrow_token[r0] into r5;
    assert.eq r5 0u8;
    get rfq_creators[r0] into r6;
    assert.eq r2 r6;
    get.or_use rfq_winner_accepted[r0] false into r7;
    assert.eq r7 true;
    get winner_bids[r0] into r8;
    get revealed_bids[r8] into r9;
    assert.eq r1 r9;
    get rfq_winner_address[r0] into r10;
    is.neq r10 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r11;
    assert.eq r11 true;
    get.or_use escrow_amounts[r0] 0u64 into r12;
    assert.eq r12 0u64;
    await r3;
    set r1 into escrow_original[r0];
    set r1 into escrow_amounts[r0];
    set 0u64 into total_released[r0];
    set false into final_payment_released[r0];
    set block.height into rfq_lifecycle_block[r0];
    set 4u8 into rfq_status[r0];

function release_partial_payment:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u8.public;
    input r4 as u64.public;
    input r5 as u64.public;
    input r6 as u64.public;
    gt r3 0u8 into r7;
    assert.eq r7 true;
    lte r3 100u8 into r8;
    assert.eq r8 true;
    gt r2 0u64 into r9;
    assert.eq r9 true;
    gt r4 0u64 into r10;
    assert.eq r10 true;
    lt r5 10000u64 into r11;
    assert.eq r11 true;
    cast self.caller 3u8 r0 into r12 as NonceKey;
    hash.bhp256 r12 into r13 as field;
    mul r2 r5 into r14;
    div r14 10000u64 into r15;
    sub r2 r15 into r16;
    gt r16 0u64 into r17;
    assert.eq r17 true;
    call credits.aleo/transfer_public r1 r16 into r18;
    async release_partial_payment r0 r3 self.caller r13 r6 r1 r2 r5 r15 r16 r4 r18 into r19;
    cast self.caller r0 r2 r4 r3 into r20 as PartialPaymentReleased.record;
    output r20 as PartialPaymentReleased.record;
    output r19 as sealrfq_v18.aleo/release_partial_payment.future;

finalize release_partial_payment:
    input r0 as field.public;
    input r1 as u8.public;
    input r2 as address.public;
    input r3 as field.public;
    input r4 as u64.public;
    input r5 as address.public;
    input r6 as u64.public;
    input r7 as u64.public;
    input r8 as u64.public;
    input r9 as u64.public;
    input r10 as u64.public;
    input r11 as credits.aleo/transfer_public.future;
    get.or_use actor_nonces[r3] 0u64 into r12;
    add r12 1u64 into r13;
    assert.eq r4 r13;
    get escrow_token[r0] into r14;
    assert.eq r14 0u8;
    get rfq_status[r0] into r15;
    assert.eq r15 4u8;
    get rfq_creators[r0] into r16;
    assert.eq r2 r16;
    get.or_use final_payment_released[r0] false into r17;
    assert.eq r17 false;
    get.or_use paid[r0] false into r18;
    assert.eq r18 false;
    cast 0field 0u64 false 0u64 0u64 0u64 into r19 as PlatformConfig;
    get.or_use platform_config[0u8] r19 into r20;
    is.neq r20.admin_hash 0field into r21;
    assert.eq r21 true;
    assert.eq r7 r20.fee_bps;
    mul r6 r7 into r22;
    div r22 10000u64 into r23;
    assert.eq r8 r23;
    sub r6 r8 into r24;
    assert.eq r9 r24;
    gt r9 0u64 into r25;
    assert.eq r25 true;
    get escrow_amounts[r0] into r26;
    get.or_use total_released[r0] 0u64 into r27;
    get escrow_original[r0] into r28;
    get rfq_winner_address[r0] into r29;
    assert.eq r5 r29;
    cast r1 into r30 as u64;
    mul r26 r30 into r31;
    div r31 100u64 into r32;
    assert.eq r6 r32;
    gt r6 0u64 into r33;
    assert.eq r33 true;
    lte r6 r26 into r34;
    assert.eq r34 true;
    mul r28 1u64 into r35;
    div r35 100u64 into r36;
    gt r36 0u64 into r37;
    ternary r37 r36 1u64 into r38;
    gte r6 r38 into r39;
    assert.eq r39 true;
    add r27 r6 into r40;
    assert.eq r10 r40;
    lte r10 r28 into r41;
    assert.eq r41 true;
    await r11;
    sub r26 r6 into r42;
    add r10 r42 into r43;
    assert.eq r28 r43;
    set r10 into total_released[r0];
    set r42 into escrow_amounts[r0];
    set r4 into actor_nonces[r3];
    add r20.treasury_credits r8 into r44;
    cast r20.admin_hash r20.fee_bps r20.paused r44 r20.treasury_usdcx r20.treasury_usad into r45 as PlatformConfig;
    set r45 into platform_config[0u8];
    is.eq r42 0u64 into r46;
    ternary r46 5u8 4u8 into r47;
    set r47 into rfq_status[r0];
    ternary r46 true false into r48;
    set r48 into final_payment_released[r0];

function release_final_payment:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as u64.public;
    gt r2 0u64 into r5;
    assert.eq r5 true;
    lt r3 10000u64 into r6;
    assert.eq r6 true;
    cast self.caller 3u8 r0 into r7 as NonceKey;
    hash.bhp256 r7 into r8 as field;
    mul r2 r3 into r9;
    div r9 10000u64 into r10;
    sub r2 r10 into r11;
    gt r11 0u64 into r12;
    assert.eq r12 true;
    call credits.aleo/transfer_public self.caller r11 into r13;
    async release_final_payment r0 self.caller r8 r4 r1 r2 r3 r10 r11 r13 into r14;
    cast self.caller r0 r2 into r15 as FinalPaymentReleased.record;
    output r15 as FinalPaymentReleased.record;
    output r14 as sealrfq_v18.aleo/release_final_payment.future;

finalize release_final_payment:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as field.public;
    input r3 as u64.public;
    input r4 as address.public;
    input r5 as u64.public;
    input r6 as u64.public;
    input r7 as u64.public;
    input r8 as u64.public;
    input r9 as credits.aleo/transfer_public.future;
    get.or_use actor_nonces[r2] 0u64 into r10;
    add r10 1u64 into r11;
    assert.eq r3 r11;
    get escrow_token[r0] into r12;
    assert.eq r12 0u8;
    get rfq_status[r0] into r13;
    assert.eq r13 4u8;
    get rfq_creators[r0] into r14;
    assert.eq r1 r14;
    get.or_use final_payment_released[r0] false into r15;
    assert.eq r15 false;
    get.or_use paid[r0] false into r16;
    assert.eq r16 true;
    get.or_use receipts[r0] 0field into r17;
    is.neq r17 0field into r18;
    assert.eq r18 true;
    cast 0field 0u64 false 0u64 0u64 0u64 into r19 as PlatformConfig;
    get.or_use platform_config[0u8] r19 into r20;
    is.neq r20.admin_hash 0field into r21;
    assert.eq r21 true;
    assert.eq r6 r20.fee_bps;
    mul r5 r6 into r22;
    div r22 10000u64 into r23;
    assert.eq r7 r23;
    sub r5 r7 into r24;
    assert.eq r8 r24;
    gt r8 0u64 into r25;
    assert.eq r25 true;
    get rfq_winner_address[r0] into r26;
    assert.eq r4 r26;
    get escrow_amounts[r0] into r27;
    assert.eq r5 r27;
    gt r5 0u64 into r28;
    assert.eq r28 true;
    get.or_use total_released[r0] 0u64 into r29;
    get escrow_original[r0] into r30;
    await r9;
    add r29 r5 into r31;
    assert.eq r30 r31;
    set r31 into total_released[r0];
    set 0u64 into escrow_amounts[r0];
    set true into final_payment_released[r0];
    set 5u8 into rfq_status[r0];
    add r20.treasury_credits r7 into r32;
    cast r20.admin_hash r20.fee_bps r20.paused r32 r20.treasury_usdcx r20.treasury_usad into r33 as PlatformConfig;
    set r33 into platform_config[0u8];
    set r3 into actor_nonces[r2];

function slash_non_revealer:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as u64.public;
    is.neq r1 0field into r3;
    assert.eq r3 true;
    gt r2 0u64 into r4;
    assert.eq r4 true;
    cast r0 r1 into r5 as BidKey;
    hash.bhp256 r5 into r6 as field;
    call credits.aleo/transfer_public self.caller r2 into r7;
    cast self.caller r0 r1 r2 self.caller into r8 as StakeSlashed.record;
    async slash_non_revealer r0 r6 self.caller r2 r7 into r9;
    output r8 as StakeSlashed.record;
    output r9 as sealrfq_v18.aleo/slash_non_revealer.future;

finalize slash_non_revealer:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as address.public;
    input r3 as u64.public;
    input r4 as credits.aleo/transfer_public.future;
    get rfq_status[r0] into r5;
    is.eq r5 2u8 into r6;
    is.eq r5 3u8 into r7;
    or r6 r7 into r8;
    assert.eq r8 true;
    get rfq_creators[r0] into r9;
    assert.eq r2 r9;
    get rfq_reveal_deadlines[r0] into r10;
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

function creator_reclaim_escrow:
    input r0 as field.public;
    input r1 as u64.public;
    gt r1 0u64 into r2;
    assert.eq r2 true;
    call credits.aleo/transfer_public self.caller r1 into r3;
    cast self.caller r0 self.caller r1 into r4 as EscrowReclaimed.record;
    async creator_reclaim_escrow r0 self.caller r1 r3 into r5;
    output r4 as EscrowReclaimed.record;
    output r5 as sealrfq_v18.aleo/creator_reclaim_escrow.future;

finalize creator_reclaim_escrow:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as credits.aleo/transfer_public.future;
    get rfq_status[r0] into r4;
    assert.eq r4 4u8;
    get escrow_token[r0] into r5;
    assert.eq r5 0u8;
    get rfq_creators[r0] into r6;
    assert.eq r1 r6;
    get rfq_lifecycle_block[r0] into r7;
    add r7 2880u32 into r8;
    gt block.height r8 into r9;
    assert.eq r9 true;
    get.or_use final_payment_released[r0] false into r10;
    assert.eq r10 false;
    get.or_use paid[r0] false into r11;
    assert.eq r11 false;
    get escrow_amounts[r0] into r12;
    assert.eq r2 r12;
    gt r2 0u64 into r13;
    assert.eq r13 true;
    set 0u64 into escrow_amounts[r0];
    set true into final_payment_released[r0];
    set 6u8 into rfq_status[r0];
    await r3;

function pay_invoice:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as field.private;
    input r5 as credits.aleo/credits.record;
    is.neq r0 0field into r6;
    assert.eq r6 true;
    gt r2 0u64 into r7;
    assert.eq r7 true;
    lt r2 1000000000u64 into r8;
    assert.eq r8 true;
    is.neq r1 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r9;
    assert.eq r9 true;
    is.neq r4 0field into r10;
    assert.eq r10 true;
    call credits.aleo/transfer_private r5 r1 r2 into r11 r12;
    cast r0 self.caller r1 r2 r4 into r13 as ReceiptInput;
    hash.bhp256 r13 into r14 as field;
    hash.bhp256 r4 into r15 as scalar;
    cast r2 into r16 as field;
    commit.bhp256 r16 r15 into r17 as field;
    cast self.caller r0 r14 r2 into r18 as InvoiceReceipt.record;
    cast self.caller 4u8 r0 into r19 as NonceKey;
    hash.bhp256 r19 into r20 as field;
    async pay_invoice r0 r1 r2 r14 self.caller r20 r3 r17 into r21;
    output r11 as credits.aleo/credits.record;
    output r12 as credits.aleo/credits.record;
    output r18 as InvoiceReceipt.record;
    output r21 as sealrfq_v18.aleo/pay_invoice.future;

finalize pay_invoice:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as field.public;
    input r4 as address.public;
    input r5 as field.public;
    input r6 as u64.public;
    input r7 as field.public;
    get.or_use actor_nonces[r5] 0u64 into r8;
    add r8 1u64 into r9;
    assert.eq r6 r9;
    get escrow_token[r0] into r10;
    assert.eq r10 0u8;
    get rfq_status[r0] into r11;
    assert.eq r11 4u8;
    get rfq_creators[r0] into r12;
    assert.eq r4 r12;
    get rfq_winner_address[r0] into r13;
    assert.eq r1 r13;
    get winner_bids[r0] into r14;
    get revealed_bids[r14] into r15;
    assert.eq r2 r15;
    get.or_use escrow_amounts[r0] 0u64 into r16;
    gt r16 0u64 into r17;
    assert.eq r17 true;
    get.or_use total_released[r0] 0u64 into r18;
    assert.eq r18 0u64;
    get.or_use paid[r0] false into r19;
    assert.eq r19 false;
    set r3 into receipts[r0];
    set true into paid[r0];
    cast r0 2u8 into r20 as V16ProofKey;
    hash.bhp256 r20 into r21 as field;
    set r7 into v16_proofs[r21];
    set r6 into actor_nonces[r5];

function winner_claim_escrow:
    input r0 as field.public;
    input r1 as u64.public;
    input r2 as u8.public;
    gt r1 0u64 into r3;
    assert.eq r3 true;
    call credits.aleo/transfer_public self.caller r1 into r4;
    cast self.caller r0 r1 into r5 as WinnerEscrowClaimed.record;
    async winner_claim_escrow r0 self.caller r1 r2 r4 into r6;
    output r5 as WinnerEscrowClaimed.record;
    output r6 as sealrfq_v18.aleo/winner_claim_escrow.future;

finalize winner_claim_escrow:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u8.public;
    input r4 as credits.aleo/transfer_public.future;
    get rfq_status[r0] into r5;
    assert.eq r5 4u8;
    get escrow_token[r0] into r6;
    assert.eq r6 0u8;
    get.or_use paid[r0] false into r7;
    assert.eq r7 false;
    get.or_use final_payment_released[r0] false into r8;
    assert.eq r8 false;
    get rfq_winner_address[r0] into r9;
    assert.eq r1 r9;
    get rfq_lifecycle_block[r0] into r10;
    add r10 2880u32 into r11;
    gt block.height r11 into r12;
    assert.eq r12 true;
    get escrow_amounts[r0] into r13;
    assert.eq r2 r13;
    gt r2 0u64 into r14;
    assert.eq r14 true;
    get.or_use total_released[r0] 0u64 into r15;
    get escrow_original[r0] into r16;
    is.eq r3 0u8 into r17;
    branch.eq r17 false to end_then_0_20;
    assert.eq r15 0u64;
    branch.eq true true to end_otherwise_0_21;
    position end_then_0_20;
    assert.eq r3 1u8;
    gt r15 0u64 into r18;
    assert.eq r18 true;
    lt r15 r16 into r19;
    assert.eq r19 true;
    position end_otherwise_0_21;
    add r15 r2 into r20;
    ternary r17 r2 r20 into r21;
    assert.eq r16 r21;
    await r4;
    set 0u64 into escrow_amounts[r0];
    set true into final_payment_released[r0];
    set r21 into total_released[r0];
    set 5u8 into rfq_status[r0];

function fund_escrow_usdcx:
    input r0 as field.public;
    input r1 as u64.public;
    gt r1 0u64 into r2;
    assert.eq r2 true;
    lt r1 1000000000u64 into r3;
    assert.eq r3 true;
    cast r1 into r4 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public_as_signer sealrfq_v18.aleo r4 into r5;
    cast self.caller r0 r1 into r6 as EscrowFunded.record;
    async fund_escrow_usdcx r0 r1 self.caller r5 into r7;
    output r6 as EscrowFunded.record;
    output r7 as sealrfq_v18.aleo/fund_escrow_usdcx.future;

finalize fund_escrow_usdcx:
    input r0 as field.public;
    input r1 as u64.public;
    input r2 as address.public;
    input r3 as test_usdcx_stablecoin.aleo/transfer_public_as_signer.future;
    get rfq_status[r0] into r4;
    assert.eq r4 3u8;
    get escrow_token[r0] into r5;
    assert.eq r5 1u8;
    get rfq_creators[r0] into r6;
    assert.eq r2 r6;
    get.or_use rfq_winner_accepted[r0] false into r7;
    assert.eq r7 true;
    get winner_bids[r0] into r8;
    get revealed_bids[r8] into r9;
    assert.eq r1 r9;
    get rfq_winner_address[r0] into r10;
    is.neq r10 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r11;
    assert.eq r11 true;
    get.or_use escrow_amounts[r0] 0u64 into r12;
    assert.eq r12 0u64;
    await r3;
    set r1 into escrow_original[r0];
    set r1 into escrow_amounts[r0];
    set 0u64 into total_released[r0];
    set false into final_payment_released[r0];
    set block.height into rfq_lifecycle_block[r0];
    set 4u8 into rfq_status[r0];

function fund_escrow_usad:
    input r0 as field.public;
    input r1 as u64.public;
    gt r1 0u64 into r2;
    assert.eq r2 true;
    lt r1 1000000000u64 into r3;
    assert.eq r3 true;
    cast r1 into r4 as u128;
    call test_usad_stablecoin.aleo/transfer_public_as_signer sealrfq_v18.aleo r4 into r5;
    cast self.caller r0 r1 into r6 as EscrowFunded.record;
    async fund_escrow_usad r0 r1 self.caller r5 into r7;
    output r6 as EscrowFunded.record;
    output r7 as sealrfq_v18.aleo/fund_escrow_usad.future;

finalize fund_escrow_usad:
    input r0 as field.public;
    input r1 as u64.public;
    input r2 as address.public;
    input r3 as test_usad_stablecoin.aleo/transfer_public_as_signer.future;
    get rfq_status[r0] into r4;
    assert.eq r4 3u8;
    get escrow_token[r0] into r5;
    assert.eq r5 2u8;
    get rfq_creators[r0] into r6;
    assert.eq r2 r6;
    get.or_use rfq_winner_accepted[r0] false into r7;
    assert.eq r7 true;
    get winner_bids[r0] into r8;
    get revealed_bids[r8] into r9;
    assert.eq r1 r9;
    get rfq_winner_address[r0] into r10;
    is.neq r10 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r11;
    assert.eq r11 true;
    get.or_use escrow_amounts[r0] 0u64 into r12;
    assert.eq r12 0u64;
    await r3;
    set r1 into escrow_original[r0];
    set r1 into escrow_amounts[r0];
    set 0u64 into total_released[r0];
    set false into final_payment_released[r0];
    set block.height into rfq_lifecycle_block[r0];
    set 4u8 into rfq_status[r0];

function release_partial_usdcx:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u8.public;
    input r4 as u64.public;
    input r5 as u64.public;
    input r6 as u64.public;
    gt r3 0u8 into r7;
    assert.eq r7 true;
    lte r3 100u8 into r8;
    assert.eq r8 true;
    gt r2 0u64 into r9;
    assert.eq r9 true;
    gt r4 0u64 into r10;
    assert.eq r10 true;
    lt r5 10000u64 into r11;
    assert.eq r11 true;
    cast self.caller 9u8 r0 into r12 as NonceKey;
    hash.bhp256 r12 into r13 as field;
    mul r2 r5 into r14;
    div r14 10000u64 into r15;
    sub r2 r15 into r16;
    gt r16 0u64 into r17;
    assert.eq r17 true;
    cast r16 into r18 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public r1 r18 into r19;
    cast self.caller r0 r2 r4 r3 into r20 as PartialPaymentReleased.record;
    async release_partial_usdcx r0 r3 self.caller r13 r6 r1 r2 r5 r15 r16 r4 r19 into r21;
    output r20 as PartialPaymentReleased.record;
    output r21 as sealrfq_v18.aleo/release_partial_usdcx.future;

finalize release_partial_usdcx:
    input r0 as field.public;
    input r1 as u8.public;
    input r2 as address.public;
    input r3 as field.public;
    input r4 as u64.public;
    input r5 as address.public;
    input r6 as u64.public;
    input r7 as u64.public;
    input r8 as u64.public;
    input r9 as u64.public;
    input r10 as u64.public;
    input r11 as test_usdcx_stablecoin.aleo/transfer_public.future;
    get.or_use actor_nonces[r3] 0u64 into r12;
    add r12 1u64 into r13;
    assert.eq r4 r13;
    get escrow_token[r0] into r14;
    assert.eq r14 1u8;
    get rfq_status[r0] into r15;
    assert.eq r15 4u8;
    get rfq_creators[r0] into r16;
    assert.eq r2 r16;
    get.or_use final_payment_released[r0] false into r17;
    assert.eq r17 false;
    get.or_use paid[r0] false into r18;
    assert.eq r18 false;
    cast 0field 0u64 false 0u64 0u64 0u64 into r19 as PlatformConfig;
    get.or_use platform_config[0u8] r19 into r20;
    is.neq r20.admin_hash 0field into r21;
    assert.eq r21 true;
    assert.eq r7 r20.fee_bps;
    mul r6 r7 into r22;
    div r22 10000u64 into r23;
    assert.eq r8 r23;
    sub r6 r8 into r24;
    assert.eq r9 r24;
    gt r9 0u64 into r25;
    assert.eq r25 true;
    get escrow_amounts[r0] into r26;
    get.or_use total_released[r0] 0u64 into r27;
    get escrow_original[r0] into r28;
    get rfq_winner_address[r0] into r29;
    assert.eq r5 r29;
    cast r1 into r30 as u64;
    mul r26 r30 into r31;
    div r31 100u64 into r32;
    assert.eq r6 r32;
    gt r6 0u64 into r33;
    assert.eq r33 true;
    lte r6 r26 into r34;
    assert.eq r34 true;
    mul r28 1u64 into r35;
    div r35 100u64 into r36;
    gt r36 0u64 into r37;
    ternary r37 r36 1u64 into r38;
    gte r6 r38 into r39;
    assert.eq r39 true;
    add r27 r6 into r40;
    assert.eq r10 r40;
    lte r10 r28 into r41;
    assert.eq r41 true;
    await r11;
    sub r26 r6 into r42;
    set r10 into total_released[r0];
    set r42 into escrow_amounts[r0];
    add r20.treasury_usdcx r8 into r43;
    cast r20.admin_hash r20.fee_bps r20.paused r20.treasury_credits r43 r20.treasury_usad into r44 as PlatformConfig;
    set r44 into platform_config[0u8];
    set r4 into actor_nonces[r3];
    is.eq r42 0u64 into r45;
    ternary r45 5u8 4u8 into r46;
    set r46 into rfq_status[r0];
    ternary r45 true false into r47;
    set r47 into final_payment_released[r0];

function release_partial_usad:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u8.public;
    input r4 as u64.public;
    input r5 as u64.public;
    input r6 as u64.public;
    gt r3 0u8 into r7;
    assert.eq r7 true;
    lte r3 100u8 into r8;
    assert.eq r8 true;
    gt r2 0u64 into r9;
    assert.eq r9 true;
    gt r4 0u64 into r10;
    assert.eq r10 true;
    assert.eq r5 0u64;
    cast self.caller 10u8 r0 into r11 as NonceKey;
    hash.bhp256 r11 into r12 as field;
    gt r2 0u64 into r13;
    assert.eq r13 true;
    cast r2 into r14 as u128;
    call test_usad_stablecoin.aleo/transfer_public r1 r14 into r15;
    cast self.caller r0 r2 r4 r3 into r16 as PartialPaymentReleased.record;
    async release_partial_usad r0 r3 self.caller r12 r6 r1 r2 r5 0u64 r2 r4 r15 into r17;
    output r16 as PartialPaymentReleased.record;
    output r17 as sealrfq_v18.aleo/release_partial_usad.future;

finalize release_partial_usad:
    input r0 as field.public;
    input r1 as u8.public;
    input r2 as address.public;
    input r3 as field.public;
    input r4 as u64.public;
    input r5 as address.public;
    input r6 as u64.public;
    input r7 as u64.public;
    input r8 as u64.public;
    input r9 as u64.public;
    input r10 as u64.public;
    input r11 as test_usad_stablecoin.aleo/transfer_public.future;
    get.or_use actor_nonces[r3] 0u64 into r12;
    add r12 1u64 into r13;
    assert.eq r4 r13;
    get escrow_token[r0] into r14;
    assert.eq r14 2u8;
    get rfq_status[r0] into r15;
    assert.eq r15 4u8;
    get rfq_creators[r0] into r16;
    assert.eq r2 r16;
    get.or_use final_payment_released[r0] false into r17;
    assert.eq r17 false;
    get.or_use paid[r0] false into r18;
    assert.eq r18 false;
    cast 0field 0u64 false 0u64 0u64 0u64 into r19 as PlatformConfig;
    get.or_use platform_config[0u8] r19 into r20;
    is.neq r20.admin_hash 0field into r21;
    assert.eq r21 true;
    assert.eq r7 0u64;
    assert.eq r8 0u64;
    assert.eq r9 r6;
    gt r9 0u64 into r22;
    assert.eq r22 true;
    get escrow_amounts[r0] into r23;
    get.or_use total_released[r0] 0u64 into r24;
    get escrow_original[r0] into r25;
    get rfq_winner_address[r0] into r26;
    assert.eq r5 r26;
    cast r1 into r27 as u64;
    mul r23 r27 into r28;
    div r28 100u64 into r29;
    assert.eq r6 r29;
    gt r6 0u64 into r30;
    assert.eq r30 true;
    lte r6 r23 into r31;
    assert.eq r31 true;
    mul r25 1u64 into r32;
    div r32 100u64 into r33;
    gt r33 0u64 into r34;
    ternary r34 r33 1u64 into r35;
    gte r6 r35 into r36;
    assert.eq r36 true;
    add r24 r6 into r37;
    assert.eq r10 r37;
    lte r10 r25 into r38;
    assert.eq r38 true;
    await r11;
    sub r23 r6 into r39;
    set r10 into total_released[r0];
    set r39 into escrow_amounts[r0];
    cast r20.admin_hash r20.fee_bps r20.paused r20.treasury_credits r20.treasury_usdcx r20.treasury_usad into r40 as PlatformConfig;
    set r40 into platform_config[0u8];
    set r4 into actor_nonces[r3];
    is.eq r39 0u64 into r41;
    ternary r41 5u8 4u8 into r42;
    set r42 into rfq_status[r0];
    ternary r41 true false into r43;
    set r43 into final_payment_released[r0];

function release_final_usdcx:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as u64.public;
    gt r2 0u64 into r5;
    assert.eq r5 true;
    lt r3 10000u64 into r6;
    assert.eq r6 true;
    cast self.caller 5u8 r0 into r7 as NonceKey;
    hash.bhp256 r7 into r8 as field;
    mul r2 r3 into r9;
    div r9 10000u64 into r10;
    sub r2 r10 into r11;
    gt r11 0u64 into r12;
    assert.eq r12 true;
    cast r11 into r13 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public self.caller r13 into r14;
    cast self.caller r0 r2 into r15 as FinalPaymentReleased.record;
    async release_final_usdcx r0 self.caller r8 r4 r1 r2 r3 r10 r11 r14 into r16;
    output r15 as FinalPaymentReleased.record;
    output r16 as sealrfq_v18.aleo/release_final_usdcx.future;

finalize release_final_usdcx:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as field.public;
    input r3 as u64.public;
    input r4 as address.public;
    input r5 as u64.public;
    input r6 as u64.public;
    input r7 as u64.public;
    input r8 as u64.public;
    input r9 as test_usdcx_stablecoin.aleo/transfer_public.future;
    get.or_use actor_nonces[r2] 0u64 into r10;
    add r10 1u64 into r11;
    assert.eq r3 r11;
    get escrow_token[r0] into r12;
    assert.eq r12 1u8;
    get rfq_status[r0] into r13;
    assert.eq r13 4u8;
    get rfq_creators[r0] into r14;
    assert.eq r1 r14;
    get.or_use final_payment_released[r0] false into r15;
    assert.eq r15 false;
    get.or_use paid[r0] false into r16;
    assert.eq r16 true;
    get.or_use receipts[r0] 0field into r17;
    is.neq r17 0field into r18;
    assert.eq r18 true;
    cast 0field 0u64 false 0u64 0u64 0u64 into r19 as PlatformConfig;
    get.or_use platform_config[0u8] r19 into r20;
    is.neq r20.admin_hash 0field into r21;
    assert.eq r21 true;
    assert.eq r6 r20.fee_bps;
    mul r5 r6 into r22;
    div r22 10000u64 into r23;
    assert.eq r7 r23;
    sub r5 r7 into r24;
    assert.eq r8 r24;
    gt r8 0u64 into r25;
    assert.eq r25 true;
    get rfq_winner_address[r0] into r26;
    assert.eq r4 r26;
    get escrow_amounts[r0] into r27;
    assert.eq r5 r27;
    gt r5 0u64 into r28;
    assert.eq r28 true;
    get.or_use total_released[r0] 0u64 into r29;
    get escrow_original[r0] into r30;
    await r9;
    add r29 r5 into r31;
    assert.eq r30 r31;
    set r31 into total_released[r0];
    set 0u64 into escrow_amounts[r0];
    set true into final_payment_released[r0];
    set 5u8 into rfq_status[r0];
    add r20.treasury_usdcx r7 into r32;
    cast r20.admin_hash r20.fee_bps r20.paused r20.treasury_credits r32 r20.treasury_usad into r33 as PlatformConfig;
    set r33 into platform_config[0u8];
    set r3 into actor_nonces[r2];

function release_final_usad:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as u64.public;
    gt r2 0u64 into r5;
    assert.eq r5 true;
    assert.eq r3 0u64;
    cast self.caller 7u8 r0 into r6 as NonceKey;
    hash.bhp256 r6 into r7 as field;
    gt r2 0u64 into r8;
    assert.eq r8 true;
    cast r2 into r9 as u128;
    call test_usad_stablecoin.aleo/transfer_public self.caller r9 into r10;
    cast self.caller r0 r2 into r11 as FinalPaymentReleased.record;
    async release_final_usad r0 self.caller r7 r4 r1 r2 r3 0u64 r2 r10 into r12;
    output r11 as FinalPaymentReleased.record;
    output r12 as sealrfq_v18.aleo/release_final_usad.future;

finalize release_final_usad:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as field.public;
    input r3 as u64.public;
    input r4 as address.public;
    input r5 as u64.public;
    input r6 as u64.public;
    input r7 as u64.public;
    input r8 as u64.public;
    input r9 as test_usad_stablecoin.aleo/transfer_public.future;
    get.or_use actor_nonces[r2] 0u64 into r10;
    add r10 1u64 into r11;
    assert.eq r3 r11;
    get escrow_token[r0] into r12;
    assert.eq r12 2u8;
    get rfq_status[r0] into r13;
    assert.eq r13 4u8;
    get rfq_creators[r0] into r14;
    assert.eq r1 r14;
    get.or_use final_payment_released[r0] false into r15;
    assert.eq r15 false;
    get.or_use paid[r0] false into r16;
    assert.eq r16 true;
    get.or_use receipts[r0] 0field into r17;
    is.neq r17 0field into r18;
    assert.eq r18 true;
    cast 0field 0u64 false 0u64 0u64 0u64 into r19 as PlatformConfig;
    get.or_use platform_config[0u8] r19 into r20;
    is.neq r20.admin_hash 0field into r21;
    assert.eq r21 true;
    assert.eq r6 0u64;
    assert.eq r7 0u64;
    assert.eq r8 r5;
    gt r8 0u64 into r22;
    assert.eq r22 true;
    get rfq_winner_address[r0] into r23;
    assert.eq r4 r23;
    get escrow_amounts[r0] into r24;
    assert.eq r5 r24;
    gt r5 0u64 into r25;
    assert.eq r25 true;
    get.or_use total_released[r0] 0u64 into r26;
    get escrow_original[r0] into r27;
    await r9;
    add r26 r5 into r28;
    assert.eq r27 r28;
    set r28 into total_released[r0];
    set 0u64 into escrow_amounts[r0];
    set true into final_payment_released[r0];
    set 5u8 into rfq_status[r0];
    cast r20.admin_hash r20.fee_bps r20.paused r20.treasury_credits r20.treasury_usdcx r20.treasury_usad into r29 as PlatformConfig;
    set r29 into platform_config[0u8];
    set r3 into actor_nonces[r2];

function record_invoice_usdcx:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as field.public;
    input r5 as address.public;
    input r6 as field.public;
    assert.eq self.caller aleo1jkntdh4qx3la7rp8qkrta35cxyf8tsl5dn8cpj60a7sklm968y9qndqza5;
    is.neq r0 0field into r7;
    assert.eq r7 true;
    gt r2 0u64 into r8;
    assert.eq r8 true;
    lt r2 1000000000u64 into r9;
    assert.eq r9 true;
    is.neq r1 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r10;
    assert.eq r10 true;
    is.neq r4 0field into r11;
    assert.eq r11 true;
    is.neq r6 0field into r12;
    assert.eq r12 true;
    async record_invoice_usdcx r0 r1 r2 r3 r4 r5 r6 1u8 6u8 into r13;
    output r13 as sealrfq_v18.aleo/record_invoice_usdcx.future;

finalize record_invoice_usdcx:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as field.public;
    input r5 as address.public;
    input r6 as field.public;
    input r7 as u8.public;
    input r8 as u8.public;
    is.neq r5 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r9;
    assert.eq r9 true;
    cast r5 r8 r0 into r10 as NonceKey;
    hash.bhp256 r10 into r11 as field;
    get.or_use actor_nonces[r11] 0u64 into r12;
    add r12 1u64 into r13;
    assert.eq r3 r13;
    get escrow_token[r0] into r14;
    assert.eq r14 r7;
    get rfq_status[r0] into r15;
    assert.eq r15 4u8;
    get rfq_creators[r0] into r16;
    assert.eq r5 r16;
    get rfq_winner_address[r0] into r17;
    assert.eq r1 r17;
    get winner_bids[r0] into r18;
    get revealed_bids[r18] into r19;
    assert.eq r2 r19;
    get.or_use escrow_amounts[r0] 0u64 into r20;
    gt r20 0u64 into r21;
    assert.eq r21 true;
    get.or_use total_released[r0] 0u64 into r22;
    assert.eq r22 0u64;
    get.or_use paid[r0] false into r23;
    assert.eq r23 false;
    cast r0 2u8 into r24 as V16ProofKey;
    hash.bhp256 r24 into r25 as field;
    set r4 into receipts[r0];
    set true into paid[r0];
    set r6 into v16_proofs[r25];
    set r3 into actor_nonces[r11];

function record_invoice_usad:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as field.public;
    input r5 as address.public;
    input r6 as field.public;
    assert.eq self.caller aleo1jkntdh4qx3la7rp8qkrta35cxyf8tsl5dn8cpj60a7sklm968y9qndqza5;
    is.neq r0 0field into r7;
    assert.eq r7 true;
    gt r2 0u64 into r8;
    assert.eq r8 true;
    lt r2 1000000000u64 into r9;
    assert.eq r9 true;
    is.neq r1 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r10;
    assert.eq r10 true;
    is.neq r4 0field into r11;
    assert.eq r11 true;
    is.neq r6 0field into r12;
    assert.eq r12 true;
    async record_invoice_usad r0 r1 r2 r3 r4 r5 r6 2u8 8u8 into r13;
    output r13 as sealrfq_v18.aleo/record_invoice_usad.future;

finalize record_invoice_usad:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as field.public;
    input r5 as address.public;
    input r6 as field.public;
    input r7 as u8.public;
    input r8 as u8.public;
    is.neq r5 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r9;
    assert.eq r9 true;
    cast r5 r8 r0 into r10 as NonceKey;
    hash.bhp256 r10 into r11 as field;
    get.or_use actor_nonces[r11] 0u64 into r12;
    add r12 1u64 into r13;
    assert.eq r3 r13;
    get escrow_token[r0] into r14;
    assert.eq r14 r7;
    get rfq_status[r0] into r15;
    assert.eq r15 4u8;
    get rfq_creators[r0] into r16;
    assert.eq r5 r16;
    get rfq_winner_address[r0] into r17;
    assert.eq r1 r17;
    get winner_bids[r0] into r18;
    get revealed_bids[r18] into r19;
    assert.eq r2 r19;
    get.or_use escrow_amounts[r0] 0u64 into r20;
    gt r20 0u64 into r21;
    assert.eq r21 true;
    get.or_use total_released[r0] 0u64 into r22;
    assert.eq r22 0u64;
    get.or_use paid[r0] false into r23;
    assert.eq r23 false;
    cast r0 2u8 into r24 as V16ProofKey;
    hash.bhp256 r24 into r25 as field;
    set r4 into receipts[r0];
    set true into paid[r0];
    set r6 into v16_proofs[r25];
    set r3 into actor_nonces[r11];

function creator_reclaim_escrow_usdcx:
    input r0 as field.public;
    input r1 as u64.public;
    gt r1 0u64 into r2;
    assert.eq r2 true;
    cast r1 into r3 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public self.caller r3 into r4;
    cast self.caller r0 self.caller r1 into r5 as EscrowReclaimed.record;
    async creator_reclaim_escrow_usdcx r0 self.caller r1 r4 into r6;
    output r5 as EscrowReclaimed.record;
    output r6 as sealrfq_v18.aleo/creator_reclaim_escrow_usdcx.future;

finalize creator_reclaim_escrow_usdcx:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as test_usdcx_stablecoin.aleo/transfer_public.future;
    get rfq_status[r0] into r4;
    assert.eq r4 4u8;
    get escrow_token[r0] into r5;
    assert.eq r5 1u8;
    get rfq_creators[r0] into r6;
    assert.eq r1 r6;
    get rfq_lifecycle_block[r0] into r7;
    add r7 2880u32 into r8;
    gt block.height r8 into r9;
    assert.eq r9 true;
    get.or_use final_payment_released[r0] false into r10;
    assert.eq r10 false;
    get.or_use paid[r0] false into r11;
    assert.eq r11 false;
    get escrow_amounts[r0] into r12;
    assert.eq r2 r12;
    gt r2 0u64 into r13;
    assert.eq r13 true;
    set 0u64 into escrow_amounts[r0];
    set true into final_payment_released[r0];
    set 6u8 into rfq_status[r0];
    await r3;

function creator_reclaim_escrow_usad:
    input r0 as field.public;
    input r1 as u64.public;
    gt r1 0u64 into r2;
    assert.eq r2 true;
    cast r1 into r3 as u128;
    call test_usad_stablecoin.aleo/transfer_public self.caller r3 into r4;
    cast self.caller r0 self.caller r1 into r5 as EscrowReclaimed.record;
    async creator_reclaim_escrow_usad r0 self.caller r1 r4 into r6;
    output r5 as EscrowReclaimed.record;
    output r6 as sealrfq_v18.aleo/creator_reclaim_escrow_usad.future;

finalize creator_reclaim_escrow_usad:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as test_usad_stablecoin.aleo/transfer_public.future;
    get rfq_status[r0] into r4;
    assert.eq r4 4u8;
    get escrow_token[r0] into r5;
    assert.eq r5 2u8;
    get rfq_creators[r0] into r6;
    assert.eq r1 r6;
    get rfq_lifecycle_block[r0] into r7;
    add r7 2880u32 into r8;
    gt block.height r8 into r9;
    assert.eq r9 true;
    get.or_use final_payment_released[r0] false into r10;
    assert.eq r10 false;
    get.or_use paid[r0] false into r11;
    assert.eq r11 false;
    get escrow_amounts[r0] into r12;
    assert.eq r2 r12;
    gt r2 0u64 into r13;
    assert.eq r13 true;
    set 0u64 into escrow_amounts[r0];
    set true into final_payment_released[r0];
    set 6u8 into rfq_status[r0];
    await r3;

function winner_claim_usdcx:
    input r0 as field.public;
    input r1 as u64.public;
    input r2 as u8.public;
    gt r1 0u64 into r3;
    assert.eq r3 true;
    cast r1 into r4 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public self.caller r4 into r5;
    cast self.caller r0 r1 into r6 as WinnerEscrowClaimed.record;
    async winner_claim_usdcx r0 self.caller r1 r2 r5 into r7;
    output r6 as WinnerEscrowClaimed.record;
    output r7 as sealrfq_v18.aleo/winner_claim_usdcx.future;

finalize winner_claim_usdcx:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u8.public;
    input r4 as test_usdcx_stablecoin.aleo/transfer_public.future;
    get rfq_status[r0] into r5;
    assert.eq r5 4u8;
    get escrow_token[r0] into r6;
    assert.eq r6 1u8;
    get.or_use paid[r0] false into r7;
    assert.eq r7 false;
    get.or_use final_payment_released[r0] false into r8;
    assert.eq r8 false;
    get rfq_winner_address[r0] into r9;
    assert.eq r1 r9;
    get rfq_lifecycle_block[r0] into r10;
    add r10 2880u32 into r11;
    gt block.height r11 into r12;
    assert.eq r12 true;
    get escrow_amounts[r0] into r13;
    assert.eq r2 r13;
    gt r2 0u64 into r14;
    assert.eq r14 true;
    get.or_use total_released[r0] 0u64 into r15;
    get escrow_original[r0] into r16;
    is.eq r3 0u8 into r17;
    branch.eq r17 false to end_then_0_22;
    assert.eq r15 0u64;
    branch.eq true true to end_otherwise_0_23;
    position end_then_0_22;
    assert.eq r3 1u8;
    gt r15 0u64 into r18;
    assert.eq r18 true;
    lt r15 r16 into r19;
    assert.eq r19 true;
    position end_otherwise_0_23;
    add r15 r2 into r20;
    ternary r17 r2 r20 into r21;
    assert.eq r16 r21;
    await r4;
    set 0u64 into escrow_amounts[r0];
    set true into final_payment_released[r0];
    set r21 into total_released[r0];
    set 5u8 into rfq_status[r0];

function winner_claim_usad:
    input r0 as field.public;
    input r1 as u64.public;
    input r2 as u8.public;
    gt r1 0u64 into r3;
    assert.eq r3 true;
    cast r1 into r4 as u128;
    call test_usad_stablecoin.aleo/transfer_public self.caller r4 into r5;
    cast self.caller r0 r1 into r6 as WinnerEscrowClaimed.record;
    async winner_claim_usad r0 self.caller r1 r2 r5 into r7;
    output r6 as WinnerEscrowClaimed.record;
    output r7 as sealrfq_v18.aleo/winner_claim_usad.future;

finalize winner_claim_usad:
    input r0 as field.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u8.public;
    input r4 as test_usad_stablecoin.aleo/transfer_public.future;
    get rfq_status[r0] into r5;
    assert.eq r5 4u8;
    get escrow_token[r0] into r6;
    assert.eq r6 2u8;
    get.or_use paid[r0] false into r7;
    assert.eq r7 false;
    get.or_use final_payment_released[r0] false into r8;
    assert.eq r8 false;
    get rfq_winner_address[r0] into r9;
    assert.eq r1 r9;
    get rfq_lifecycle_block[r0] into r10;
    add r10 2880u32 into r11;
    gt block.height r11 into r12;
    assert.eq r12 true;
    get escrow_amounts[r0] into r13;
    assert.eq r2 r13;
    gt r2 0u64 into r14;
    assert.eq r14 true;
    get.or_use total_released[r0] 0u64 into r15;
    get escrow_original[r0] into r16;
    is.eq r3 0u8 into r17;
    branch.eq r17 false to end_then_0_24;
    assert.eq r15 0u64;
    branch.eq true true to end_otherwise_0_25;
    position end_then_0_24;
    assert.eq r3 1u8;
    gt r15 0u64 into r18;
    assert.eq r18 true;
    lt r15 r16 into r19;
    assert.eq r19 true;
    position end_otherwise_0_25;
    add r15 r2 into r20;
    ternary r17 r2 r20 into r21;
    assert.eq r16 r21;
    await r4;
    set 0u64 into escrow_amounts[r0];
    set true into final_payment_released[r0];
    set r21 into total_released[r0];
    set 5u8 into rfq_status[r0];

function import_auction_result:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as address.public;
    input r3 as u64.public;
    input r4 as u8.public;
    is.neq r0 0field into r5;
    assert.eq r5 true;
    is.neq r1 0field into r6;
    assert.eq r6 true;
    gt r3 0u64 into r7;
    assert.eq r7 true;
    is.neq r2 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r8;
    assert.eq r8 true;
    is.eq r4 1u8 into r9;
    is.eq r4 2u8 into r10;
    or r9 r10 into r11;
    assert.eq r11 true;
    cast self.caller r0 r2 r3 r4 into r12 as AuctionImported.record;
    async import_auction_result r0 r1 r2 r3 r4 self.caller into r13;
    output r12 as AuctionImported.record;
    output r13 as sealrfq_v18.aleo/import_auction_result.future;

finalize import_auction_result:
    input r0 as field.public;
    input r1 as field.public;
    input r2 as address.public;
    input r3 as u64.public;
    input r4 as u8.public;
    input r5 as address.public;
    get rfq_creators[r0] into r6;
    assert.eq r5 r6;
    get rfq_status[r0] into r7;
    assert.eq r7 1u8;
    get.or_use rfq_bid_count[r0] 0u64 into r8;
    assert.eq r8 0u64;
    get rfq_mode[r0] into r9;
    assert.eq r9 r4;
    is.neq r9 0u8 into r10;
    assert.eq r10 true;
    get.or_use auction_source[r0] 0field into r11;
    assert.eq r11 0field;
    get.or_use rfq_winner_address[r0] aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc into r12;
    assert.eq r12 aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc;
    get rfq_reveal_deadlines[r0] into r13;
    lte block.height r13 into r14;
    assert.eq r14 true;
    cast r0 r1 into r15 as BidKey;
    hash.bhp256 r15 into r16 as field;
    cast r1 r0 r2 r3 into r17 as ResultHashInput;
    hash.bhp256 r17 into r18 as field;
    set r18 into auction_source[r0];
    set r16 into winner_bids[r0];
    set r2 into rfq_winner_address[r0];
    set 3u8 into rfq_status[r0];
    set block.height into rfq_lifecycle_block[r0];
    set false into rfq_winner_accepted[r0];
    set r3 into revealed_bids[r16];
    set r2 into bid_owner[r16];

constructor:
    assert.eq edition 0u16;
