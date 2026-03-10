# Program Documentation

## Overview

SealRFQ's protocol logic is implemented as Leo programs on Aleo.

The program is responsible for enforcing the sealed-bid lifecycle itself:

- RFQ creation
- bid commitment
- bid reveal
- winner selection
- winner acceptance and decline handling
- escrow funding
- partial and final payment release
- refunds, slashing, and timeout recovery

The repository contains two program variants:

- `contracts/v9/src/main.leo` for short demo-oriented timing windows
- `contracts/v10/src/main.leo` for production-oriented timing windows on testnet and future mainnet deployment

## Source Map

Primary program sources:

```text
contracts/v10/src/main.leo
contracts/v10/program.json
contracts/v9/src/main.leo
contracts/v9/program.json
```

The production-oriented contract is `sealrfq_v10.aleo`.

## Protocol Model

The program implements a three-phase procurement model.

### 1. Commit

The buyer creates an RFQ with deadlines, minimum bid, minimum bid count, and a metadata hash.

Vendors submit:

- RFQ identifier
- private bid amount
- private nonce
- flat stake
- bid identifier
- replay-protection nonce
- claimed minimum bid

The contract stores the commitment and stake-related state while preserving bid confidentiality during the commit phase.

### 2. Reveal

After bidding closes, the vendor reveals the original bid amount and nonce.

The program recomputes the commitment and verifies it against the stored on-chain commitment. It then records the revealed amount and updates the running lowest-bid tracker.

### 3. Settle

After the reveal window closes, the winner can be selected against the lowest revealed bid. The selected winner must explicitly accept. The buyer then funds escrow, and payments are released through defined transitions. Recovery paths exist for decline, no-escrow timeout, stuck reveal, non-revealers, and long-tail escrow recovery.

## Privacy Model

The contract's privacy properties are based on a combination of Aleo's execution model and Leo transition design.

### Private Bid Inputs

In `submit_bid_commit`, the bid amount and nonce are private inputs. They are used inside the transition to compute a commitment and to prove bid validity relative to the minimum bid without publishing the amount at commit time.

This is one of the central reasons the program is well matched to Aleo.

### Commitment Scheme

The commitment is generated through:

- `BHP256::hash_to_field`
- a `CommitmentInput` struct containing `bid_amount` and `nonce`

This lets the program bind the later reveal to the earlier commit.

### Flat Stake Design

The stake is derived from the RFQ minimum bid rather than from the bidder's private amount.

This matters because it removes one obvious public leakage vector. If the stake tracked the private bid directly, public payment amounts would disclose ordering information before reveal.

### Record Ownership

The program defines records such as:

- `RFQCreated`
- `BidCommitted`
- `BidRevealed`
- `WinnerSelected`
- `EscrowFunded`

These records fit naturally into Aleo's private ownership model while the protocol's public state is maintained through mappings.

## On-Chain State

The program uses mappings to track protocol state across RFQs, bids, escrow, and replay protection.

Important mapping groups include:

### RFQ Lifecycle State

- `rfq_status`
- `rfq_bidding_deadlines`
- `rfq_reveal_deadlines`
- `rfq_min_bids`
- `rfq_min_bid_count`
- `rfq_creators`
- `rfq_bid_count`
- `rfq_winner_address`
- `rfq_revealed_count`

### Bid State

- `bid_commitments`
- `bid_owner`
- `revealed_bids`
- `bid_stakes`
- `winner_bids`
- `vendor_bid_count`

### Escrow and Settlement State

- `escrow_original`
- `escrow_amounts`
- `total_released`
- `final_payment_released`
- `rfq_winner_accepted`

### Replay Protection

- `actor_commit_nonces`
- `actor_reveal_nonces`
- `actor_payment_nonces`

This is a notable part of the design. The contract does not treat replay protection as a wallet concern alone. It models sequential per-actor nonces inside protocol state.

## State Machine

The contract defines explicit status codes:

- `STATUS_OPEN`
- `STATUS_REVEAL`
- `STATUS_WINNER_SELECTED`
- `STATUS_ESCROW_FUNDED`
- `STATUS_COMPLETED`
- `STATUS_CANCELLED`
- `STATUS_WINNER_DECLINED`

The program's lifecycle is therefore not an emergent set of transitions. It is a defined protocol state machine with explicit phase boundaries and recovery states.

## Transition Groups

The transitions can be understood in functional groups.

### RFQ Lifecycle

- `create_rfq`
- `close_bidding`
- `cancel_rfq`
- `cancel_rfq_insufficient_bids`
- `cancel_rfq_stuck_reveal`
- `cancel_rfq_no_escrow`

### Bid Lifecycle

- `submit_bid_commit`
- `reveal_bid`
- `select_winner`
- `winner_accept`
- `winner_decline`

### Escrow and Payment

- `fund_escrow`
- `release_partial_payment`
- `release_final_payment`
- `creator_reclaim_escrow`

### Stake and Recovery Paths

- `refund_stake_declined`
- `refund_stake_cancelled`
- `reclaim_unrevealed_stake`
- `slash_non_revealer`
- `refund_stake`
- `release_winner_stake`
- `claim_locked_winner_stake`

## Payment Model

The contract uses `credits.aleo` for stake movement, escrow funding, refunds, and payout release.

The payment primitives are:

- `credits.aleo/transfer_public_as_signer` when value is moved into the protocol-controlled flow
- `credits.aleo/transfer_public` when value is distributed back out to participants

This is used for:

- stake deposits
- escrow funding
- refunds
- slashing
- partial payment release
- final payment release
- escrow reclaim and winner stake release

## Aleo-Specific Design Characteristics

The program makes use of Aleo in ways that are native rather than cosmetic.

### ZK-Aware Validation

The commit transition separates what needs to be proven privately from what needs to be verified publicly in finalize. In practice this means:

- the bid stays private during commit
- the chain still enforces consistency with the RFQ minimum bid

### Async Transition and Finalize Pattern

The contract uses Leo's async transition and finalize model extensively. This is important because it allows:

- private computation in the transition phase
- public state mutation in finalize
- synchronization with `credits.aleo` transfers through awaited futures

### Protocol-Level Recovery Paths

The contract is not limited to the happy path. It includes explicit transitions for failure, timeout, and non-cooperative behavior.

This is a meaningful design characteristic because procurement protocols fail in practice at phase boundaries: non-revealers, declined awards, unfunded escrows, and abandoned settlement are all treated as first-class protocol states.

## Contract Variant Strategy

The repository keeps two timing profiles:

### `v9`

Used for demonstration and short-cycle execution. The shorter windows make it suitable for walkthroughs, demos, and recorded end-to-end flows.

### `v10`

Used for production-oriented timing. The longer windows are more appropriate for real user interaction and operational use on testnet and future mainnet deployment.

## Architectural Characteristics

The Leo program combines privacy, state-machine discipline, and settlement logic in one contract family.

Its notable characteristics are:

- commit-reveal bidding with private bid inputs
- flat-stake design to reduce public information leakage
- explicit winner-accept gate before escrow funding
- sequential on-chain replay protection
- full stake and escrow recovery paths
- use of native Aleo payment primitives rather than synthetic bookkeeping only

## Relevant Files by Concern

```text
Production-oriented contract
  contracts/v10/src/main.leo
  contracts/v10/program.json

Demo-oriented contract
  contracts/v9/src/main.leo
  contracts/v9/program.json
```
