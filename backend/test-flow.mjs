/**
 * Full Testnet Flow Test — SEAL Dutch + SEAL Vickrey
 *
 * Uses two private keys:
 *   Key1 (Buyer/Admin) = APrivateKey1zkp8XfjyiCg3rUWaoxWcixvgVdJjeBKXd8g8z4JTKoqVfma
 *   Key2 (Vendor)      = APrivateKey1zkp1s9tUTpPdhtkCr6ey5ZNGqKMKcCsBB2MWMZLWPU5QZ93
 *
 * Run:  node test-flow.mjs
 */

const BASE = 'http://localhost:4000';

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

async function api(method, path, body, token, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    const json = await res.json();
    if (json.status !== 'success' && !options.suppressError) {
        console.error(`  ✗ ${method} ${path} → ${res.status}`, JSON.stringify(json.error || json, null, 2));
    }
    return { status: res.status, json };
}

function ok(res, label) {
    if (res.json.status === 'success') {
        console.log(`  ✓ ${label}`);
        return true;
    }
    console.error(`  ✗ ${label}: ${JSON.stringify(res.json.error)}`);
    return false;
}

function expectError(res, label, code) {
    if (res.json.status === 'error' && res.json.error?.code === code) {
        console.log(`  âœ“ ${label} (${code})`);
        return true;
    }
    console.error(`  âœ— ${label}: expected ${code}, got ${JSON.stringify(res.json.error || res.json)}`);
    return false;
}

function randomFieldValue() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let val = 0n;
    for (const b of bytes) val = (val << 8n) | BigInt(b);
    if (val === 0n) val = 1n;
    return `${val}field`;
}

function fakeTxHash() {
    return `at1${Array.from({ length: 58 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')}`;
}

// ═══════════════════════════════════════════════════════════════════
// Auth — uses insecure_signature bypass
// ═══════════════════════════════════════════════════════════════════

async function authenticate(walletAddress) {
    // Step 1: Get nonce challenge
    const challengeRes = await api('POST', '/api/auth/challenge', { walletAddress });
    if (challengeRes.json.status !== 'success') {
        throw new Error(`Challenge failed: ${JSON.stringify(challengeRes.json)}`);
    }
    const { nonce } = challengeRes.json.data;

    // Step 2: Connect with insecure_signature
    const connectRes = await api('POST', '/api/auth/connect', {
        walletAddress,
        nonce,
        signature: 'insecure_signature',
    });
    if (connectRes.json.status !== 'success') {
        throw new Error(`Connect failed: ${JSON.stringify(connectRes.json)}`);
    }

    const { accessToken, role } = connectRes.json.data;
    console.log(`  ✓ Authenticated ${walletAddress.slice(0, 15)}... as ${role}`);
    return accessToken;
}

async function switchRole(token, role) {
    const res = await api('POST', '/api/auth/dev/switch-role', { role }, token);
    if (res.json.status !== 'success') {
        throw new Error(`Switch role failed: ${JSON.stringify(res.json)}`);
    }
    console.log(`  ✓ Switched to ${role}`);
    return res.json.data.accessToken;
}

// ═══════════════════════════════════════════════════════════════════
// Get current block height from Aleo testnet
// ═══════════════════════════════════════════════════════════════════

async function getCurrentBlock() {
    const res = await fetch('https://api.explorer.provable.com/v1/testnet/latest/height');
    const text = await res.text();
    return parseInt(text.trim(), 10);
}

// ═══════════════════════════════════════════════════════════════════
// BHP256 hash helper (for deriving IDs)
// ═══════════════════════════════════════════════════════════════════

let _sdk = null;
async function getSDK() {
    if (!_sdk) _sdk = await import('@provablehq/sdk/testnet.js');
    return _sdk;
}

async function bhpHash(plaintext) {
    const sdk = await getSDK();
    const bhp = new sdk.BHP256();
    const pt = sdk.Plaintext.fromString(plaintext);
    return bhp.hash(pt.toBitsLe()).toString();
}

