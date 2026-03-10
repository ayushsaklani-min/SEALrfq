/**
 * Quick Happy Path — runs the full SealRFQ flow with 2 wallets via leo CLI (WSL).
 *
 *   create_rfq → submit_bid_commit → close_bidding → reveal_bid →
 *   select_winner → winner_accept → fund_escrow → release_final_payment →
 *   refund/release stakes
 *
 * Usage:  node scripts/quick-happy-path.mjs
 */
import { spawn } from "child_process";
import crypto from "crypto";
import { Account } from "@provablehq/sdk/testnet.js";

const PROGRAM_ID = process.env.ALEO_PROGRAM_ID || "sealrfq_v9.aleo";
const NETWORK = "testnet";
const ENDPOINT = "https://api.explorer.provable.com/v1";
const CONSENSUS_VERSION = "12";
const LEO_BIN = "/home/saklani/.cargo/bin/leo";
const PROJECT_DIR_WSL = "/mnt/c/Users/sakla/OneDrive/Desktop/rfqwave3/SEALrfq/contracts/v9";
const POLL_MS = 4000;

// Wallets
const BUYER_KEY = "APrivateKey1zkp8XfjyiCg3rUWaoxWcixvgVdJjeBKXd8g8z4JTKoqVfma";
const VENDOR_KEY = "APrivateKey1zkpF3vLLM6tQbnrZUH6exswEfGAnGwobCtXqo6qffKLKLjK";

const buyerAccount = new Account({ privateKey: BUYER_KEY });
const vendorAccount = new Account({ privateKey: VENDOR_KEY });

const buyer = {
  label: "buyer",
  privateKey: BUYER_KEY,
  address: buyerAccount.address().to_string(),
};
const vendor = {
  label: "vendor",
  privateKey: VENDOR_KEY,
  address: vendorAccount.address().to_string(),
};

function log(step, msg) {
  console.log(`[${step}] ${msg}`);
}

function makeField() {
  return `${BigInt(`0x${crypto.randomBytes(16).toString("hex")}`)}field`;
}

function shellQuote(v) {
  return `'${String(v).replace(/'/g, `'\"'\"'`)}'`;
}

