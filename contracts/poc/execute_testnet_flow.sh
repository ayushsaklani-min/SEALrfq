#!/bin/bash
# Aleo Testnet - Full RFQ Flow Execution
# Run this script to execute all transitions and capture TX hashes

set -e

# Load environment
source .env

PROGRAM_ID="sealrfq_poc.aleo"
RFQ_ID="12345field"
BID1_ID="11111field"
BID2_ID="22222field"
BID1_AMOUNT="500u64"
BID2_AMOUNT="450u64"
BID1_NONCE="999field"
BID2_NONCE="888field"
STAKE1="50u64"
STAKE2="45u64"

echo "=========================================="
echo "Aleo Testnet - sealrfq_poc.aleo"
echo "Full RFQ Flow Execution"
echo "=========================================="
echo ""

# TRANSITION 1: Create RFQ
echo "1️⃣  Creating RFQ (ID: $RFQ_ID)..."
leo execute create_rfq \
  $RFQ_ID \
  1000000u32 \
  1001440u32 \
  100u64 \
  --private-key $BUYER_KEY \
  --network testnet \
  --endpoint $ALEO_RPC_URL

echo ""
echo "⏸️  PAUSE - Copy the TX hash above and update TESTNET_EXECUTION.md"
echo "Press Enter to continue..."
read

# TRANSITION 2: Submit Bid #1 (Vendor 1 - 500 credits)
echo ""
echo "2️⃣  Vendor 1 submitting bid ($BID1_AMOUNT)..."
leo execute submit_bid_commit \
  $RFQ_ID \
  $BID1_AMOUNT \
  $BID1_NONCE \
  $STAKE1 \
  $BID1_ID \
  --private-key $VENDOR1_KEY \
  --network testnet \
  --endpoint $ALEO_RPC_URL

echo ""
echo "⏸️  PAUSE - Copy the TX hash above"
echo "Press Enter to continue..."
read

# TRANSITION 3: Submit Bid #2 (Vendor 2 - 450 credits - SHOULD WIN)
echo ""
echo "3️⃣  Vendor 2 submitting bid ($BID2_AMOUNT - LOWEST)..."
leo execute submit_bid_commit \
  $RFQ_ID \
  $BID2_AMOUNT \
  $BID2_NONCE \
  $STAKE2 \
  $BID2_ID \
  --private-key $VENDOR2_KEY \
  --network testnet \
  --endpoint $ALEO_RPC_URL

echo ""
echo "⏸️  PAUSE - Copy the TX hash above"
echo "Press Enter to continue..."
read

# TRANSITION 4: Close Bidding
echo ""
echo "4️⃣  Buyer closing bidding..."
leo execute close_bidding \
  $RFQ_ID \
  --private-key $BUYER_KEY \
  --network testnet \
  --endpoint $ALEO_RPC_URL

echo ""
echo "⏸️  PAUSE - Copy the TX hash above"
echo "Press Enter to continue..."
read

# TRANSITION 5: Vendor 1 Reveals Bid
echo ""
echo "5️⃣  Vendor 1 revealing bid..."
leo execute reveal_bid \
  $RFQ_ID \
  $BID1_ID \
  $BID1_AMOUNT \
  $BID1_NONCE \
  --private-key $VENDOR1_KEY \
  --network testnet \
  --endpoint $ALEO_RPC_URL

echo ""
echo "⏸️  PAUSE - Copy the TX hash above"
echo "Press Enter to continue..."
read

# TRANSITION 6: Vendor 2 Reveals Bid
echo ""
echo "6️⃣  Vendor 2 revealing bid..."
leo execute reveal_bid \
  $RFQ_ID \
  $BID2_ID \
  $BID2_AMOUNT \
  $BID2_NONCE \
  --private-key $VENDOR2_KEY \
  --network testnet \
  --endpoint $ALEO_RPC_URL

echo ""
echo "⏸️  PAUSE - Copy the TX hash above"
echo "Press Enter to continue..."
read

# TRANSITION 7: Select Winner (Vendor 2 with 450 credits)
echo ""
echo "7️⃣  Buyer selecting winner (Vendor 2 - lowest bid)..."
leo execute select_winner \
  $RFQ_ID \
  $BID2_ID \
  --private-key $BUYER_KEY \
  --network testnet \
  --endpoint $ALEO_RPC_URL

echo ""
echo "⏸️  PAUSE - Copy the TX hash above"
echo "Press Enter to continue..."
read

# TRANSITION 8: Fund Escrow
echo ""
echo "8️⃣  Buyer funding escrow (450 credits)..."
leo execute fund_escrow \
  $RFQ_ID \
  450u64 \
  --private-key $BUYER_KEY \
  --network testnet \
  --endpoint $ALEO_RPC_URL

echo ""
echo "⏸️  PAUSE - Copy the TX hash above"
echo "Press Enter to continue..."
read

# TRANSITION 9: Release Partial Payment (40% = 180 credits)
echo ""
echo "9️⃣  Buyer releasing 40% (180 credits)..."
leo execute release_partial_payment \
  $RFQ_ID \
  40u8 \
  $VENDOR2_ADDRESS \
  --private-key $BUYER_KEY \
  --network testnet \
  --endpoint $ALEO_RPC_URL

echo ""
echo "⏸️  PAUSE - Copy the TX hash above"
echo "Press Enter to continue..."
read

# TRANSITION 10: Release Final Payment (60% = 270 credits)
echo ""
echo "🔟  Buyer releasing final payment (270 credits)..."
leo execute release_final_payment \
  $RFQ_ID \
  $VENDOR2_ADDRESS \
  --private-key $BUYER_KEY \
  --network testnet \
  --endpoint $ALEO_RPC_URL

echo ""
echo "=========================================="
echo "✅ ALL TRANSITIONS COMPLETED!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Update TESTNET_EXECUTION.md with all TX hashes"
echo "2. Verify privacy on Aleo Explorer (bid amounts should NOT be visible)"
echo "3. Take screenshots of privacy verification"
echo "4. Complete FEASIBILITY_PROOF.md"
echo "5. Make GO/NO-GO decision for V1"
