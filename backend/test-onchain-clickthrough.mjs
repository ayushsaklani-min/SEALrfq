/**
 * Real on-chain clickthrough runner (API prepare -> leo execute -> API confirm)
 *
 * Usage:
 *   node test-onchain-clickthrough.mjs
 *
 * Prereqs:
 * - Backend running at http://localhost:4000
 * - WSL + leo CLI installed
 * - Backend auth allows insecure signature in dev
 */

import { spawn } from 'child_process';
import crypto from 'crypto';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4000';
const RPC = process.env.ALEO_RPC_URL || 'https://api.explorer.provable.com/v1';
const NETWORK = process.env.ALEO_NETWORK || 'testnet';

const PRIVATE_KEY_BUYER =
    process.env.PRIVATE_KEY_BUYER ||
    'APrivateKey1zkp8XfjyiCg3rUWaoxWcixvgVdJjeBKXd8g8z4JTKoqVfma';
const PRIVATE_KEY_VENDOR =
    process.env.PRIVATE_KEY_WINNER ||
    process.env.PRIVATE_KEY_VENDOR ||
    'APrivateKey1zkp1s9tUTpPdhtkCr6ey5ZNGqKMKcCsBB2MWMZLWPU5QZ93';

const PRICING_MODE = {
    RFQ: 0,
    VICKREY: 1,
    DUTCH: 2,
};

const TOKEN_TYPE = {
    CREDITS: 0,
};

const RFQ_STATUS = {
    OPEN: 'OPEN',
    WINNER_SELECTED: 'WINNER_SELECTED',
    ESCROW_FUNDED: 'ESCROW_FUNDED',
    COMPLETED: 'COMPLETED',
};

function log(msg) {
    console.log(msg);
}

function pass(label, extra = '') {
    console.log(`  ✓ ${label}${extra ? `: ${extra}` : ''}`);
}

function fail(label, extra = '') {
    console.error(`  ✗ ${label}${extra ? `: ${extra}` : ''}`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomField() {
    const bytes = crypto.randomBytes(16);
    const value = BigInt(`0x${bytes.toString('hex')}`) || 1n;
    return `${value.toString()}field`;
}

function fakeMetadataHash() {
    const digest = crypto.createHash('sha256').update(`meta:${Date.now()}:${Math.random()}`).digest('hex');
    return `${BigInt(`0x${digest}`).toString()}field`;
}

async function getCurrentBlock() {
    const res = await fetch(`${RPC}/${NETWORK}/latest/height`);
    const txt = (await res.text()).trim();
    const n = Number(txt);
    if (!Number.isFinite(n)) {
        throw new Error(`Failed to parse current block: ${txt}`);
    }
    return n;
}

async function api(method, path, body, token, { allowError = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        json = { status: 'error', error: { message: text } };
    }
    if (!allowError && (!res.ok || json.status !== 'success')) {
        throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json.error || json)}`);
    }
    return { res, json };
}

async function authenticate(walletAddress) {
    const challenge = await api('POST', '/api/auth/challenge', { walletAddress });
    const nonce = challenge.json?.data?.nonce;
    if (!nonce) throw new Error(`Missing nonce for ${walletAddress}`);

    const connect = await api('POST', '/api/auth/connect', {
        walletAddress,
        nonce,
        signature: 'insecure_signature',
    });
    const token = connect.json?.data?.accessToken;
    if (!token) throw new Error(`Missing access token for ${walletAddress}`);
    return token;
}

async function switchRole(token, role) {
    const resp = await api('POST', '/api/auth/dev/switch-role', { role }, token);
    return resp.json?.data?.accessToken || token;
}

async function deriveAddressFromPrivateKey(privateKey) {
    const sdk = await import('@provablehq/sdk/testnet.js');
    const pk = sdk.PrivateKey.from_string(privateKey);
    return pk.to_address().to_string();
}

function shSingleQuote(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

async function leoExecute({ program, fn, inputs, privateKey }) {
    const inputArgs = inputs.map((v) => shSingleQuote(v)).join(' ');
    const command = [
        'leo execute',
        shSingleQuote(`${program}/${fn}`),
        inputArgs,
        '--network',
        shSingleQuote(NETWORK),
        '--endpoint',
        shSingleQuote(RPC),
        '--private-key',
        shSingleQuote(privateKey),
        '--broadcast',
        '-y',
        '--print',
    ].join(' ');

    const { raw, exitCode } = await new Promise((resolve, reject) => {
        const child = spawn('wsl', ['-e', 'bash', '-lc', command], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({
                raw: `${stdout}\n${stderr}`.trim(),
                exitCode: typeof code === 'number' ? code : 1,
            });
        });
    });

    const outputText = String(raw);
    const executionTxMatch = raw.match(/transaction ID:\s*'?(at1[0-9a-z]{40,})'?/i);
    const jsonExecuteIdMatch = raw.match(/"type"\s*:\s*"execute"[\s\S]{0,250}?"id"\s*:\s*"(at1[0-9a-z]{40,})"/i);
    const fallbackMatch = raw.match(/(at1[0-9a-z]{40,})/i);
    const txHashFromBroadcast = executionTxMatch?.[1] || null;
    const txHashFromExecution = jsonExecuteIdMatch?.[1] || null;
    const txHashFallback = fallbackMatch?.[1] || null;
    const txHash =
        txHashFromBroadcast ||
        (exitCode === 0 ? txHashFromExecution || txHashFallback : null);
    const feeTxHash = raw.match(/fee transaction ID:\s*'?(at1[0-9a-z]{40,})'?/i)?.[1] || null;

    if (!txHash) {
        throw new Error(`leo failed (${exitCode}): ${outputText}`);
    }
    return { txHash, feeTxHash, raw: outputText, exitCode };
}

async function fetchExplorerTx(txHash) {
    const response = await fetch(`${RPC}/${NETWORK}/transaction/${txHash}`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Explorer tx lookup failed (${response.status}) for ${txHash}`);
    }
    return response.json();
}

