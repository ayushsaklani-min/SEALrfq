# Backend Documentation

## Overview

The backend is the application layer that materializes protocol state, exposes authenticated APIs, tracks wallet-submitted transactions, and provides operational controls around access, retries, and rate limiting.

In this repository, the backend is implemented as a Next.js application with route handlers, Prisma-based persistence, Aleo state helpers, and transaction lifecycle services.

## Source Map

Primary backend sources:

```text
backend/app/api/**
backend/api/auth/routes.ts
backend/api/rfq/routes.ts
backend/api/bid/routes.ts
backend/api/escrow/routes.ts
backend/api/tx/routes.ts
backend/auth/service.ts
backend/auth/middleware.ts
backend/auth/aleoVerifier.ts
backend/tx/tracker.ts
backend/tx/reconciliation.ts
backend/aleo/chainState.ts
backend/aleo/executor.ts
backend/middleware/rateLimit.ts
backend/middleware/withRateLimit.ts
backend/db/schema.prisma
backend/lib/validateEnv.ts
backend/lib/escrowState.ts
```

## Runtime Structure

The backend is organized around five responsibilities:

### 1. Route Layer

The route layer is exposed through `backend/app/api/**` and delegates to the implementation modules under `backend/api/**`.

This keeps the HTTP entry points thin while concentrating business logic in a stable internal structure:

- `backend/api/auth/routes.ts`
- `backend/api/rfq/routes.ts`
- `backend/api/bid/routes.ts`
- `backend/api/escrow/routes.ts`
- `backend/api/tx/routes.ts`

### 2. Authentication and Session Management

Authentication is wallet-based and challenge-driven rather than password-based.

The backend flow is:

1. Create a nonce challenge
2. Ask the wallet to sign the challenge message
3. Verify the Aleo signature server-side
4. Issue a short-lived access token and rotating refresh token
5. Resolve role server-side from backend state

Key sources:

- `backend/auth/service.ts`
- `backend/auth/aleoVerifier.ts`
- `backend/auth/middleware.ts`

The authentication layer includes:

- Nonce-based challenge generation
- Session persistence in the database
- Access-token verification
- Refresh-token rotation
- Session revocation and logout-all support
- Role resolution based on observed buyer, vendor, and auditor state

## API Domains

### RFQ API

The RFQ layer handles creation, closing, winner selection, cancellation, listing, and RFQ state retrieval.

Primary source:

- `backend/api/rfq/routes.ts`

The RFQ routes also compute derived state used by the frontend, including winner metadata, winner acceptance state, and escrow funding estimates.

### Bid API

The bid layer handles commit, reveal, bid retrieval, and vendor bid history.

Primary source:

- `backend/api/bid/routes.ts`

The bid flow is designed around the contract's commit-reveal model. The backend prepares wallet transaction requests, records tracking metadata, and stores materialized bid state after the wallet flow reports success.

### Escrow API

The escrow layer handles escrow state retrieval, payment release, and audit-facing settlement visibility.

Primary source:

- `backend/api/escrow/routes.ts`

This layer combines locally materialized state with confirmed transaction tracking so the frontend can display remaining escrow, prior releases, and whether settlement is fully reconciled.

### Transaction API

The transaction layer exposes backend-side transaction status, retry eligibility, canonical action history, and wallet result submission.

Primary source:

- `backend/api/tx/routes.ts`

This is the operational surface that allows the frontend to treat wallet execution and backend tracking as one continuous lifecycle rather than as disconnected actions.

## Transaction Tracking Model

The backend includes an explicit transaction tracker and reconciliation layer.

Primary sources:

- `backend/tx/tracker.ts`
- `backend/tx/reconciliation.ts`

The transaction model supports:

- Prepared, submitted, confirmed, rejected, and expired states
- Status history persistence
- Canonical action keys and per-attempt idempotency keys
- Retry classification
- Reconciliation against Aleo-visible state

This architecture is important because wallet-driven blockchain UX does not produce deterministic backend outcomes on its own. The tracker gives the application a durable model for handling in-flight, failed, and recovered actions.

## Aleo Integration Layer

The backend contains separate helpers for on-chain execution, fee estimation, and state inspection.

Primary sources:

- `backend/aleo/executor.ts`
- `backend/aleo/chainState.ts`
- `backend/aleo/fees.ts`

These modules are responsible for:

- Resolving current block height
- Reading contract mappings from Aleo endpoints
- Estimating transition fees
- Supporting reconciliation through chain-state checks

## Persistence Layer

The persistence model is defined in Prisma.

Primary source:

- `backend/db/schema.prisma`

The schema includes:

- Authentication nonces and sessions
- RFQs, bids, escrow, and payments
- Immutable RFQ event records
- Transaction tracking records
- Indexer checkpoints and reorg support structures

Although the environment examples reference PostgreSQL for production, the schema in the current repository is configured with a SQLite datasource. That means the backend documentation should be read in the context of the checked-in schema rather than the aspirational deployment target.

## Operational Controls

### Rate Limiting

The backend applies route-aware rate limiting through Redis-backed middleware.

Primary sources:

- `backend/middleware/rateLimit.ts`
- `backend/middleware/withRateLimit.ts`

Configured protected areas include:

- Authentication endpoints
- RFQ creation
- Bid commit
- Escrow release
- Audit retrieval

This is an important operational characteristic of the backend because it is implemented as a reusable wrapper around route handlers rather than as scattered endpoint-specific logic.

### Environment Validation

The backend validates required environment variables and rejects insecure production defaults at startup.

Primary source:

- `backend/lib/validateEnv.ts`

This includes validation for:

- `JWT_SECRET`
- `DATABASE_URL`
- Aleo network configuration
- Redis requirements in production
- explicit blocking of insecure demo flags in production

## Architectural Characteristics

The backend is structured more like an application service than a thin API wrapper.

The notable design characteristics are:

- Separation between HTTP entry points and route logic
- Challenge-based wallet authentication
- Explicit transaction state tracking
- Reconciliation support for blockchain reality versus local state
- Rate limiting and environment validation as first-class operational concerns
- A query-oriented API surface for RFQ, bid, escrow, and transaction state

## Relevant Files by Concern

```text
Authentication
  backend/api/auth/routes.ts
  backend/auth/service.ts
  backend/auth/middleware.ts
  backend/auth/aleoVerifier.ts

RFQ and bids
  backend/api/rfq/routes.ts
  backend/api/bid/routes.ts

Escrow and payments
  backend/api/escrow/routes.ts
  backend/lib/escrowState.ts

Transaction handling
  backend/api/tx/routes.ts
  backend/tx/tracker.ts
  backend/tx/reconciliation.ts

Operational controls
  backend/middleware/rateLimit.ts
  backend/middleware/withRateLimit.ts
  backend/lib/validateEnv.ts

Persistence
  backend/db/schema.prisma
```
