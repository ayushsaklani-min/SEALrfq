# SEALrfq — Privacy-Preserving Sealed-Bid Procurement on Aleo

SEALrfq is a sealed-bid procurement protocol built on Aleo. Bid confidentiality, deterministic winner selection, and escrow settlement are enforced by on-chain program logic — not by platform trust.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SEALrfq — System Architecture                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌───────────────┐       ┌───────────────┐       ┌───────────────┐        │
│   │    Buyer       │       │    Vendor      │       │    Auditor     │        │
│   │  (Browser)     │       │  (Browser)     │       │  (Browser)     │        │
│   └──────┬────────┘       └──────┬────────┘       └──────┬────────┘        │
│          │                       │                       │                  │
│          │    Shield Wallet      │    Shield Wallet      │                  │
│          │   (Aleo Extension)    │   (Aleo Extension)    │                  │
│          │                       │                       │                  │
│   ┌──────▼───────────────────────▼───────────────────────▼────────┐        │
│   │                     Next.js Frontend                          │        │
│   │  ┌────────────┐ ┌────────────┐ ┌─────────┐ ┌──────────────┐  │        │
│   │  │ Create RFQ │ │ Commit Bid │ │ Reveal  │ │ Escrow Mgmt  │  │        │
│   │  │ Close Bid  │ │ Accept Win │ │ Bid     │ │ Release Pay  │  │        │
│   │  │ Select Win │ │ Decline    │ │         │ │ Audit View   │  │        │
│   │  └────────────┘ └────────────┘ └─────────┘ └──────────────┘  │        │
│   │                    Vercel (Frontend Host)                     │        │
│   └──────────────────────────┬───────────────────────────────────┘        │
│                              │ HTTPS / JWT Auth                           │
│   ┌──────────────────────────▼───────────────────────────────────┐        │
│   │                     Next.js Backend                           │        │
│   │  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐  │        │
│   │  │ Auth     │ │ RFQ API  │ │ Bid API    │ │ Escrow API   │  │        │
│   │  │ (Aleo    │ │ CRUD +   │ │ Commit +   │ │ Fund +       │  │        │
│   │  │  Sig)    │ │ Lifecycle│ │ Reveal     │ │ Release      │  │        │
│   │  └──────────┘ └──────────┘ └────────────┘ └──────────────┘  │        │
│   │  ┌──────────┐ ┌──────────┐ ┌────────────────────────────┐   │        │
│   │  │ TX       │ │ Chain    │ │ Event Indexer              │   │        │
│   │  │ Tracker  │ │ State    │ │ (Polls Aleo RPC for        │   │        │
│   │  │          │ │ (Block   │ │  on-chain mapping state)   │   │        │
│   │  │          │ │  Height) │ │                            │   │        │
│   │  └──────────┘ └──────────┘ └────────────────────────────┘   │        │
│   │                    Render (Backend Host)                      │        │
│   └──────────────────────────┬───────────────────────────────────┘        │
│                              │ Aleo RPC                                   │
│   ┌──────────────────────────▼───────────────────────────────────┐        │
│   │                   Aleo Blockchain (Testnet)                   │        │
│   │                                                               │        │
│   │   sealrfq_v9.aleo — 22 Transitions                           │        │
│   │   ┌─────────────────────────────────────────────────────┐    │        │
│   │   │ Mappings: rfq_status, bid_commitments, revealed_bids│    │        │
│   │   │           escrow_amounts, bid_stakes, winner_bids   │    │        │
│   │   │           actor_*_nonces (replay protection)        │    │        │
│   │   │                                                     │    │        │
│   │   │ Records:  RFQCreated, BidCommitted, BidRevealed     │    │        │
│   │   │           WinnerSelected, EscrowFunded              │    │        │
│   │   │           PartialPaymentReleased, StakeSlashed ...  │    │        │
│   │   └─────────────────────────────────────────────────────┘    │        │
│   │                                                               │        │
│   │   credits.aleo — Native ALEO token transfers                  │        │
│   │   (transfer_public / transfer_public_as_signer)               │        │
│   └───────────────────────────────────────────────────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Complete Protocol Flow

