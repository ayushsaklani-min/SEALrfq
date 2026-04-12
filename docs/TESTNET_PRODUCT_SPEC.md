# SEALrfq Testnet Product Spec

## Scope

This spec covers the buildathon upgrade layer around the current SEALrfq testnet system.

It does not redefine the Leo contracts.
It improves the product shell around them.

## Feature 1: Testnet Insights

### Goal

Expose live protocol telemetry that supports the procurement story.

### Required data

- active RFQs
- open commitments
- completed RFQs
- private settlements
- reveal rate
- winner acceptance rate
- stablecoin usage rate
- auction adoption rate
- buyer leaderboard
- vendor leaderboard
- recent protocol activity
- recent settlement actions

### Source of truth

- RFQ table
- Bid table
- Payment table
- RFQEvent table

### Acceptance

- Insights page renders from indexed backend data
- metrics are testnet-safe and do not imply mainnet guarantees
- telemetry emphasizes procurement trust, not vanity counts

## Feature 2: Buyer Decision Console

### Goal

Help buyers choose the right supplier instead of blindly picking the lowest revealed price.

### Surface

- `/buyer/rfqs/[id]/select-winner`

### Required data

- revealed bid amount
- supplier trust score
- reveal discipline
- settlement receipt history
- slash history
- price spread across the round

### Acceptance

- buyers see a ranked recommendation, not just a raw bid table
- each supplier option includes strengths, cautions, and procurement risk
- the recommendation can justify a non-lowest-price supplier when execution quality is better

## Feature 3: Vendor Opportunity Intelligence

### Goal

Help vendors decide whether a buyer and round are worth participating in before they lock a bid.

### Surface

- `/vendor/bid/[rfqId]`

### Required data

- buyer trust score
- buyer completion rate
- private-settlement behavior
- current competition vs minimum threshold
- time remaining in the bid window

### Acceptance

- vendors see a clear participation recommendation before committing
- buyer history is visible directly in the live bid workflow
- signals stay testnet-scoped and based on indexed data only

## Feature 4: Procurement Packet

### Goal

Give judges and operators an exportable procurement evidence bundle from the live audit workflow.

### Surface

- `/audit/[rfqId]`

### Required data

- RFQ summary
- buyer trust profile
- winning supplier context
- ranked supplier recommendation
- event timeline
- settlement state

### Acceptance

- users can export a readable procurement packet directly from the audit page
- the packet includes both timeline evidence and decision context
- no product docs pages are required inside the app

## Feature 5: Delivery Assurance

### Goal

Turn escrow into a procurement delivery workflow instead of a raw payment form.

### Surfaces

- `/buyer/rfqs/[id]`
- `/escrow/[rfqId]`
- `/audit/[rfqId]`

### Required data

- milestone title and amount
- milestone approval state
- vendor evidence hash and link
- buyer approval notes or rejection reason
- milestone-linked release transaction

### Acceptance

- buyers can define a milestone plan after winner selection
- winners can submit delivery evidence per milestone
- buyers can approve or reject evidence before public release
- approved milestones can drive exact release amounts from escrow
- audit export includes delivery checkpoint state

## Non-Goals

- mainnet governance
- audit signoff
- credential gating
- vesting
- launchpad-style LBP or quadratic auction work
- product-embedded docs or guide pages

Those can be future branches, but they are not part of this testnet upgrade spec.
