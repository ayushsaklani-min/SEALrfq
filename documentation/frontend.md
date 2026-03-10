# Frontend Documentation

## Overview

The frontend is the user-facing application layer for SealRFQ. It provides the buyer, vendor, auditor, dashboard, escrow, and wallet-connected transaction flows that sit on top of the protocol and backend APIs.

The frontend is implemented as a Next.js application using the App Router, client-side wallet integration, same-origin API proxy routes, and transaction status surfaces tied to backend tracking.

## Source Map

Primary frontend sources:

```text
frontend/app/**
frontend/components/**
frontend/contexts/WalletContext.tsx
frontend/lib/shieldWallet.ts
frontend/lib/walletTx.ts
frontend/lib/authFetch.ts
frontend/app/api/_lib/backendProxy.ts
frontend/hooks/**
```

## Application Structure

The frontend is divided into two broad areas:

- Presentation and product-facing pages
- Wallet-driven application flows for procurement and settlement

The product-facing pages establish the narrative and dashboard entry points. The application-facing pages handle transaction preparation, wallet execution, status tracking, and post-action state retrieval.

## Wallet Integration Model

Wallet interaction is managed through a dedicated context and wallet helper modules.

Primary sources:

- `frontend/contexts/WalletContext.tsx`
- `frontend/lib/shieldWallet.ts`

This layer is responsible for:

- Connecting to Shield-compatible providers
- Detecting wallet availability and lock state
- Requesting the nonce challenge from the backend
- Signing the backend-provided authentication message
- Maintaining non-sensitive UI session state in local storage

The wallet integration is one of the core frontend design decisions in the repository. Authentication is handled through wallet signatures, while access and refresh tokens remain in server-managed cookies.

## Proxy and Auth Model

The frontend uses same-origin API routes as a proxy layer to the backend.

Primary sources:

- `frontend/app/api/_lib/backendProxy.ts`
- `frontend/lib/authFetch.ts`

This structure allows the frontend to:

- Keep backend API calls same-origin from the browser's perspective
- Forward cookies cleanly to the backend
- Retry authenticated requests after access-token expiration
- Keep token handling out of client storage

The result is a frontend architecture where the browser interacts with `/api/*` routes on the frontend application, and those routes forward requests to the backend service.

## Transaction Flow Model

The frontend treats blockchain actions as a wallet-first workflow rather than as a pure REST workflow.

Primary source:

- `frontend/lib/walletTx.ts`

The transaction model is:

1. Ask the backend to prepare a transaction request
2. Execute the transaction through the wallet
3. Report the wallet result back to the backend tracker
4. Call the backend confirm step to materialize business state

This is the central integration pattern used across the app for create, commit, reveal, winner selection, escrow funding, and payment release.

## Buyer Flows

### RFQ Creation

Buyer RFQ creation is implemented in:

- `frontend/app/buyer/create-rfq/page.tsx`

The page collects item metadata, bidding deadlines, and minimum bid data, computes the metadata hash in the browser, and then drives the wallet-first RFQ creation flow.

### RFQ Detail and Control

Buyer RFQ state inspection and lifecycle control are implemented in:

- `frontend/app/buyer/rfqs/[id]/page.tsx`

This page brings together:

- RFQ metadata
- deadline countdowns
- bid visibility
- bidding close action
- navigation to winner selection and escrow funding

### Winner Selection

Winner selection is implemented in:

- `frontend/app/buyer/rfqs/[id]/select-winner/page.tsx`

The page loads revealed bids, pre-sorts them by amount, and drives the select-winner transaction flow.

### Escrow Funding

Escrow funding is implemented in:

- `frontend/app/buyer/rfqs/[id]/fund-escrow/page.tsx`

This page exposes winner acceptance state, winning amount, and the funding transaction once the selected vendor has accepted.

## Vendor Flows

### Bid Commit

Bid commit is implemented in:

- `frontend/app/vendor/bid/[rfqId]/page.tsx`

The page allows a vendor to:

- inspect the RFQ
- enter a bid amount
- generate a nonce locally
- submit the commit transaction
- export or store the nonce bundle required for reveal

### Bid Reveal

Bid reveal is implemented in:

- `frontend/app/vendor/reveal/[bidId]/page.tsx`

The reveal page supports:

- local nonce recovery
- nonce bundle import
- reveal-window visibility
- transaction confirmation through the wallet-first flow

### Vendor Portfolio View

Vendor bid history is implemented in:

- `frontend/app/vendor/my-bids/page.tsx`

This view pulls together vendor bid state, RFQ status, and winner acceptance information where applicable.

## Escrow and Settlement UI

Escrow viewing and release are implemented through:

- `frontend/app/escrow/[rfqId]/page.tsx`
- `frontend/app/escrow/[rfqId]/release/page.tsx`

These pages surface:

- total escrow
- released amount
- remaining amount
- release action
- transaction status after release submission

This makes settlement a first-class product surface rather than a hidden protocol detail.

## Auditor and Traceability UI

Auditor-facing visibility is implemented through:

- `frontend/app/audit/page.tsx`
- `frontend/app/audit/[rfqId]/page.tsx`

The audit pages consume backend audit data and present:

- block heights
- event types
- transitions
- transaction references
- CSV export

## Status and Feedback Components

The frontend includes transaction-centric feedback components that are important to the overall UX.

Primary sources:

- `frontend/components/TxStatus.tsx`
- `frontend/components/DeadlineCountdown.tsx`
- `frontend/components/ConfirmDialog.tsx`

These components provide:

- live transaction polling through backend state
- terminal-state visibility
- retry and recovery affordances where supported
- explicit confirmation for high-consequence actions
- time-sensitive state visibility around bidding and reveal windows

## Architectural Characteristics

The frontend is more than a static UI on top of APIs. It is a transaction-oriented application layer with a distinct structure:

- wallet connection and signature orchestration
- same-origin proxying to the backend
- explicit transaction lifecycle tracking
- role-sensitive product flows
- dedicated pages for each procurement phase

The frontend architecture is organized around end-to-end flow completeness and around integrating wallet execution, backend tracking, and page-level state into one user journey.

## Relevant Files by Concern

```text
Wallet and session layer
  frontend/contexts/WalletContext.tsx
  frontend/lib/shieldWallet.ts
  frontend/lib/authFetch.ts

Transaction orchestration
  frontend/lib/walletTx.ts
  frontend/components/TxStatus.tsx

Backend proxy layer
  frontend/app/api/_lib/backendProxy.ts
  frontend/app/api/**

Buyer flows
  frontend/app/buyer/create-rfq/page.tsx
  frontend/app/buyer/rfqs/[id]/page.tsx
  frontend/app/buyer/rfqs/[id]/select-winner/page.tsx
  frontend/app/buyer/rfqs/[id]/fund-escrow/page.tsx

Vendor flows
  frontend/app/vendor/bid/[rfqId]/page.tsx
  frontend/app/vendor/reveal/[bidId]/page.tsx
  frontend/app/vendor/my-bids/page.tsx

Escrow and audit
  frontend/app/escrow/[rfqId]/page.tsx
  frontend/app/escrow/[rfqId]/release/page.tsx
  frontend/app/audit/[rfqId]/page.tsx
```
