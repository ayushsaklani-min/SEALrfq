#!/bin/bash
# SealRFQ Phase 0 - Aleo Testnet Execution Script (Bash/WSL)
# Requires: leo CLI, Aleo private keys in .env

set -e  # Exit on error

echo "=================================================="
echo " SealRFQ Phase 0 - Testnet Execution Script"
echo "=================================================="
echo ""

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
    echo "✅ Loaded environment variables from .env"
else
    echo "❌ .env file not found. Please create one with BUYER_KEY, VENDOR1_KEY, VENDOR2_KEY"
    exit 1
fi

# Verify required variables
for var in BUYER_KEY VENDOR1_KEY VENDOR2_KEY VENDOR2_ADDRESS; do
    if [ -z "${!var}" ]; then
        echo "❌ Missing required environment variable: $var"
        exit 1
    fi
done

echo ""
echo "Step 1: Building contract..."
leo build

echo ""
echo "Step 2: Deploying contract to Aleo Testnet..."
echo "(This may take several minutes for proving...)"
# leo deploy --network testnet --private-key $BUYER_KEY

echo ""
echo "⚠️  MANUAL DEPLOYMENT REQUIRED"
echo "Leo CLI deployment to testnet requires manual steps."
echo "Please run: leo deploy --network testnet --private-key YOUR_KEY"
echo ""
read -p "Press Enter after deployment complete to continue..."

echo ""
echo "Step 3: Buyer creates RFQ (ID: 12345)"
echo "Bidding deadline: block 1000000, Reveal deadline: block 1001440"
# leo run create_rfq 12345field 1000000u32 1001440u32 100u64 \
#   --network testnet --private-key $BUYER_KEY

echo ""
echo "Step 4: Vendor 1 submits bid commit (500 credits, stake 50)"
# leo run submit_bid_commit 12345field 500u64 999field 50u64 \
#   --network testnet --private-key $VENDOR1_KEY

echo ""
echo "Step 5: Vendor 2 submits bid commit (450 credits, stake 45)"
# leo run submit_bid_commit 12345field 450u64 888field 45u64 \
#   --network testnet --private-key $VENDOR2_KEY

echo ""
echo "Step 6: Buyer closes bidding"
# leo run close_bidding <rfq_record> 12345field \
#   --network testnet --private-key $BUYER_KEY

echo ""
echo "Step 7: Vendor 1 reveals bid (500 credits)"
# leo run reveal_bid <bid_commit_record_1> 500u64 999field 12345field <bid_id_1> \
#   --network testnet --private-key $VENDOR1_KEY

echo ""
echo "Step 8: Vendor 2 reveals bid (450 credits - LOWEST)"
# leo run reveal_bid <bid_commit_record_2> 450u64 888field 12345field <bid_id_2> \
#   --network testnet --private-key $VENDOR2_KEY

echo ""
echo "Step 9: Buyer selects winner (Vendor 2)"
# leo run select_winner <rfq_record> 12345field <vendor2_bid_id> \
#   --network testnet --private-key $BUYER_KEY

echo ""
echo "Step 10: Buyer funds escrow (450 credits)"
# leo run fund_escrow 12345field 450u64 \
#   --network testnet --private-key $BUYER_KEY

echo ""
echo "Step 11: Release 40% milestone (180 credits)"
# leo run release_partial_payment <escrow_record> 40u8 $VENDOR2_ADDRESS \
#   --network testnet --private-key $BUYER_KEY

echo ""
echo "Step 12: Release final 60% (270 credits)"
# leo run release_final_payment <escrow_record> $VENDOR2_ADDRESS \
#   --network testnet --private-key $BUYER_KEY

echo ""
echo "=================================================="
echo " ✅ Test script template complete!"
echo "=================================================="
echo ""
echo "NEXT STEPS:"
echo "1. Uncomment leo run commands above"
echo "2. Replace <record> and <bid_id> placeholders with actual values from outputs"
echo "3. Execute each command and capture TX hashes"
echo "4. Document all TX hashes in FEASIBILITY_PROOF.md"
echo "5. Verify privacy on Aleo Explorer"
echo ""