async function waitForExecutedTransition({ txHash, program, fn, timeoutMs = 180000, intervalMs = 5000 }) {
    const start = Date.now();
    let lastError = null;

    while (Date.now() - start < timeoutMs) {
        try {
            const tx = await fetchExplorerTx(txHash);
            if (tx?.type === 'execute') {
                const transitions = tx?.execution?.transitions || [];
                const matched = transitions.some((t) => t?.program === program && t?.function === fn);
                if (matched) return tx;
                lastError = new Error(`Execute tx found, but transition ${program}/${fn} not present`);
            } else if (tx?.type === 'fee') {
                throw new Error(`Transaction ${txHash} is fee-only (likely rejected execution)`);
            } else {
                lastError = new Error(`Transaction type not execute yet: ${tx?.type ?? 'unknown'}`);
            }
        } catch (error) {
            lastError = error;
        }
        await sleep(intervalMs);
    }

    throw new Error(`Timed out waiting for executed transition ${program}/${fn} for ${txHash}. Last error: ${lastError?.message || 'unknown'}`);
}

async function waitFor(label, fn, { timeoutMs = 240000, intervalMs = 5000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const value = await fn();
            if (value) {
                pass(label);
                return value;
            }
        } catch {
            // keep polling
        }
        await sleep(intervalMs);
    }
    throw new Error(`Timeout waiting for: ${label}`);
}