async function deriveId(creator, salt) {
    return bhpHash(`{ creator: ${creator}, salt: ${salt} }`);
}

async function deriveCommitment(bidAmount, nonce) {
    return bhpHash(`{ bid_amount: ${bidAmount}u64, nonce: ${nonce} }`);
}

async function deriveVickreyCommitment(auctionId, bidder, amount, salt) {
    return bhpHash(`{ auction_id: ${auctionId}, bidder: ${bidder}, amount: ${amount}u64, salt: ${salt} }`);
}

// SHA256-based metadata hash
async function metadataHash(name, desc, qty, unit) {
    const { createHash } = await import('crypto');
    const digest = createHash('sha256')
        .update([name, desc, qty, unit].join('|'))
        .digest('hex');
    const value = BigInt(`0x${digest}`);
    return `${value}field`;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

const BUYER_KEY = 'APrivateKey1zkp8XfjyiCg3rUWaoxWcixvgVdJjeBKXd8g8z4JTKoqVfma';
const VENDOR_KEY = 'APrivateKey1zkp1s9tUTpPdhtkCr6ey5ZNGqKMKcCsBB2MWMZLWPU5QZ93';

async function main() {
    const sdk = await getSDK();

    const buyerPk = sdk.PrivateKey.from_string(BUYER_KEY);
    const vendorPk = sdk.PrivateKey.from_string(VENDOR_KEY);
    const BUYER = buyerPk.to_address().to_string();
    const VENDOR = vendorPk.to_address().to_string();

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  SEAL RFQ v17 — Full Testnet Flow Test');
    console.log('══════════════════════════════════════════════════════');
    console.log(`  Buyer:  ${BUYER}`);
    console.log(`  Vendor: ${VENDOR}`);

    const currentBlock = await getCurrentBlock();
    console.log(`  Block:  ${currentBlock}\n`);

    // ─── Step 0: Authenticate both users ───────────────────────────
    console.log('── Step 0: Authentication ──');
    let buyerToken = await authenticate(BUYER);
    let vendorToken = await authenticate(VENDOR);

    // Switch buyer to BUYER role
    buyerToken = await switchRole(buyerToken, 'BUYER');
    vendorToken = await switchRole(vendorToken, 'VENDOR');

    // ═══════════════════════════════════════════════════════════════
    //  FLOW A: SEAL VICKREY AUCTION
    // ═══════════════════════════════════════════════════════════════
    console.log('\n══════════════════════════════════════════════════════');
    console.log('  FLOW A: SEAL VICKREY AUCTION');
    console.log('══════════════════════════════════════════════════════');

    const vickreySalt = randomFieldValue();
    const rfqSaltV = randomFieldValue();
    const rfqIdV = await deriveId(BUYER, rfqSaltV);
    const auctionIdV = await deriveId(BUYER, vickreySalt);
    const minBidV = '100000'; // 100,000 microcredits
    const biddingDeadlineV = currentBlock + 10; // near-future for testing
    const revealDeadlineV = biddingDeadlineV + 720; // +720 blocks reveal window
    const metaHashV = await metadataHash('Vickrey Test Item', 'Test description', '1', 'lot');

    console.log(`  RFQ ID:     ${rfqIdV.slice(0, 20)}...`);
    console.log(`  Auction ID: ${auctionIdV.slice(0, 20)}...`);

    // ─── A1: Create RFQ (pricingMode=1 Vickrey) ───────────────────
    console.log('\n── A1: Create RFQ (Vickrey mode) ──');
    const createRfqV = await api('POST', '/api/rfq/create', {
        salt: rfqSaltV,
        biddingDeadline: biddingDeadlineV,
        revealDeadline: revealDeadlineV,
        minBid: minBidV,
        minBidCount: 1,
        metadataHash: metaHashV,
        tokenType: 0,
        pricingMode: 1, // Vickrey
        itemName: 'Vickrey Test Item',
        description: 'Test description',
        quantity: '1',
        unit: 'lot',
    }, buyerToken, { suppressError: true });

    // If platform not initialized, this will fail with PLATFORM_NOT_INITIALIZED
    if (createRfqV.json?.error?.code === 'PLATFORM_NOT_INITIALIZED') {
        console.log('  ⚠ Platform not initialized — this needs configure_platform on-chain first.');
        console.log('  ⚠ Testing prepare-only flow (no txHash)...');
    }

    // Try prepare-only mode (no txHash) to check input validation
    const prepareRfqV = await api('POST', '/api/rfq/create', {
        salt: rfqSaltV,
        biddingDeadline: biddingDeadlineV,
        revealDeadline: revealDeadlineV,
        minBid: minBidV,
        minBidCount: 1,
        metadataHash: metaHashV,
        tokenType: 0,
        pricingMode: 1,
        itemName: 'Vickrey Test Item',
        description: 'Test description',
        quantity: '1',
        unit: 'lot',
    }, buyerToken, { suppressError: true });

    if (prepareRfqV.json?.error?.code === 'PLATFORM_NOT_INITIALIZED') {
        console.log('\n  ═══ PLATFORM NOT INITIALIZED ═══');
        console.log('  The platform_config mapping is null on-chain.');
        console.log('  Need to call configure_platform on sealrfq_v17.aleo.');
        console.log('  This requires an on-chain transaction from the admin.');
        console.log('  Proceeding with confirm-path testing (simulated txHash)...\n');

        // Create RFQ directly in DB for testing
        const createRfqDirect = await api('POST', '/api/rfq/create', {
            salt: rfqSaltV,
            biddingDeadline: biddingDeadlineV,
            revealDeadline: revealDeadlineV,
            minBid: minBidV,
            minBidCount: 1,
            metadataHash: metaHashV,
            tokenType: 0,
            pricingMode: 1,
            itemName: 'Vickrey Test Item',
            description: 'Test description',
            quantity: '1',
            unit: 'lot',
            txHash: fakeTxHash(),
        }, buyerToken);
        ok(createRfqDirect, 'Create RFQ (Vickrey mode) via confirm path');
    } else {
        ok(prepareRfqV, 'Prepare RFQ (Vickrey mode)');
        // Record via confirm path
        const confirmRfqV = await api('POST', '/api/rfq/create', {
            salt: rfqSaltV,
            biddingDeadline: biddingDeadlineV,
            revealDeadline: revealDeadlineV,
            minBid: minBidV,
            minBidCount: 1,
            metadataHash: metaHashV,
            tokenType: 0,
            pricingMode: 1,
            itemName: 'Vickrey Test Item',
            description: 'Test description',
            quantity: '1',
            unit: 'lot',
            txHash: fakeTxHash(),
        }, buyerToken);
        ok(confirmRfqV, 'Confirm RFQ (Vickrey mode)');
    }

    // ─── A2: Create Vickrey Auction ────────────────────────────────
    console.log('\n── A2: Create Vickrey Auction ──');
    const createAuctionV = await api('POST', '/api/auction/vickrey', {
        salt: vickreySalt,
        rfqId: rfqIdV,
        tokenType: 0,
        biddingDeadline: biddingDeadlineV,
        revealDeadline: revealDeadlineV,
        minBid: minBidV,
    }, buyerToken);
    ok(createAuctionV, 'Prepare Vickrey auction');

    // Check returned auctionId matches
    if (createAuctionV.json.status === 'success') {
        const returnedAId = createAuctionV.json.data.auctionId;
        console.log(`  → Returned auction ID: ${returnedAId?.slice(0, 20)}...`);
        if (returnedAId && returnedAId !== auctionIdV) {
            console.error('  ✗ MISMATCH: derived auction ID != returned auction ID');
        }
    }

    // ─── A3: Vendor commits bid on Vickrey ─────────────────────────
    console.log('\n── A3: Vendor commits bid (Vickrey) ──');
    const bidAmountV = '150000';
    const bidSaltV = randomFieldValue();
    const bidStakeV = (BigInt(minBidV) / 10n).toString(); // flat_stake = min_bid / 10

    const commitBidV = await api('POST', `/api/auction/vickrey/${encodeURIComponent(auctionIdV)}/commit`, {
        bidAmount: bidAmountV,
        salt: bidSaltV,
        stake: bidStakeV,
    }, vendorToken);
    ok(commitBidV, 'Prepare Vickrey bid commit');

    const bidIdV = commitBidV.json?.data?.bidId;
    if (bidIdV) console.log(`  → Bid ID: ${bidIdV.slice(0, 20)}...`);

    // ─── A4: Vendor reveals bid ────────────────────────────────────
    console.log('\n── A4: Vendor reveals bid (Vickrey) ──');
    if (bidIdV) {
        const revealBidV = await api('POST', `/api/auction/vickrey/${encodeURIComponent(auctionIdV)}/reveal`, {
            bidId: bidIdV,
            amount: bidAmountV,
            salt: bidSaltV,
        }, vendorToken);
        ok(revealBidV, 'Prepare Vickrey bid reveal');
    } else {
        console.log('  ⚠ Skipped — no bid ID from commit step');
    }

    // ─── A5: Finalize Vickrey Auction ──────────────────────────────
    console.log('\n── A5: Finalize Vickrey Auction ──');
    const finalizeV = await api('POST', `/api/auction/vickrey/${encodeURIComponent(auctionIdV)}/finalize`, {}, buyerToken);
    ok(finalizeV, 'Prepare Vickrey finalize');

    // ─── A6: Import Auction Result to RFQ ──────────────────────────
    console.log('\n── A6: Import Auction Result to RFQ ──');
    const importV = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdV)}/import-auction`, {
        auctionId: auctionIdV,
        winnerAddress: VENDOR,
        price: bidAmountV,
        auctionType: 1, // Vickrey
    }, buyerToken, { suppressError: true });
    expectError(importV, 'Prepare import auction result blocked on live chain state', 'INVALID_STATE');

    // Confirm import (with txHash to record in DB)
    const importConfirmV = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdV)}/import-auction`, {
        auctionId: auctionIdV,
        winnerAddress: VENDOR,
        price: bidAmountV,
        auctionType: 1,
        txHash: fakeTxHash(),
    }, buyerToken);
    ok(importConfirmV, 'Confirm import auction result');

    // ─── A7: Get RFQ Details ───────────────────────────────────────
    console.log('\n── A7: Get RFQ Details ──');
    const rfqDetailsV = await api('GET', `/api/rfq/${encodeURIComponent(rfqIdV)}`, null, buyerToken);
    ok(rfqDetailsV, 'Get RFQ details (Vickrey)');
    if (rfqDetailsV.json.status === 'success') {
        const d = rfqDetailsV.json.data;
        console.log(`  → Status: ${d.status}, PricingMode: ${d.pricingMode}, Winner: ${d.winningVendor?.slice(0, 15)}...`);
    }

    // ─── A8: Winner Responds ───────────────────────────────────────
    console.log('\n── A8: Winner Responds (accept) ──');
    const winnerRespondV = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdV)}/winner-respond`, {
        accept: true,
    }, vendorToken);
    ok(winnerRespondV, 'Prepare winner respond');

    // Confirm
    const winnerConfirmV = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdV)}/winner-respond`, {
        accept: true,
        txHash: fakeTxHash(),
    }, vendorToken);
    ok(winnerConfirmV, 'Confirm winner respond');

    // ─── A9: Fund Escrow ───────────────────────────────────────────
    console.log('\n── A9: Fund Escrow ──');
    const fundEscrowV = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdV)}/fund-escrow`, {
        amount: bidAmountV,
    }, buyerToken, { suppressError: true });
    expectError(fundEscrowV, 'Prepare fund escrow blocked on live chain state', 'INVALID_STATE');

    // Confirm
    const fundConfirmV = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdV)}/fund-escrow`, {
        amount: bidAmountV,
        txHash: fakeTxHash(),
    }, buyerToken);
    ok(fundConfirmV, 'Confirm fund escrow');

    console.log('\nâ”€â”€ A9b: Escrow workspace (Vickrey) â”€â”€');
    const escrowV = await api('GET', `/api/escrow/${encodeURIComponent(rfqIdV)}`, null, buyerToken);
    ok(escrowV, 'Get escrow details (Vickrey)');

    const partialReleaseV = await api('POST', `/api/escrow/${encodeURIComponent(rfqIdV)}/release`, {
        amount: '75000',
        txHash: fakeTxHash(),
    }, buyerToken);
    ok(partialReleaseV, 'Confirm partial release (Vickrey)');

    const escrowVAfterRelease = await api('GET', `/api/escrow/${encodeURIComponent(rfqIdV)}`, null, buyerToken);
    ok(escrowVAfterRelease, 'Get escrow after partial release (Vickrey)');

    // ─── A10: List Vickrey Auctions ────────────────────────────────
    console.log('\n── A10: List Vickrey Auctions ──');
    const listVickrey = await api('GET', '/api/auction/vickrey', null, buyerToken);
    ok(listVickrey, 'List Vickrey auctions');

    // ─── A11: Get Vickrey Auction ──────────────────────────────────
    console.log('\n── A11: Get Vickrey Auction Details ──');
    const getVickreyAuction = await api('GET', `/api/auction/vickrey/${encodeURIComponent(auctionIdV)}`, null, buyerToken);
    ok(getVickreyAuction, 'Get Vickrey auction details');

    console.log('\n  ═══ Vickrey Flow: COMPLETED ═══\n');

    // ═══════════════════════════════════════════════════════════════
    //  FLOW B: SEAL DUTCH AUCTION
    // ═══════════════════════════════════════════════════════════════
    console.log('══════════════════════════════════════════════════════');
    console.log('  FLOW B: SEAL DUTCH AUCTION');
    console.log('══════════════════════════════════════════════════════');

    const dutchSalt = randomFieldValue();
    const rfqSaltD = randomFieldValue();
    const rfqIdD = await deriveId(BUYER, rfqSaltD);
    const auctionIdD = await deriveId(BUYER, dutchSalt);
    const startPriceD = '500000';
    const reservePriceD = '100000';
    const decrementD = '1000';
    const biddingDeadlineD = currentBlock + 10;
    const revealDeadlineD = biddingDeadlineD + 720;
    const startBlockD = currentBlock + 5;
    const endBlockD = startBlockD + 500;
    const metaHashD = await metadataHash('Dutch Test Item', 'Dutch test description', '5', 'units');

    console.log(`  RFQ ID:     ${rfqIdD.slice(0, 20)}...`);
    console.log(`  Auction ID: ${auctionIdD.slice(0, 20)}...`);

    // ─── B1: Create RFQ (pricingMode=2 Dutch) ──────────────────────
    console.log('\n── B1: Create RFQ (Dutch mode) ──');
    const createRfqD = await api('POST', '/api/rfq/create', {
        salt: rfqSaltD,
        biddingDeadline: biddingDeadlineD,
        revealDeadline: revealDeadlineD,
        minBid: reservePriceD,
        minBidCount: 1,
        metadataHash: metaHashD,
        tokenType: 0,
        pricingMode: 2, // Dutch
        itemName: 'Dutch Test Item',
        description: 'Dutch test description',
        quantity: '5',
        unit: 'units',
        txHash: fakeTxHash(),
    }, buyerToken);
    ok(createRfqD, 'Create RFQ (Dutch mode)');

    // ─── B2: Create Dutch Auction ──────────────────────────────────
    console.log('\n── B2: Create Dutch Auction ──');
    const createAuctionD = await api('POST', '/api/auction/dutch', {
        salt: dutchSalt,
        rfqId: rfqIdD,
        tokenType: 0,
        startPrice: startPriceD,
        reservePrice: reservePriceD,
        decrementPerBlock: decrementD,
        startBlock: startBlockD,
        endBlock: endBlockD,
    }, buyerToken);
    ok(createAuctionD, 'Prepare Dutch auction');

    if (createAuctionD.json.status === 'success') {
        const returnedDId = createAuctionD.json.data.auctionId;
        console.log(`  → Returned auction ID: ${returnedDId?.slice(0, 20)}...`);
    }

    // ─── B3: Vendor commits to accept ──────────────────────────────
    console.log('\n── B3: Vendor commits to accept (Dutch) ──');
    const acceptSalt = randomFieldValue();
    const commitAcceptD = await api('POST', `/api/auction/dutch/${encodeURIComponent(auctionIdD)}/commit-accept`, {
        salt: acceptSalt,
    }, vendorToken);
    ok(commitAcceptD, 'Prepare Dutch commit-accept');

    // ─── B4: Vendor confirms accept ────────────────────────────────
    console.log('\n── B4: Vendor confirms accept (Dutch) ──');
    const confirmAcceptD = await api('POST', `/api/auction/dutch/${encodeURIComponent(auctionIdD)}/confirm-accept`, {
        salt: acceptSalt,
    }, vendorToken);
    ok(confirmAcceptD, 'Prepare Dutch confirm-accept');

    // ─── B5: Import Auction Result to RFQ ──────────────────────────
    console.log('\n── B5: Import Auction Result to RFQ ──');

    // Calculate Dutch price at current block for import
    const elapsed = BigInt(Math.max(0, currentBlock - startBlockD));
    const sp = BigInt(startPriceD);
    const rp = BigInt(reservePriceD);
    const dec = BigInt(decrementD);
    let dutchPrice = sp - (elapsed * dec);
    if (dutchPrice < rp) dutchPrice = rp;

    const importD = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdD)}/import-auction`, {
        auctionId: auctionIdD,
        winnerAddress: VENDOR,
        price: dutchPrice.toString(),
        auctionType: 2, // Dutch
    }, buyerToken, { suppressError: true });
    expectError(importD, 'Prepare import Dutch auction result blocked on live chain state', 'INVALID_STATE');

    // Confirm import
    const importConfirmD = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdD)}/import-auction`, {
        auctionId: auctionIdD,
        winnerAddress: VENDOR,
        price: dutchPrice.toString(),
        auctionType: 2,
        txHash: fakeTxHash(),
    }, buyerToken);
    ok(importConfirmD, 'Confirm import Dutch auction result');

    // ─── B6: Get RFQ Details ───────────────────────────────────────
    console.log('\n── B6: Get RFQ Details ──');
    const rfqDetailsD = await api('GET', `/api/rfq/${encodeURIComponent(rfqIdD)}`, null, buyerToken);
    ok(rfqDetailsD, 'Get RFQ details (Dutch)');
    if (rfqDetailsD.json.status === 'success') {
        const d = rfqDetailsD.json.data;
        console.log(`  → Status: ${d.status}, PricingMode: ${d.pricingMode}, Winner: ${d.winningVendor?.slice(0, 15)}...`);
    }

    // ─── B7: Winner Responds ───────────────────────────────────────
    console.log('\n── B7: Winner Responds (accept) ──');
    const winnerRespondD = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdD)}/winner-respond`, {
        accept: true,
    }, vendorToken);
    ok(winnerRespondD, 'Prepare winner respond (Dutch)');

    // Confirm
    const winnerConfirmD = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdD)}/winner-respond`, {
        accept: true,
        txHash: fakeTxHash(),
    }, vendorToken);
    ok(winnerConfirmD, 'Confirm winner respond (Dutch)');

    // ─── B8: Fund Escrow ───────────────────────────────────────────
    console.log('\n── B8: Fund Escrow ──');
    const fundEscrowD = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdD)}/fund-escrow`, {
        amount: dutchPrice.toString(),
    }, buyerToken, { suppressError: true });
    expectError(fundEscrowD, 'Prepare fund escrow (Dutch) blocked on live chain state', 'INVALID_STATE');

    // Confirm
    const fundConfirmD = await api('POST', `/api/rfq/${encodeURIComponent(rfqIdD)}/fund-escrow`, {
        amount: dutchPrice.toString(),
        txHash: fakeTxHash(),
    }, buyerToken);
    ok(fundConfirmD, 'Confirm fund escrow (Dutch)');

    console.log('\nâ”€â”€ B8b: Escrow workspace (Dutch) â”€â”€');
    const escrowD = await api('GET', `/api/escrow/${encodeURIComponent(rfqIdD)}`, null, buyerToken);
    ok(escrowD, 'Get escrow details (Dutch)');

    const invoiceD = await api('POST', `/api/escrow/${encodeURIComponent(rfqIdD)}/pay-invoice`, {
        paymentRecord: 'invoice_001',
        receiptNonce: randomFieldValue(),
        txHash: fakeTxHash(),
    }, buyerToken);
    ok(invoiceD, 'Confirm invoice payment (Dutch)');

    const recoverBondD = await api('POST', `/api/escrow/${encodeURIComponent(rfqIdD)}/recover-bond`, {
        txHash: fakeTxHash(),
    }, buyerToken);
    ok(recoverBondD, 'Confirm recover escrow bond (Dutch)');

    // ─── B9: List Dutch Auctions ───────────────────────────────────
    console.log('\n── B9: List Dutch Auctions ──');
    const listDutch = await api('GET', '/api/auction/dutch', null, buyerToken);
    ok(listDutch, 'List Dutch auctions');

    // ─── B10: Get Dutch Auction ────────────────────────────────────
    console.log('\n── B10: Get Dutch Auction Details ──');
    const getDutchAuction = await api('GET', `/api/auction/dutch/${encodeURIComponent(auctionIdD)}`, null, buyerToken);
    ok(getDutchAuction, 'Get Dutch auction details');

    console.log('\n  ═══ Dutch Flow: COMPLETED ═══\n');

    // ═══════════════════════════════════════════════════════════════
    //  EXTRA: Cross-cutting API tests
    // ═══════════════════════════════════════════════════════════════
    console.log('══════════════════════════════════════════════════════');
    console.log('  EXTRA: Cross-cutting API Tests');
    console.log('══════════════════════════════════════════════════════');

    // List open RFQs
    console.log('\n── List Open RFQs ──');
    const listRfqs = await api('GET', '/api/rfq/open', null, buyerToken);
    ok(listRfqs, 'List open RFQs');
    console.log(`  → Found ${listRfqs.json?.data?.length ?? 0} RFQ(s)`);

    // My RFQs
    console.log('\n── My RFQs ──');
    const myRfqs = await api('GET', '/api/rfq/my-rfqs', null, buyerToken);
    ok(myRfqs, 'Get buyer\'s RFQs');
    console.log(`  → Found ${myRfqs.json?.data?.length ?? 0} RFQ(s)`);

    // My Bids
    console.log('\n── My Bids ──');
    const myBids = await api('GET', '/api/bid/my-bids', null, vendorToken);
    ok(myBids, 'Get vendor\'s bids');
    console.log(`  → Found ${myBids.json?.data?.length ?? 0} bid(s)`);

    // Auth me
    console.log('\n── Auth: Who am I? ──');
    const meB = await api('GET', '/api/auth/me', null, buyerToken);
    ok(meB, 'Buyer auth/me');
    const meV = await api('GET', '/api/auth/me', null, vendorToken);
    ok(meV, 'Vendor auth/me');

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  TEST COMPLETE');
    console.log('══════════════════════════════════════════════════════\n');
}

main().catch((err) => {
    console.error('\n  ✗ FATAL ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
});
