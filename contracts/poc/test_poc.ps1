# Requires: leo CLI, Aleo private keys in .env
# Usage: .\test_poc.ps1

$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " SealRFQ Phase 0 - Testnet Execution Script" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Load environment variables from .env file
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
    Write-Host "✅ Loaded environment variables from .env" -ForegroundColor Green
} else {
    Write-Host "❌ .env file not found. Please create one with BUYER_KEY, VENDOR1_KEY, VENDOR2_KEY" -ForegroundColor Red
    exit 1
}

# Verify required environment variables
$required_vars = @("BUYER_KEY", "VENDOR1_KEY", "VENDOR2_KEY", "VENDOR2_ADDRESS")
foreach ($var in $required_vars) {
    if (-not [Environment]::GetEnvironmentVariable($var)) {
        Write-Host "❌ Missing required environment variable: $var" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Step 1: Building contract..." -ForegroundColor Cyan
leo build

Write-Host ""
Write-Host "Step 2: Deploying contract to Aleo Testnet..." -ForegroundColor Cyan
Write-Host "(This may take several minutes for proving...)" -ForegroundColor Yellow
# leo deploy --network testnet --private-key $env:BUYER_KEY

Write-Host ""
Write-Host "⚠️  MANUAL DEPLOYMENT REQUIRED" -ForegroundColor Yellow
Write-Host "Leo CLI deployment to testnet requires manual steps." -ForegroundColor Yellow
Write-Host "Please run: leo deploy --network testnet --private-key YOUR_KEY" -ForegroundColor Yellow
Write-Host ""
Read-Host "Press Enter after deployment complete to continue"

Write-Host ""
Write-Host "Step 3: Buyer creates RFQ (ID: 12345)" -ForegroundColor Cyan
Write-Host "Bidding deadline: block 1000000, Reveal deadline: block 1001440" -ForegroundColor Gray
# leo run create_rfq 12345field 1000000u32 1001440u32 100u64 `
#   --network testnet --private-key $env:BUYER_KEY

Write-Host ""
Write-Host "Step 4: Vendor 1 submits bid commit (500 credits, stake 50)" -ForegroundColor Cyan
# leo run submit_bid_commit 12345field 500u64 999field 50u64 `
#   --network testnet --private-key $env:VENDOR1_KEY

Write-Host ""
Write-Host "Step 5: Vendor 2 submits bid commit (450 credits, stake 45)" -ForegroundColor Cyan
# leo run submit_bid_commit 12345field 450u64 888field 45u64 `
#   --network testnet --private-key $env:VENDOR2_KEY

Write-Host ""
Write-Host "Step 6: Buyer closes bidding" -ForegroundColor Cyan
# leo run close_bidding <rfq_record> 12345field `
#   --network testnet --private-key $env:BUYER_KEY

Write-Host ""
Write-Host "Step 7: Vendor 1 reveals bid (500 credits)" -ForegroundColor Cyan
# leo run reveal_bid <bid_commit_record_1> 500u64 999field 12345field <bid_id_1> `
#   --network testnet --private-key $env:VENDOR1_KEY

Write-Host ""
Write-Host "Step 8: Vendor 2 reveals bid (450 credits - LOWEST)" -ForegroundColor Cyan
# leo run reveal_bid <bid_commit_record_2> 450u64 888field 12345field <bid_id_2> `
#   --network testnet --private-key $env:VENDOR2_KEY

Write-Host ""
Write-Host "Step 9: Buyer selects winner (Vendor 2)" -ForegroundColor Cyan
# leo run select_winner <rfq_record> 12345field <vendor2_bid_id> `
#   --network testnet --private-key $env:BUYER_KEY

Write-Host ""
Write-Host "Step 10: Buyer funds escrow (450 credits)" -ForegroundColor Cyan
# leo run fund_escrow 12345field 450u64 `
#   --network testnet --private-key $env:BUYER_KEY

Write-Host ""
Write-Host "Step 11: Release 40% milestone (180 credits)" -ForegroundColor Cyan
# leo run release_partial_payment <escrow_record> 40u8 $env:VENDOR2_ADDRESS `
#   --network testnet --private-key $env:BUYER_KEY

Write-Host ""
Write-Host "Step 12: Release final 60% (270 credits)" -ForegroundColor Cyan
# leo run release_final_payment <escrow_record> $env:VENDOR2_ADDRESS `
#   --network testnet --private-key $env:BUYER_KEY

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " ✅ Test script template complete!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "1. Uncomment leo run commands above" -ForegroundColor White
Write-Host "2. Replace <record> and <bid_id> placeholders with actual values from outputs" -ForegroundColor White
Write-Host "3. Execute each command and capture TX hashes" -ForegroundColor White
Write-Host "4. Document all TX hashes in FEASIBILITY_PROOF.md" -ForegroundColor White
Write-Host "5. Verify privacy on Aleo Explorer" -ForegroundColor White
Write-Host ""