function parseTxHash(output) {
  const m = output.match(/(at1[0-9a-z]{40,})/i);
  return m ? m[1] : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url) {
  const r = await fetch(url, { method: "GET", cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.text();
}

async function getBlockHeight() {
  const urls = [
    `${ENDPOINT}/${NETWORK}/latest/height`,
    `${ENDPOINT}/${NETWORK}/block/latest`,
  ];
  for (const url of urls) {
    try {
      const t = await fetchText(url);
      const n = Number(JSON.parse(t) ?? t);
      if (Number.isFinite(n)) return n;
    } catch {}
  }
  throw new Error("Cannot get block height");
}

async function queryMapping(mapping, key) {
  const raw = await fetchText(
    `${ENDPOINT}/${NETWORK}/program/${PROGRAM_ID}/mapping/${mapping}/${encodeURIComponent(key)}`
  );
  // Strip surrounding quotes from JSON string response
  let v = raw.trim();
  try { v = JSON.parse(v); } catch {}
  return String(v);
}

async function waitMapping(mapping, key, pred, desc) {
  const start = Date.now();
  while (Date.now() - start < 600_000) {
    try {
      const v = await queryMapping(mapping, key);
      if (pred(v)) return v;
    } catch {}
    await sleep(POLL_MS);
  }
  throw new Error(`Timeout waiting for ${desc}`);
}

async function waitForBlock(target) {
  while (true) {
    const h = await getBlockHeight();
    if (h >= target) return h;
    log("wait", `block ${h}, need ${target}`);
    await sleep(POLL_MS);
  }
}

async function runLeo(args) {
  const cmd = `cd ${shellQuote(PROJECT_DIR_WSL)} && ${[LEO_BIN, ...args].map(shellQuote).join(" ")}`;
  return new Promise((resolve) => {
    const child = spawn("wsl.exe", ["bash", "-lc", cmd], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

async function exec(name, wallet, transition, inputs, program) {
  const prog = program || PROGRAM_ID;
  const target = transition.includes("/") ? transition : `${prog}/${transition}`;
  log("exec", `${name}: ${target}(${inputs.join(", ")})`);
  const args = [
    "execute", target, ...inputs,
    "--network", NETWORK,
    "--endpoint", ENDPOINT,
    "--consensus-version", CONSENSUS_VERSION,
    "--private-key", wallet.privateKey,
    "--broadcast", "--print", "--yes",
  ];
  const { stdout, stderr, exitCode } = await runLeo(args);
  const raw = [stdout, stderr].join("\n").trim();
  const txHash = parseTxHash(raw);

  if (exitCode !== 0 && !raw.includes("Broadcasted transaction")) {
    console.error(raw);
    throw new Error(`${name} failed (exit ${exitCode})`);
  }

  log("tx", `${name} -> ${txHash || "broadcasted"}`);
  return txHash;
}

async function getBalance(addr) {
  try {
    const raw = await fetchText(
      `${ENDPOINT}/${NETWORK}/program/credits.aleo/mapping/account/${addr}`
    );
    // API returns e.g. "80990171u64" (with quotes)
    const cleaned = raw.trim().replace(/^"|"$/g, "").replace(/u\d+$/, "");
    return BigInt(cleaned);
  } catch {
    return 0n;
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  log("start", `Program: ${PROGRAM_ID}`);
  log("start", `Buyer:  ${buyer.address}`);
  log("start", `Vendor: ${vendor.address}`);

  const buyerBal = await getBalance(buyer.address);
  const vendorBal = await getBalance(vendor.address);
  log("balance", `Buyer:  ${buyerBal} microcredits (${Number(buyerBal) / 1e6} ALEO)`);
  log("balance", `Vendor: ${vendorBal} microcredits (${Number(vendorBal) / 1e6} ALEO)`);

  if (buyerBal < 5_000_000n) throw new Error("Buyer needs at least 5 ALEO");
  if (vendorBal < 500_000n) {
    log("topup", "Vendor balance too low, transferring 5 ALEO from buyer...");
    await exec("topup-vendor", buyer, "transfer_public", [
      vendor.address,
      "5000000u64",
    ], "credits.aleo");
    log("topup", "Waiting for vendor balance to update...");
    const start = Date.now();
    while (Date.now() - start < 120_000) {
      const bal = await getBalance(vendor.address);
      if (bal >= 500_000n) {
        log("topup", `Vendor balance: ${bal}`);
        break;
      }
      await sleep(POLL_MS);
    }
  }

  // 1. CREATE RFQ
  const currentBlock = await getBlockHeight();
  const biddingDeadline = currentBlock + 30; // ~2.5 min
  const revealDeadline = biddingDeadline + 30;
  const rfqId = makeField();
  const metadataHash = makeField();
  const minBid = 100n; // 100 microcredits (tiny for testing)
  const minBidCount = 1n;
  const flatStake = (minBid * 10n) / 100n; // 10% = 10 microcredits

  await exec("create-rfq", buyer, "create_rfq", [
    rfqId,
    `${biddingDeadline}u32`,
    `${revealDeadline}u32`,
    `${minBid}u64`,
    `${minBidCount}u64`,
    metadataHash,
  ]);

  await waitMapping("rfq_status", rfqId, (v) => v === "1u8", "RFQ OPEN");
  log("ok", "RFQ created and OPEN on-chain!");

  // 2. SUBMIT BID
  const bidId = makeField();
  const bidNonce = makeField();
  const bidAmount = 100n;

  await exec("submit-bid", vendor, "submit_bid_commit", [
    rfqId,
    `${bidAmount}u64`,
    bidNonce,
    `${flatStake}u64`,
    bidId,
    "1u64", // nonce
    `${minBid}u64`, // claimed min bid
  ]);

  await waitMapping("rfq_bid_count", rfqId, (v) => v !== "0u64", "bid count > 0");
  log("ok", "Bid submitted!");

  // 3. CLOSE BIDDING (wait for deadline)
  log("wait", `Waiting for bidding deadline block ${biddingDeadline}...`);
  await waitForBlock(biddingDeadline);

  await exec("close-bidding", vendor, "close_bidding", [rfqId]);
  await waitMapping("rfq_status", rfqId, (v) => v === "2u8", "RFQ REVEAL");
  log("ok", "Bidding closed, now in REVEAL phase!");

  // 4. REVEAL BID
  await exec("reveal-bid", vendor, "reveal_bid", [
    rfqId,
    bidId,
    `${bidAmount}u64`,
    bidNonce,
    "1u64", // reveal nonce
  ]);

  await waitMapping("rfq_revealed_count", rfqId, (v) => v !== "0u64", "revealed count > 0");
  log("ok", "Bid revealed!");

  // 5. SELECT WINNER (wait for reveal deadline)
  log("wait", `Waiting for reveal deadline block ${revealDeadline}...`);
  await waitForBlock(revealDeadline);

  await exec("select-winner", vendor, "select_winner", [
    rfqId,
    bidId,
    `${bidAmount}u64`,
    vendor.address,
  ]);

  await waitMapping("rfq_status", rfqId, (v) => v === "3u8", "WINNER_SELECTED");
  log("ok", `Winner selected: ${vendor.address}`);

  // 6. WINNER ACCEPT
  await exec("winner-accept", vendor, "winner_accept", [rfqId]);
  await waitMapping("rfq_winner_accepted", rfqId, (v) => v === "true", "winner accepted");
  log("ok", "Winner accepted!");

  // 7. FUND ESCROW
  await exec("fund-escrow", buyer, "fund_escrow", [rfqId, `${minBid}u64`]);
  await waitMapping("rfq_status", rfqId, (v) => v === "4u8", "ESCROW_FUNDED");
  log("ok", "Escrow funded!");

  // 8. RELEASE FINAL PAYMENT
  await exec("release-final", buyer, "release_final_payment", [
    rfqId,
    vendor.address,
    `${minBid}u64`,
    "1u64", // payment nonce
  ]);

  await waitMapping("rfq_status", rfqId, (v) => v === "5u8", "COMPLETED");
  log("ok", "Final payment released!");

  // 9. RELEASE WINNER STAKE
  await exec("release-winner-stake", vendor, "release_winner_stake", [
    rfqId,
    `${flatStake}u64`,
  ]);
  log("ok", "Winner stake released!");

  log("done", "FULL HAPPY PATH COMPLETED SUCCESSFULLY!");
  log("done", `RFQ ID: ${rfqId}`);
}

main().catch((err) => {
  console.error("\n[FATAL]", err.message || err);
  process.exit(1);
});