```
 BUYER                          ALEO CHAIN                         VENDOR
   │                               │                                  │
   │  1. create_rfq(deadlines,     │                                  │
   │     min_bid, metadata_hash)   │                                  │
   │ ─────────────────────────────►│                                  │
   │                               │  RFQ is OPEN                     │
   │                               │  rfq_status = 1                  │
   │                               │                                  │
   │                               │    2. submit_bid_commit          │
   │                               │       (commitment, flat_stake)   │
   │                               │◄─────────────────────────────────│
   │                               │                                  │
   │                               │  ┌──────────────────────────┐    │
   │                               │  │ ZK PRIVACY:              │    │
   │                               │  │ bid_amount + nonce stay   │    │
   │                               │  │ in the ZK circuit.       │    │
   │                               │  │ Only hash(amount, nonce)  │    │
   │                               │  │ is stored on-chain.       │    │
   │                               │  │                          │    │
   │                               │  │ ZK PROOF:                │    │
   │                               │  │ Circuit proves            │    │
   │                               │  │ bid >= claimed_min_bid    │    │
   │                               │  │ Finalize verifies         │    │
   │                               │  │ claimed_min_bid == actual │    │
   │                               │  │ ∴ bid >= min_bid proven   │    │
   │                               │  │   without revealing bid   │    │
   │                               │  └──────────────────────────┘    │
   │                               │                                  │
   │       ··· bidding deadline passes ···                            │
   │                               │                                  │
   │  3. close_bidding             │                                  │
   │ ─────────────────────────────►│                                  │
   │                               │  RFQ moves to REVEAL             │
   │                               │  rfq_status = 2                  │
   │                               │                                  │
   │                               │    4. reveal_bid                 │
   │                               │       (bid_amount, nonce)        │
   │                               │◄─────────────────────────────────│
   │                               │                                  │
   │                               │  ┌──────────────────────────┐    │
   │                               │  │ INTEGRITY CHECK:         │    │
   │                               │  │ hash(amount, nonce) must  │    │
   │                               │  │ match stored commitment.  │    │
   │                               │  │ No bid-switching possible │    │
   │                               │  │                          │    │
   │                               │  │ Lowest bid tracked        │    │
   │                               │  │ automatically on-chain    │    │
   │                               │  └──────────────────────────┘    │
   │                               │                                  │
   │       ··· reveal deadline passes ···                             │
   │                               │                                  │
   │  5. select_winner             │                                  │
   │     (bid_id, amount, address) │                                  │
   │ ─────────────────────────────►│                                  │
   │                               │  All claims validated against    │
   │                               │  on-chain truth — no spoofing    │
   │                               │  rfq_status = 3                  │
   │                               │                                  │
   │                               │    6. winner_accept              │
   │                               │◄─────────────────────────────────│
   │                               │                                  │
   │                               │  ┌──────────────────────────┐    │
   │                               │  │ CONSENT GATE:            │    │
   │                               │  │ Winner must explicitly    │    │
   │                               │  │ accept before buyer can   │    │
   │                               │  │ lock funds. Prevents      │    │
   │                               │  │ forced commitments.       │    │
   │                               │  └──────────────────────────┘    │
   │                               │                                  │
   │  7. fund_escrow               │                                  │
   │     (exact winning amount)    │                                  │
   │ ─────────────────────────────►│                                  │
   │                               │  Funds locked in program account │
   │                               │  rfq_status = 4                  │
   │                               │                                  │
   │  8. release_partial_payment   │                                  │
   │     (percentage of remaining) │                                  │
   │ ─────────────────────────────►│──────────────────────────────────►│
   │                               │  Milestone-based release         │
   │                               │  Anti-dust minimum enforced      │
   │                               │                                  │
   │  9. release_final_payment     │                                  │
   │ ─────────────────────────────►│──────────────────────────────────►│
   │                               │  rfq_status = 5 (COMPLETED)      │
   │                               │                                  │
   │                               │    10. release_winner_stake      │
   │                               │◄─────────────────────────────────│
   │                               │  Winner gets stake back          │
   │                               │                                  │
   │                               │    11. refund_stake              │
   │                               │       (non-winners reclaim)      │
   │                               │◄──────────────────── all vendors │
```

### Safety & Recovery Paths

```
 EDGE CASE                         WHAT HAPPENS                 WHO CAN CALL
 ─────────────────────────────────────────────────────────────────────────────
 Vendor doesn't reveal             Creator slashes stake        Creator only
                                   within SLASH_WINDOW          (slash_non_revealer)

 Vendor misses slash window        Vendor reclaims stake        Vendor
                                   (no penalty — window passed) (reclaim_unrevealed_stake)

 Winner declines award             Stake slashed to creator     Winner
                                   Other vendors refund         (winner_decline)

 Not enough bids                   RFQ auto-cancelled           Permissionless
                                   after bidding deadline       (cancel_rfq_insufficient_bids)

 No bids revealed + slash expired  RFQ cancelled                Permissionless
                                   (stuck state escape hatch)   (cancel_rfq_stuck_reveal)

 Creator never funds escrow        RFQ cancelled after timeout  Permissionless
                                   All vendors refund           (cancel_rfq_no_escrow)

 Delivery never completes          Creator reclaims escrow      Creator only
                                   after ESCROW_RECOVERY_BLOCKS (creator_reclaim_escrow)
                                   → STATUS_CANCELLED, all
                                   vendors reclaim stakes
```

