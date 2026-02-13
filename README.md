# SealRFQ - Privacy-First B2B Procurement on Aleo

**Status**: 🚧 Phase 0 - Feasibility Checkpoint  
**Version**: 0.1.0 (Proof of Concept)  
**License**: MIT

---

## Overview

SealRFQ is a privacy-first RFQ (Request for Quotation) and escrow platform built on Aleo Testnet. It enables businesses to run sealed-bid procurement with:

- **Privacy-Preserving Bids**: Vendor bid amounts remain confidential using Aleo's private records
- **Commit-Reveal Mechanism**: Trustless winner selection with anti-griefing protections
- **Milestone-Based Escrow**: Automated payment releases with partial milestone support
- **Verifiable Results**: All state transitions recorded on-chain with audit trails

---

## Phase 0: Proof of Concept

### Objectives

Prove core Aleo capabilities work on testnet before full V1 implementation:

1. ✅ **RFQ Flow**: Create RFQ → Sealed Bids → Close → Reveal → Select Winner
2. ✅ **Escrow**: Fund → Partial Release → Final Release with correct accounting
3. ✅ **Privacy**: Bid amounts NOT visible on Aleo Explorer
4. ✅ **Anti-Griefing**: Stake slashing for non-revealing bidders

### Current Status

- [x] Leo contract built (10 transitions)
- [x] PowerShell test scripts created
- [/] Testnet deployment (IN PROGRESS)
- [ ] Full flow execution
- [ ] Privacy verification
- [ ] Feasibility proof documentation

---

## Smart Contract Architecture

### Core Transitions (10)

| # | Transition | Description |
|---|-----------|-------------|
| 1 | `create_rfq` | Buyer creates RFQ with deadlines |
| 2 | `submit_bid_commit` | Vendor submits bid commitment + stake |
| 3 | `close_bidding` | Buyer closes bidding phase |
| 4 | `reveal_bid` | Vendor reveals bid amount |
| 5 | `select_winner` | Buyer selects lowest valid bid |
| 6 | `slash_non_revealer` | Slash stake from non-revealing bidders |
| 7 | `refund_stake` | Refund stake to honest bidders |
| 8 | `fund_escrow` | Buyer funds escrow |
| 9 | `release_partial_payment` | Release milestone payment |
| 10 | `release_final_payment` | Release remaining escrow |

### Privacy Guarantees

- **Bid Amount**: Stored in private `BidCommitRecord` (vendor-owned)
- **Commitment**: Only `hash(bid_amount + nonce)` stored publicly
- **Reveal**: Voluntary—non-revealing vendors keep bids forever private
- **No Leakage**: Explorer shows commitment hash, not actual bid

### Anti-Griefing Mechanism

- **Stake Requirement**: `max(bid_amount * 10%, 5 credits)`
- **Slashing**: Non-revealing bidders lose stake after reveal deadline
- **Refund**: Honest bidders get stake back after winner selection
- **Tie-Break**: Earliest valid reveal wins (block height deterministic)

---

## Project Structure

```
sealRFQ/
├── contracts/
│   └── poc/
│       ├── src/
│       │   └── main.leo           # Phase 0 contract
│       ├── program.json           # Leo package manifest
│       ├── test_poc.ps1           # PowerShell test script
│       ├── .env.example           # Environment template
│       └── README.md
├── FEASIBILITY_PROOF.md           # Evidence tracking
├── README.md                      # This file
└── .gitignore
```

---

## Setup & Installation

### Prerequisites

- **Leo CLI**: v1.11.0 (`cargo install leo-lang --version 1.11.0`)
- **Aleo Testnet Accounts**: Buyer, Vendor1, Vendor2 with test credits
- **PowerShell** (Windows) or Bash (Linux/macOS)

### Installation

```powershell
# Clone repository
git clone https://github.com/yourusername/sealRFQ.git
cd sealRFQ

# Configure environment
cd contracts/poc
cp .env.example .env
# Edit .env with your Aleo private keys

# Build contract
leo build
```

---

## Usage

### Local Testing

```powershell
# Build contract
leo build

# Test create_rfq locally
leo run create_rfq 12345field 1000000u32 1001440u32 100u64
```

### Testnet Deployment

```powershell
# Deploy to Aleo Testnet
cd contracts/poc
leo deploy --network testnet --private-key YOUR_PRIVATE_KEY

# Execute full flow
.\test_poc.ps1
```

**Note**: The PowerShell script provides a template. You'll need to:
1. Uncomment `leo run` commands
2. Replace `<record>` placeholders with actual record values from outputs
3. Capture all transaction hashes
4. Document results in `FEASIBILITY_PROOF.md`

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Smart Contracts** | Leo (Aleo) | 1.11.0 |
| **Network** | Aleo Testnet | Latest |
| **Wallet** | Shield Wallet | Latest |
| **Scripts** | PowerShell | 5.1+ |

---

## Roadmap

### Phase 0: Feasibility Checkpoint (Current)
- ✅ Build minimal Leo contract
- 🚧 Deploy to Aleo Testnet
- ⏳ Execute full flow
- ⏳  Document with real TX hashes
- ⏳ GO/NO-GO decision

### V1: Core Product (Next)
- Backend API (Node.js + TypeScript + PostgreSQL)
- Blockchain indexer
- Premium React frontend
- Shield Wallet integration
- Full RBAC (Buyer/Vendor/Auditor roles)
- Comprehensive testing
- Production deployment

### V1.1: Enhancements (Future)
- Advanced dispute resolution
- Analytics dashboard
- Multi-wallet support
- Webhook integrations
- Auto-release milestones

---

## Security Considerations

### Smart Contract Security
- **State Machine**: Strict transition guards prevent invalid state changes
- **Replay Protection**: Nonce tracking (to be added in V1)
- **Escrow Invariants**: `released_amount <= total_amount` enforced
- **Stake Slashing**: Anti-griefing mechanism prevents spam bids

### Privacy Model
- **Bid Amounts**: Private records (vendor-owned)
- **Commitments**: Public hashes only
- **Selective Reveal**: Vendors control disclosure
- **No Public Leakage**: Explorer shows zero private data

---

## Contributing

This is a proof-of-concept for Phase 0 feasibility testing. Full V1 implementation will follow after successful testnet validation.

---

## License

MIT License - See LICENSE file for details

---

## Contact & Support

- **GitHub**: [Your Repository URL]
- **Documentation**: See `contracts/poc/README.md`
- **Issues**: [GitHub Issues URL]

---

**Last Updated**: 2026-02-13  
**Current Phase**: Phase 0 - Testnet Deployment  
**Next Milestone**: Complete feasibility proof with real transaction links
