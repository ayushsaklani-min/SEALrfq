# SealRFQ

SealRFQ is a sealed-bid procurement product built on Aleo. It is designed for procurement workflows where bid confidentiality, deterministic winner selection, and controlled escrow settlement need to be enforced by protocol logic rather than by platform trust.

The product combines three layers:

- A privacy-preserving Leo program for bid commitment, reveal, winner selection, and escrow settlement
- A backend that indexes and serves protocol state through authenticated APIs
- A frontend that exposes buyer, vendor, auditor, and escrow flows through a complete wallet-driven interface

## The Problem

Conventional procurement systems have a structural trust problem.

Before the bidding window closes, bid access usually depends on internal permissions and operational controls. In practice, that creates room for information leakage, preferential treatment, bid shopping, and disputes around whether a winner was actually selected according to the published rules.

The payment side has a parallel problem. Even when bidding is complete, settlement still relies on off-chain coordination between buyers, vendors, finance teams, and intermediaries. That introduces delay, ambiguity, and inconsistent auditability.

For high-value RFQs, the issue is not a lack of software. The issue is that the core process still depends on trusting an operator.

## The Product

SealRFQ addresses procurement as a protocol problem.

Buyers create RFQs with deadlines, minimum bid requirements, and item metadata. Vendors submit sealed commitments rather than visible bid amounts. After bidding closes, vendors reveal their bids against the original commitment. Winner selection is validated against on-chain state, and settlement continues through escrow funding and payment release transitions.

The product currently supports:

- Buyer RFQ creation and lifecycle management
- Vendor commit and reveal flows
- Winner selection and explicit winner acceptance
- Escrow funding and staged payment release
- Auditor-facing traceability across transaction and protocol state

## Why Aleo

SealRFQ is built on Aleo because Aleo provides privacy at the execution layer.

In the bidding phase, the bid amount and nonce are handled as private inputs to the Leo transition. The chain stores the commitment, not the raw amount. This allows the protocol to preserve bid confidentiality during commit while still enforcing correctness during reveal and settlement.

Aleo is also a good fit for this product because:

- The record model supports private ownership semantics
- Leo supports ZK-aware contract design without external privacy infrastructure
- The async transition and finalize model works well for multi-phase protocol logic
- `credits.aleo` provides a native settlement path for stake handling and escrow release

## How SealRFQ Handles the Flow

SealRFQ operates across three protocol phases:

1. Commit
   Buyers publish an RFQ. Vendors submit a commitment hash and flat stake.
2. Reveal
   Vendors reveal the original bid amount and nonce. The contract verifies that the reveal matches the commitment.
3. Settle
   The winner is selected against on-chain state, the winner accepts, the buyer funds escrow, and payments are released through contract transitions.

This structure keeps the sensitive part of the auction private during bidding, while making the state transitions and settlement logic observable and verifiable.

## What the Product Provides Today

The current product includes a complete user-facing flow from RFQ creation through payment release, backed by a contract with commit, reveal, selection, escrow, refund, slashing, and timeout recovery paths.

At the repository level, the product includes:

- A frontend application for buyer, vendor, auditor, and escrow workflows
- A backend application for authentication, API access, state materialization, and transaction tracking
- Leo programs for both demo-oriented and production-oriented timing profiles
- Wallet-driven transaction orchestration and backend transaction status surfaces
- Audit-oriented state exposure through RFQ, bid, escrow, and transaction routes

## What Has Been Achieved

The project has already reached the following milestones:

- A full RFQ contract lifecycle on Aleo testnet
- Separate Leo contract variants for short demo windows and production-oriented timing windows
- Complete frontend flow from create, commit, reveal, winner selection, escrow funding, and release
- Backend support for nonce-based authentication, session rotation, transaction tracking, reconciliation, and rate limiting
- Coverage of normal lifecycle transitions as well as timeout and recovery paths in the contract design

## Repository Documentation

Detailed implementation documentation is organized under [`documentation/`](./documentation):

- [`documentation/README.md`](./documentation/README.md)
- [`documentation/frontend.md`](./documentation/frontend.md)
- [`documentation/backend.md`](./documentation/backend.md)
- [`documentation/program.md`](./documentation/program.md)

These documents describe the frontend, backend, and Leo program separately, with source references to the relevant parts of the repository.
