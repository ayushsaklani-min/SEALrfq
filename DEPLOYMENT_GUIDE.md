# SealRFQ Phase 0 - Testnet Deployment Guide

## Status: Ready for Deployment ✅

### Prerequisites Checklist

- [x] Leo 3.4.0 installed in WSL
- [x] Contract built successfully (`leo build`)
- [x] Local testing verified (`leo run create_rfq`, `leo run submit_bid_commit`)
- [ ] Aleo Testnet accounts with test credits
- [ ] Private keys configured in `.env` file

---

## Step 1: Configure Environment

Create `.env` file in `contracts/poc/`:

```bash
# Copy example and fill in your keys
cp .env.example .env

# Edit with actual Aleo private keys
nano .env
```

Required variables:
- `BUYER_KEY` - Creates RFQ, selects winner, funds escrow
- `VENDOR1_KEY` - Submits bid 1
- `VENDOR2_KEY` - Submits bid 2 (should be lowest)
- `VENDOR2_ADDRESS` - Payment recipient address
- `DEPLOYER_KEY` - Deploys contract (can be same as BUYER_KEY)

---

## Step 2: Deploy Contract to Testnet

```bash
cd contracts/poc

# Deploy using WSL
wslbash -lc "leo deploy --network testnet --private-key YOUR_DEPLOYER_KEY"
```

**Expected output:**
- Program ID: `sealrfq_poc.aleo`
- Transaction hash
- Deployment confirmation

**⚠️ SAVE THE DEPLOYMENT TX HASH** - You'll need it for the feasibility proof!

---

## Step 3: Execute Full RFQ Flow on Testnet

### Step 3.1: Buyer Creates RFQ

```bash
leo run create_rfq \
  12345field \
  1000000u32 \
  1001440u32 \
  100u64 \
  --network testnet \
  --private-key $BUYER_KEY
```

**Save TX hash** → Update `FEASIBILITY_PROOF.md`

### Step 3.2: Vendor 1 Submits Bid (500 credits)

```bash
leo run submit_bid_commit \
  12345field \
  500u64 \
  999field \
  50u64 \
  11111field \
  --network testnet \
  --private-key $VENDOR1_KEY
```

**Save TX hash** → Update `FEASIBILITY_PROOF.md`

### Step 3.3: Vendor 2 Submits Bid (450 credits - LOWEST)

```bash
leo run submit_bid_commit \
  12345field \
  450u64 \
  888field \
  45u64 \
  22222field \
  --network testnet \
  --private-key $VENDOR2_KEY
```

**Save TX hash** → Update `FEASIBILITY_PROOF.md`

### Step 3.4: Buyer Closes Bidding

```bash
leo run close_bidding \
  12345field \
  --network testnet \
  --private-key $BUYER_KEY
```

**Save TX hash**

### Step 3.5: Vendor 1 Reveals Bid

```bash
leo run reveal_bid \
  12345field \
  11111field \
  500u64 \
  999field \
  --network testnet \
  --private-key $VENDOR1_KEY
```

**Save TX hash**

### Step 3.6: Vendor 2 Reveals Bid (LOWEST - Should Win)

```bash
leo run reveal_bid \
  12345field \
  22222field \
  450u64 \
  888field \
  --network testnet \
  --private-key $VENDOR2_KEY
```

**Save TX hash**

### Step 3.7: Buyer Selects Winner

```bash
leo run select_winner \
  12345field \
  22222field \
  --network testnet \
  --private-key $BUYER_KEY
```

**Save TX hash** - This proves lowest bid won

### Step 3.8: Buyer Funds Escrow

```bash
leo run fund_escrow \
  12345field \
  450u64 \
  --network testnet \
  --private-key $BUYER_KEY
```

**Save TX hash**

### Step 3.9: Release 40% Milestone (180 credits)

```bash
leo run release_partial_payment \
  12345field \
  40u8 \
  $VENDOR2_ADDRESS \
  --network testnet \
  --private-key $BUYER_KEY
```

**Save TX hash**

### Step 3.10: Release Final 60% (270 credits)

```bash
leo run release_final_payment \
  12345field \
  $VENDOR2_ADDRESS \
  --network testnet \
  --private-key $BUYER_KEY
```

**Save TX hash**

---

## Step 4: Privacy Verification

Visit Aleo Explorer:

1. Open https://explorer.aleo.org
2. Search for **submit_bid_commit** transaction hash
3. **VERIFY**: Bid amount (500u64, 450u64) is NOT visible in public state
4. **Screenshot** the transaction details showing ONLY the commitment hash
5. Add screenshot to `FEASIBILITY_PROOF.md`

---

## Step 5: Document Results

Update `FEASIBILITY_PROOF.md` with:

1. **All 10 transaction hashes**
2. **Aleo Explorer links** for each transaction
3. **Screenshots** showing:
   - Privacy verification (no bid amounts visible)
   - Escrow accounting (180 + 270 = 450)
   - Winner selection (Vendor 2 with 450 credits)

---

## Step 6: GO/NO-GO Decision

Once `FEASIBILITY_PROOF.md` is complete:

- [ ] All transactions confirmed on Aleo Explorer
- [ ] Privacy verified (bid amounts not visible)
- [ ] Escrow accounting correct
- [ ] Winner selection correct (lowest bid)
- [ ] Anti-griefing demonstrated (if tested)

**IF ALL PASS** → **GO to V1 Implementation**  
**IF ANY FAIL** → Document blocker and revise approach

---

## Troubleshooting

### "Insufficient funds" error
- Fund accounts with Aleo testnet faucet: https://faucet.aleo.org

### "Transaction failed" error
- Check RFQ state (ensure bidding is open/closed as expected)
- Verify commitment matches reveal (bid_amount + nonce must be identical)

### "Network timeout" error
- Testnet may be slow - wait and retry
- Check Aleo network status: https://status.aleo.org

---

## Next Steps After GO Decision

1. ✅ Finalize `FEASIBILITY_PROOF.md`
2. ✅ Present to stakeholders for approval
3. ✅ Begin V1 implementation with:
   - Enhanced Leo contract (production invariants)
   - Backend API (Node.js + PostgreSQL)
   - Frontend UI (React + Shield Wallet)

---

**Last Updated**: 2026-02-13  
**Contract Version**: Phase 0 PoC  
**Leo Version**: 3.4.0  
**Network**: Aleo Testnet