---

## The Problem

Conventional procurement has a structural trust problem. Before bidding closes, bid access depends on internal permissions. In practice, that creates room for information leakage, preferential treatment, bid shopping, and disputes about winner selection fairness.

Settlement has a parallel problem — even after bidding, payment relies on off-chain coordination between buyers, vendors, and intermediaries, introducing delay, ambiguity, and inconsistent auditability.

**The issue is not a lack of software. The issue is that the process depends on trusting an operator.**

## Why Aleo

SEALrfq is built on Aleo because Aleo provides **privacy at the execution layer**:

- **Bid amounts and nonces are private ZK inputs** — the chain stores only the commitment hash, never the raw amount
- **The record model** supports private ownership semantics for event notifications
- **Leo's async transition + finalize model** cleanly separates ZK proofs (transition) from on-chain state validation (finalize)
- **`credits.aleo`** provides native settlement for stakes and escrow without external token bridges

## Key Security Properties

| Property | How It's Enforced |
|---|---|
| **Bid privacy** | `bid_amount` + `nonce` never leave the ZK circuit during commit |
| **No bid-switching** | Reveal must hash-match the original commitment (`BHP256`) |
| **Min-bid compliance** | Split ZK proof: circuit proves `bid >= claimed_min`, finalize verifies `claimed_min == actual` |
| **Uniform stakes** | Flat stake derived from `min_bid` — identical for all bidders, zero information leakage |
| **Replay protection** | Strictly sequential per-actor per-action nonces |
| **Re-entrancy safety** | Checks-effects-interactions: stakes zeroed before `credits.aleo` transfer |
| **No forced commitments** | Winner must explicitly accept before buyer can fund escrow |
| **Stake accountability** | Non-revealers slashed within time window; honest bidders always have a reclaim path |
| **No stuck states** | Every edge case (timeout, decline, insufficient bids, stuck reveal) has an escape transition |

## Repository Structure

```
SEALrfq/
├── contracts/
│   ├── v9/src/main.leo          # Demo contract (short time windows for testnet)
│   └── v10/src/main.leo         # Production contract (longer time windows)
├── backend/                     # Next.js API server (Render)
│   ├── api/                     # Route handlers (RFQ, Bid, Escrow, Auth)
│   ├── aleo/                    # Chain state, executor, fee estimation
│   ├── indexer/                 # Event listener + processor
│   ├── tx/                      # Transaction tracker + reconciliation
│   └── db/                      # Prisma schema + SQLite migrations
├── frontend/                    # Next.js app (Vercel)
│   ├── app/                     # Pages: buyer, vendor, escrow, audit flows
│   ├── components/              # Shared UI: ConfirmDialog, CopyButton, DeadlineCountdown
│   ├── contexts/                # WalletContext (Shield wallet integration)
│   └── lib/                     # walletTx, shieldWallet, authFetch
└── documentation/               # Detailed architecture docs
    ├── README.md
    ├── program.md               # Leo contract walkthrough
    ├── backend.md               # API + indexer + DB design
    └── frontend.md              # Frontend architecture
```

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contract | Leo / Aleo (testnet) |
| Frontend | Next.js 14, Tailwind CSS, Framer Motion |
| Backend | Next.js API routes, Prisma ORM, SQLite |
| Wallet | Shield Wallet (Aleo browser extension) |
| Auth | Aleo signature challenge-response + JWT |
| Hosting | Vercel (frontend) + Render (backend) |

## Running Locally

```bash
# Backend
cd backend
cp .env.example .env       # Configure Aleo RPC URL and secrets
npm install
npx prisma migrate dev
npm run dev                 # http://localhost:3001

# Frontend
cd frontend
cp .env.example .env       # Set NEXT_PUBLIC_BACKEND_URL
npm install
npm run dev                 # http://localhost:3000
```

## Documentation

Detailed implementation docs are in [`documentation/`](./documentation):

- [`program.md`](./documentation/program.md) — Leo contract design, all 22 transitions
- [`backend.md`](./documentation/backend.md) — API routes, indexer, transaction tracking
- [`frontend.md`](./documentation/frontend.md) — Wallet integration, UX patterns, page flows