async function runWalletFirstLike({
    label,
    url,
    prepareBody,
    confirmBuilder,
    token,
    privateKey,
}) {
    const prepared = await api('POST', url, prepareBody, token);
    const txData = prepared.json?.data?.tx;
    if (!txData?.request?.program || !txData?.request?.function) {
        throw new Error(`${label}: prepare response missing tx.request`);
    }

    const idempotencyKey = txData.idempotencyKey;
    const req = txData.request;

    const exec = await leoExecute({
        program: req.program,
        fn: req.function,
        inputs: req.inputs || [],
        privateKey,
    });
    await waitForExecutedTransition({
        txHash: exec.txHash,
        program: req.program,
        fn: req.function,
    });

    await api(
        'POST',
        `/api/tx/${encodeURIComponent(idempotencyKey)}/submit`,
        {
            txHash: exec.txHash,
            status: 'submitted',
            rawResponse: { source: 'leo-cli', output: exec.raw },
        },
        token,
    );

    const confirmBody = confirmBuilder(prepared.json.data, exec.txHash);
    const confirmed = await api('POST', url, confirmBody, token, { allowError: true });

    if (confirmed.json?.status !== 'success') {
        const err = confirmed.json?.error || {};
        if (err.code === 'INVALID_STATE') {
            pass(`${label} (confirm deferred)`, exec.txHash);
            return { txHash: exec.txHash, prepared: prepared.json, confirmed: confirmed.json, deferred: true };
        }
        throw new Error(`${label}: confirm failed ${JSON.stringify(err)}`);
    }

    pass(label, exec.txHash);
    return { txHash: exec.txHash, prepared: prepared.json, confirmed: confirmed.json, deferred: false };
}

