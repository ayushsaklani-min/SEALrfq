# SEALrfq Buildathon Upgrade Plan

## Objective

Position SEALrfq as the strongest **testnet procurement protocol** submission in the workspace.

This plan is intentionally **not** a mainnet plan. It optimizes for:

- a clearer product story
- stronger demoability
- better operator trust surfaces
- better procurement decision support
- cleaner judge-facing evidence export

## Competitive Read

`fairdrop` and `SEALrfq` are competitors in the sense that both are Aleo-native capital formation / private-market products targeting the same buildathon attention and prize pool.

The difference is product posture:

- `fairdrop` is a broad launchpad and auction stack
- `SEALrfq` is a procurement-first, buyer-led settlement protocol

SEALrfq should not try to beat Fairdrop by cloning all six auction types.
It should beat Fairdrop by making the procurement story sharper, more credible, and easier to verify on testnet.

## Winning Thesis

SEALrfq wins if the submission makes these points obvious:

1. It solves a different and more enterprise-relevant problem: private procurement, not generic token launches.
2. It already has a stronger settlement story: milestone escrow plus private invoice payment.
3. It is more legible to judges and operators because the workflows, telemetry, and evidence export are easier to follow end to end.

## Priority Roadmap

## P0: Submission Readiness

- ship a testnet insights surface
- expose buyer and vendor trust signals
- add a buyer-side decision console
- add vendor-side opportunity intelligence
- make the demo flow linear for judges

## P1: Procurement Trust Layer

- buyer completion and private-settlement trust signals
- vendor reveal discipline and win-rate tracking
- protocol composition metrics: direct RFQs vs auction-linked RFQs, stablecoin usage, audit coverage
- procurement packet export from the audit workflow

## P2: Integrator and Operator Readiness

- example API consumer
- clearer audit packet export
- stronger workflow guidance inside the actual product surfaces

## P3: Next Build Cycle

- richer counterparty profiles inside RFQ detail pages
- supplier ranking inside winner selection
- vendor opportunity scoring before bid commit
- deeper analytics segmented by token and workflow type

## Non-Goals For This Round

- mainnet deployment claims
- multi-sig governance claims
- external audit completion claims
- launchpad features that do not strengthen the procurement thesis

## Demo Narrative

The live demo should tell this story:

1. Buyer creates a sealed RFQ on testnet.
2. Vendor commits privately and later reveals.
3. Buyer selects or imports a winner, then funds escrow.
4. Buyer either releases publicly in milestones or pays privately through the invoice path.
5. Judge opens the audit trail and insights pages to verify the workflow, supplier recommendation, and trust signals.

## Acceptance Criteria

- A judge can understand the product without reading contract code first.
- A judge can see live telemetry proving the protocol is coherent as a product, not just a contract set.
- A buyer can justify supplier selection with indexed decision evidence.
- A vendor can assess buyer quality before committing a sealed bid.
- All written materials are explicit that the scope is testnet only.
