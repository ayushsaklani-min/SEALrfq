# SEALrfq

SEALrfq is a private procurement and auction platform on Aleo. The active product in this repository is split across:

- `frontend/`: Next.js client UI
- `backend/`: Next.js API server and transaction/indexing layer
- `contracts/v18/`: core RFQ protocol
- `contracts/sealvickrey_v2/`: Vickrey auction program
- `contracts/sealdutch_v4/`: Dutch auction program
- `contracts/sealrfq_invoice_v1/`: invoice settlement router

## Run

Frontend:

```bash
cd frontend
npm run dev
```

Backend:

```bash
cd backend
npm run dev
```

## Notes

- The repository was cleaned to keep only the active product surface.
- Stale reference dumps, prototype UI folders, generated logs, and unused legacy assets were removed.
- Environment examples remain in `frontend/.env.example` and `backend/.env.example`.
