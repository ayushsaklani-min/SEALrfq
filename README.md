# SealRFQ

Privacy-first RFQ + escrow workflow on Aleo testnet, with:
- `frontend/`: Next.js UI (deploy to Vercel)
- `backend/`: Next.js API service (deploy to Render)
- `contracts/`: Leo smart contracts (`poc` and `v1`)

## Repo Structure

```text
sealRFQ/
  backend/
    app/
    api/
    auth/
    db/
    indexer/
    middleware/
    tests/
    package.json
    .env.example
  frontend/
    app/
    components/
    contexts/
    hooks/
    lib/
    public/
    tests/
    package.json
    vercel.json
    .env.example
  contracts/
    poc/
    v1/
  render.yaml
  .gitignore
  README.md
```

## Local Development

### 1) Backend

```bash
cd backend
cp .env.example .env
npm ci
npm run db:generate
npm run build
npm run dev
```

Backend runs on `http://localhost:4000`.

### 2) Frontend

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run build
npm run dev
```

Frontend runs on `http://localhost:3000`.

## Deploy Backend on Render

This repo includes `render.yaml` for backend deployment.

Render service settings from file:
- Root directory: `backend`
- Build command: `npm ci && npm run db:generate && npm run build`
- Start command: `npm run db:migrate && npm run start -- -p $PORT`

Set these environment variables in Render:
- `DATABASE_URL`
- `JWT_SECRET`
- `ACCESS_TOKEN_TTL`
- `REFRESH_TOKEN_TTL`
- `ALEO_PROGRAM_ID`
- `ALEO_NETWORK`
- `ALEO_RPC_URL`
- `ALEO_CONSENSUS_VERSION`
- `ALLOW_INSECURE_WALLET_SIGNATURE` (false for production)
- Optional: `LEO_BIN`, `ALEO_PROJECT_DIR`, `AUDITOR_WHITELIST`

## Deploy Frontend on Vercel

Recommended:
1. Import this repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Vercel will use `frontend/vercel.json`.

Set environment variables in Vercel:
- `NEXT_PUBLIC_ALEO_PROGRAM_ID`
- `NEXT_PUBLIC_ALEO_NETWORK`
- `BACKEND_API_URL` (your Render backend URL)

## GitHub Push Checklist

Before push, confirm these are **not** committed:
- `node_modules/`
- `.next/`
- `.env*` secrets
- local logs
- local sqlite DB files
- `*.tsbuildinfo`

The root `.gitignore` already covers the above.
