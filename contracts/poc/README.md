# SealRFQ Phase 0 - Proof of Concept

## Overview
Minimal Leo contract demonstrating:
- Commit-reveal bidding mechanism
- Anti-griefing stake slashing
- Privacy-preserving bid amounts
- Milestone-based escrow releases

## Transitions

1. **create_rfq** - Buyer creates RFQ with deadlines
2. **submit_bid_commit** - Vendor submits bid commitment + stake
3. **close_bidding** - Buyer closes bidding phase
4. **reveal_bid** - Vendor reveals bid amount
5. **select_winner** - Buyer selects lowest valid bid
6. **slash_non_revealer** - Slash stake from non-revealing bidders
7. **refund_stake** - Refund stake to honest bidders
8. **fund_escrow** - Buyer funds escrow
9. **release_partial_payment** - Release milestone payment  
10. **release_final_payment** - Release remaining escrow

## Privacy Guarantees

- Bid amounts stored in private `BidCommitRecord` (vendor-owned)
- Only commitment hash stored in public mappings
- Bid amount only becomes public if vendor reveals
- Non-revealing vendors keep bid amount forever private

## Anti-Griefing

- Minimum stake: `max(bid_amount * 10%, 5 credits)`
- Non-revealing bidders lose stake after reveal deadline
- Honest bidders get stake refunded

## Build

```bash
leo build
```

## Test Locally

```bash
leo run create_rfq 12345field 1000000u32 1001440u32 100u64
```

## Deploy to Testnet

See `test_poc.ps1` or `test_poc.sh` for full deployment flow.
