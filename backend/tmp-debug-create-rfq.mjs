import { spawn } from 'child_process';

const BASE = 'http://localhost:4000';
const WALLET = 'aleo1ma5v55y8avvt4k984gk7y6n8vyc8344nw6y0m86ecgqv8h67z59qnksshy';
const PRIVATE_KEY = 'APrivateKey1zkp8XfjyiCg3rUWaoxWcixvgVdJjeBKXd8g8z4JTKoqVfma';
const RPC = 'https://api.explorer.provable.com/v1';
const NETWORK = 'testnet';

async function auth() {
    let r = await fetch(`${BASE}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress: WALLET }),
    });
    let j = await r.json();
    r = await fetch(`${BASE}/api/auth/connect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            walletAddress: WALLET,
            nonce: j.data.nonce,
            signature: 'insecure_signature',
        }),
    });
    j = await r.json();
    let token = j.data.accessToken;
    r = await fetch(`${BASE}/api/auth/dev/switch-role`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: 'BUYER' }),
    });
    j = await r.json();
    return j.data.accessToken;
}

function run(cmd) {
    return new Promise((resolve, reject) => {
        const child = spawn('wsl', ['-e', 'bash', '-lc', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d.toString()));
        child.stderr.on('data', (d) => (err += d.toString()));
        child.on('close', (code) => {
            const merged = `${out}\n${err}`;
            if (code !== 0) reject(new Error(merged));
            else resolve(merged);
        });
    });
}

async function main() {
    const token = await auth();
    const latest = Number((await (await fetch(`${RPC}/${NETWORK}/latest/height`)).text()).trim());
    const payload = {
        salt: `${Date.now()}field`,
        biddingDeadline: latest + 20,
        revealDeadline: latest + 760,
        minBid: '1000000',
        minBidCount: 1,
        metadataHash: `${BigInt(latest + 111111111111).toString()}field`,
        tokenType: 0,
        pricingMode: 1,
        itemName: 'dbg',
        description: 'dbg',
        quantity: '1',
        unit: 'lot',
    };
    const preparedRes = await fetch(`${BASE}/api/rfq/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    const prepared = await preparedRes.json();
    console.log('prepare status', preparedRes.status);
    console.log(JSON.stringify(prepared, null, 2));
    const req = prepared?.data?.tx?.request;
    if (!req) return;

    const cmd = [
        'leo execute',
        `'${req.program}/${req.function}'`,
        ...req.inputs.map((x) => `'${x}'`),
        '--network',
        `'${NETWORK}'`,
        '--endpoint',
        `'${RPC}'`,
        '--private-key',
        `'${PRIVATE_KEY}'`,
        '--broadcast',
        '-y',
        '--print',
    ].join(' ');
    console.log('\nCMD:\n', cmd, '\n');
    const output = await run(cmd);
    console.log(output);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

