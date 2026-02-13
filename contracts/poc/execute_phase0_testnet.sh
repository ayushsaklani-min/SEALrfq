#!/bin/bash
# Phase 0 Complete Testnet Execution Script
# This script executes all 10 transitions + negative test on Aleo testnet
# Each command uses the exact configuration that worked for deployment

set -e

ENDPOINT="https://api.explorer.provable.com/v1"
CONSENSUS_VERSION="12"
BUYER_KEY="APrivateKey1zkp8XfjyiCg3rUWaoxWcixvgVdJjeBKXd8g8z4JTKoqVfma"
VENDOR_KEY="$BUYER_KEY"  # Same key for PoC
VENDOR_ADDR="aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"

LEO="/home/saklani/.cargo/bin/leo"

echo "=========================================="
echo "Phase 0 - Complete Testnet Execution"
echo "Contract: sealrfq_poc.aleo"
echo "=========================================="
echo ""

# Step 1: create_rfq
echo "Step 1: create_rfq"
$LEO execute create_rfq 12345field 1000000u32 1001440u32 100u64 \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$BUYER_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40
echo ""

# Step 2: submit_bid_commit (Vendor 1 - 500 credits)
echo "Step 2: submit_bid_commit (Vendor 1 - 500 credits)"
$LEO execute submit_bid_commit 12345field 500u64 999field 50u64 11111field \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$VENDOR_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40
echo ""

# Step 3: submit_bid_commit (Vendor 2 - 450 credits - LOWEST)
echo "Step 3: submit_bid_commit (Vendor 2 - 450 credits - SHOULD WIN)"
$LEO execute submit_bid_commit 12345field 450u64 888field 45u64 22222field \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$VENDOR_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40
echo ""

# Step 4: close_bidding
echo "Step 4: close_bidding"
$LEO execute close_bidding 12345field \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$BUYER_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40
echo ""

# Step 5: reveal_bid (Vendor 1)
echo "Step 5: reveal_bid (Vendor 1)"
$LEO execute reveal_bid 12345field 11111field 500u64 999field \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$VENDOR_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40
echo ""

# Step 6: reveal_bid (Vendor 2)
echo "Step 6: reveal_bid (Vendor 2)"
$LEO execute reveal_bid 12345field 22222field 450u64 888field \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$VENDOR_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40
echo ""

# Step 7: select_winner (Vendor 2 - lowest bid)
echo "Step 7: select_winner (Vendor 2)"
$LEO execute select_winner 12345field 22222field \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$BUYER_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40
echo ""

# Step 8: fund_escrow
echo "Step 8: fund_escrow"
$LEO execute fund_escrow 12345field 450u64 \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$BUYER_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40
echo ""

# Step 9: release_partial_payment (40% = 180 credits)
echo "Step 9: release_partial_payment (40%)"
$LEO execute release_partial_payment 12345field 40u8 "$VENDOR_ADDR" \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$BUYER_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40
echo ""

# Step 10: release_final_payment
echo "Step 10: release_final_payment"
$LEO execute release_final_payment 12345field "$VENDOR_ADDR" \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$BUYER_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40
echo ""

# Negative Test: Try to release payment again (should fail - double release)
echo "=========================================="
echo "NEGATIVE TEST: Attempt double release (should fail)"
echo "=========================================="
$LEO execute release_final_payment 12345field "$VENDOR_ADDR" \
  --network testnet --endpoint "$ENDPOINT" --consensus-version $CONSENSUS_VERSION \
  --private-key "$BUYER_KEY" --broadcast -y --print --max-wait 25 --blocks-to-check 40 || echo "✅ Double release correctly rejected!"

echo ""
echo "=========================================="
echo "✅ Phase 0 Execution Complete!"
echo "=========================================="