async function runVickreyFlow({ buyerToken, vendorToken }) {
    log('\n═══ Vickrey Live Flow ═══');

    const currentBlock = await getCurrentBlock();
    const rfqBiddingDeadline = currentBlock + 25;
    const rfqRevealDeadline = rfqBiddingDeadline + 720;
    const auctionBiddingDeadline = currentBlock + 80;
    const auctionRevealDeadline = auctionBiddingDeadline + 24;
    const minBid = '1000000'; // 1.0 credits in microcredits
    const rfqSalt = randomField();
    const rfqMetadataHash = fakeMetadataHash();

    const createRfq = await runWalletFirstLike({
        label: 'Create Vickrey RFQ',
        url: '/api/rfq/create',
        prepareBody: {
            salt: rfqSalt,
            biddingDeadline: rfqBiddingDeadline,
            revealDeadline: rfqRevealDeadline,
            minBid,
            minBidCount: 1,
            metadataHash: rfqMetadataHash,
            tokenType: TOKEN_TYPE.CREDITS,
            pricingMode: PRICING_MODE.VICKREY,
            itemName: 'Vickrey live run',
            description: 'onchain clickthrough',
            quantity: '1',
            unit: 'lot',
        },
        confirmBuilder: (_p, txHash) => ({
            salt: rfqSalt,
            biddingDeadline: rfqBiddingDeadline,
            revealDeadline: rfqRevealDeadline,
            minBid,
            minBidCount: 1,
            metadataHash: rfqMetadataHash,
            tokenType: TOKEN_TYPE.CREDITS,
            pricingMode: PRICING_MODE.VICKREY,
            itemName: 'Vickrey live run',
            description: 'onchain clickthrough',
            quantity: '1',
            unit: 'lot',
            txHash,
        }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    const rfqId = createRfq.confirmed?.data?.rfq_id || createRfq.prepared?.data?.rfq_id;
    if (!rfqId) throw new Error('Missing rfqId from create RFQ response');

    const auctionSalt = randomField();
    const createAuction = await runWalletFirstLike({
        label: 'Create Vickrey auction',
        url: '/api/auction/vickrey',
        prepareBody: {
            salt: auctionSalt,
            rfqId,
            tokenType: TOKEN_TYPE.CREDITS,
            biddingDeadline: auctionBiddingDeadline,
            revealDeadline: auctionRevealDeadline,
            minBid,
        },
        confirmBuilder: (p, txHash) => ({
            auctionId: p.auctionId || p.data?.auctionId,
            salt: auctionSalt,
            rfqId,
            tokenType: TOKEN_TYPE.CREDITS,
            biddingDeadline: auctionBiddingDeadline,
            revealDeadline: auctionRevealDeadline,
            minBid,
            txHash,
        }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    const auctionId = createAuction.prepared?.data?.auctionId || createAuction.confirmed?.data?.auctionId;
    if (!auctionId) throw new Error('Missing auctionId from create auction response');

    await waitFor('Vickrey auction active', async () => {
        const resp = await api('GET', `/api/auction/vickrey/${encodeURIComponent(auctionId)}`, null, buyerToken);
        const data = resp.json?.data;
        return data?.statusCode === 1 ? data : null;
    }, { timeoutMs: 240000, intervalMs: 6000 });

    const bidAmount = '1200000';
    const bidSalt = randomField();
    const commit = await runWalletFirstLike({
        label: 'Vickrey commit bid',
        url: `/api/auction/vickrey/${encodeURIComponent(auctionId)}/commit`,
        prepareBody: {
            bidAmount,
            salt: bidSalt,
            stake: '120000',
        },
        confirmBuilder: (p, txHash) => ({
            bidAmount,
            salt: bidSalt,
            stake: '120000',
            bidId: p.bidId || p.data?.bidId,
            txHash,
        }),
        token: vendorToken,
        privateKey: PRIVATE_KEY_VENDOR,
    });

    const bidId = commit.prepared?.data?.bidId || commit.confirmed?.data?.bidId;
    if (!bidId) throw new Error('Missing bidId from Vickrey commit');

    await waitFor('Vickrey bidding phase closed', async () => {
        const b = await getCurrentBlock();
        return b >= auctionBiddingDeadline;
    });

    await runWalletFirstLike({
        label: 'Vickrey reveal bid',
        url: `/api/auction/vickrey/${encodeURIComponent(auctionId)}/reveal`,
        prepareBody: { bidId, amount: bidAmount, salt: bidSalt },
        confirmBuilder: (_p, txHash) => ({ bidId, amount: bidAmount, salt: bidSalt, txHash }),
        token: vendorToken,
        privateKey: PRIVATE_KEY_VENDOR,
    });

    await waitFor('Vickrey reveal deadline reached', async () => {
        const b = await getCurrentBlock();
        return b >= auctionRevealDeadline;
    });

    await runWalletFirstLike({
        label: 'Finalize Vickrey auction',
        url: `/api/auction/vickrey/${encodeURIComponent(auctionId)}/finalize`,
        prepareBody: {},
        confirmBuilder: (_p, txHash) => ({ txHash }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    const auctionState = await waitFor('Vickrey auction finalized on chain', async () => {
        const resp = await api('GET', `/api/auction/vickrey/${encodeURIComponent(auctionId)}`, null, buyerToken);
        const data = resp.json?.data;
        if (data?.finalWinner && data?.finalPrice) return data;
        return null;
    }, { timeoutMs: 300000, intervalMs: 7000 });

    await runWalletFirstLike({
        label: 'Import Vickrey result into RFQ',
        url: `/api/rfq/${encodeURIComponent(rfqId)}/import-auction`,
        prepareBody: {
            auctionId,
            winnerAddress: auctionState.finalWinner,
            price: auctionState.finalPrice,
            auctionType: PRICING_MODE.VICKREY,
        },
        confirmBuilder: (_p, txHash) => ({
            auctionId,
            winnerAddress: auctionState.finalWinner,
            price: auctionState.finalPrice,
            auctionType: PRICING_MODE.VICKREY,
            txHash,
        }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    await runWalletFirstLike({
        label: 'Winner respond (accept) for Vickrey RFQ',
        url: `/api/rfq/${encodeURIComponent(rfqId)}/winner-respond`,
        prepareBody: { accept: true },
        confirmBuilder: (_p, txHash) => ({ accept: true, txHash }),
        token: vendorToken,
        privateKey: PRIVATE_KEY_VENDOR,
    });

    await runWalletFirstLike({
        label: 'Fund escrow for Vickrey RFQ',
        url: `/api/rfq/${encodeURIComponent(rfqId)}/fund-escrow`,
        prepareBody: { amount: auctionState.finalPrice },
        confirmBuilder: (_p, txHash) => ({ amount: auctionState.finalPrice, txHash }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    await runWalletFirstLike({
        label: 'Release 100% for Vickrey RFQ',
        url: `/api/escrow/${encodeURIComponent(rfqId)}/release`,
        prepareBody: { amount: auctionState.finalPrice },
        confirmBuilder: (_p, txHash) => ({ amount: auctionState.finalPrice, txHash }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    const rfqDone = await waitFor('Vickrey RFQ completed', async () => {
        const resp = await api('GET', `/api/rfq/${encodeURIComponent(rfqId)}`, null, buyerToken);
        return resp.json?.data?.status === RFQ_STATUS.COMPLETED ? resp.json.data : null;
    }, { timeoutMs: 180000, intervalMs: 6000 });

    return {
        rfqId,
        auctionId,
        finalPrice: auctionState.finalPrice,
        winner: auctionState.finalWinner,
        status: rfqDone.status,
    };
}

async function runDutchFlow({ buyerToken, vendorToken }) {
    log('\n═══ Dutch Live Flow ═══');

    const currentBlock = await getCurrentBlock();
    const rfqBiddingDeadline = currentBlock + 25;
    const rfqRevealDeadline = rfqBiddingDeadline + 720;
    const startBlock = currentBlock + 80;
    const endBlock = startBlock + 120;
    const rfqSalt = randomField();
    const rfqMetadataHash = fakeMetadataHash();

    const createRfq = await runWalletFirstLike({
        label: 'Create Dutch RFQ',
        url: '/api/rfq/create',
        prepareBody: {
            salt: rfqSalt,
            biddingDeadline: rfqBiddingDeadline,
            revealDeadline: rfqRevealDeadline,
            minBid: '600000',
            minBidCount: 1,
            metadataHash: rfqMetadataHash,
            tokenType: TOKEN_TYPE.CREDITS,
            pricingMode: PRICING_MODE.DUTCH,
            itemName: 'Dutch live run',
            description: 'onchain clickthrough',
            quantity: '1',
            unit: 'lot',
        },
        confirmBuilder: (_p, txHash) => ({
            salt: rfqSalt,
            biddingDeadline: rfqBiddingDeadline,
            revealDeadline: rfqRevealDeadline,
            minBid: '600000',
            minBidCount: 1,
            metadataHash: rfqMetadataHash,
            tokenType: TOKEN_TYPE.CREDITS,
            pricingMode: PRICING_MODE.DUTCH,
            itemName: 'Dutch live run',
            description: 'onchain clickthrough',
            quantity: '1',
            unit: 'lot',
            txHash,
        }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    const rfqId = createRfq.confirmed?.data?.rfq_id || createRfq.prepared?.data?.rfq_id;
    if (!rfqId) throw new Error('Missing rfqId from Dutch create RFQ');

    const auctionSalt = randomField();
    await runWalletFirstLike({
        label: 'Create Dutch auction',
        url: '/api/auction/dutch',
        prepareBody: {
            salt: auctionSalt,
            rfqId,
            tokenType: TOKEN_TYPE.CREDITS,
            startPrice: '1500000',
            reservePrice: '900000',
            decrementPerBlock: '10000',
            startBlock,
            endBlock,
        },
        confirmBuilder: (p, txHash) => ({
            auctionId: p.auctionId || p.data?.auctionId,
            salt: auctionSalt,
            rfqId,
            tokenType: TOKEN_TYPE.CREDITS,
            startPrice: '1500000',
            reservePrice: '900000',
            decrementPerBlock: '10000',
            startBlock,
            endBlock,
            txHash,
        }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    const auctionLookup = await api('GET', '/api/auction/dutch', null, buyerToken);
    const auction = (auctionLookup.json?.data || []).find((a) => a.rfqId === rfqId);
    if (!auction?.auctionId) throw new Error('Could not find Dutch auction by rfqId');
    const auctionId = auction.auctionId;

    await waitFor('Dutch auction started', async () => {
        const b = await getCurrentBlock();
        return b >= startBlock;
    });

    await runWalletFirstLike({
        label: 'Dutch accept price',
        url: `/api/auction/dutch/${encodeURIComponent(auctionId)}/accept-price`,
        prepareBody: {},
        confirmBuilder: (_p, txHash) => ({ txHash }),
        token: vendorToken,
        privateKey: PRIVATE_KEY_VENDOR,
    });

    const finalizedAuction = await waitFor('Dutch auction finalized on chain', async () => {
        const resp = await api('GET', `/api/auction/dutch/${encodeURIComponent(auctionId)}`, null, buyerToken);
        const data = resp.json?.data;
        if (data?.finalWinner && data?.finalPrice) return data;
        return null;
    }, { timeoutMs: 240000, intervalMs: 6000 });

    await runWalletFirstLike({
        label: 'Import Dutch result into RFQ',
        url: `/api/rfq/${encodeURIComponent(rfqId)}/import-auction`,
        prepareBody: {
            auctionId,
            winnerAddress: finalizedAuction.finalWinner,
            price: finalizedAuction.finalPrice,
            auctionType: PRICING_MODE.DUTCH,
        },
        confirmBuilder: (_p, txHash) => ({
            auctionId,
            winnerAddress: finalizedAuction.finalWinner,
            price: finalizedAuction.finalPrice,
            auctionType: PRICING_MODE.DUTCH,
            txHash,
        }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    await runWalletFirstLike({
        label: 'Winner respond (accept) for Dutch RFQ',
        url: `/api/rfq/${encodeURIComponent(rfqId)}/winner-respond`,
        prepareBody: { accept: true },
        confirmBuilder: (_p, txHash) => ({ accept: true, txHash }),
        token: vendorToken,
        privateKey: PRIVATE_KEY_VENDOR,
    });

    await runWalletFirstLike({
        label: 'Fund escrow for Dutch RFQ',
        url: `/api/rfq/${encodeURIComponent(rfqId)}/fund-escrow`,
        prepareBody: { amount: finalizedAuction.finalPrice },
        confirmBuilder: (_p, txHash) => ({ amount: finalizedAuction.finalPrice, txHash }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    await runWalletFirstLike({
        label: 'Release 100% for Dutch RFQ',
        url: `/api/escrow/${encodeURIComponent(rfqId)}/release`,
        prepareBody: { amount: finalizedAuction.finalPrice },
        confirmBuilder: (_p, txHash) => ({ amount: finalizedAuction.finalPrice, txHash }),
        token: buyerToken,
        privateKey: PRIVATE_KEY_BUYER,
    });

    const rfqDone = await waitFor('Dutch RFQ completed', async () => {
        const resp = await api('GET', `/api/rfq/${encodeURIComponent(rfqId)}`, null, buyerToken);
        return resp.json?.data?.status === RFQ_STATUS.COMPLETED ? resp.json.data : null;
    }, { timeoutMs: 180000, intervalMs: 6000 });

    return {
        rfqId,
        auctionId,
        finalPrice: finalizedAuction.finalPrice,
        winner: finalizedAuction.finalWinner,
        status: rfqDone.status,
    };
}

async function main() {
    log('════════════════════════════════════════════════════════════');
    log('  Live On-Chain Clickthrough (API + Leo + Confirm)');
    log('════════════════════════════════════════════════════════════');

    const buyerAddress = await deriveAddressFromPrivateKey(PRIVATE_KEY_BUYER);
    const vendorAddress = await deriveAddressFromPrivateKey(PRIVATE_KEY_VENDOR);
    log(`Buyer:  ${buyerAddress}`);
    log(`Vendor: ${vendorAddress}`);

    let buyerToken = await authenticate(buyerAddress);
    let vendorToken = await authenticate(vendorAddress);
    buyerToken = await switchRole(buyerToken, 'BUYER');
    vendorToken = await switchRole(vendorToken, 'VENDOR');
    pass('Authenticated + switched roles');

    const summary = {
        vickrey: null,
        dutch: null,
    };
    const runOnly = String(process.env.RUN_ONLY || '').trim().toLowerCase();
    if (runOnly !== 'dutch') {
        summary.vickrey = await runVickreyFlow({ buyerToken, vendorToken });
    }
    if (runOnly !== 'vickrey') {
        summary.dutch = await runDutchFlow({ buyerToken, vendorToken });
    }

    log('\n════════════════════════════════════════════════════════════');
    log('  Final Summary');
    log('════════════════════════════════════════════════════════════');
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error('\nFATAL:', error.message);
    process.exit(1);
});
