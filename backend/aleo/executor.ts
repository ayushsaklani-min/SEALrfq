import { spawn } from 'child_process';
import crypto from 'crypto';

type LeoExecuteRequest = {
    transition: string;
    inputs: string[];
    callerRole: 'BUYER' | 'VENDOR';
};

type LeoExecuteResult = {
    txHash: string;
    blockHeight: number | null;
    rawOutput: string;
};

const DEFAULT_PROGRAM_ID = process.env.ALEO_PROGRAM_ID || 'sealrfq_v17.aleo';
const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'testnet';
const DEFAULT_ENDPOINT = process.env.ALEO_RPC_URL || 'https://api.explorer.provable.com/v1';
const DEFAULT_CONSENSUS = process.env.ALEO_CONSENSUS_VERSION || '12';
const DEFAULT_PRIORITY_FEE = process.env.ALEO_PRIORITY_FEE_MICROCREDITS || '0';
const DEFAULT_TIMEOUT_MS = Number(process.env.ALEO_EXEC_TIMEOUT_MS || '180000');
const DEFAULT_PROJECT_DIR = process.env.ALEO_PROJECT_DIR?.trim() || null;

function normalizeLeoBinary(): string {
    return process.env.LEO_BIN && process.env.LEO_BIN.trim().length > 0
        ? process.env.LEO_BIN.trim()
        : 'leo';
}

function requirePrivateKey(callerRole: 'BUYER' | 'VENDOR'): string {
    const key =
        callerRole === 'BUYER'
            ? process.env.ALEO_BUYER_PRIVATE_KEY
            : process.env.ALEO_VENDOR_PRIVATE_KEY;

    if (!key || key.trim().length === 0) {
        throw new Error(`Missing ${callerRole} private key in environment`);
    }
    return key.trim();
}

function parseTxHash(output: string): string | null {
    const full = output.match(/(at1[0-9a-z]{40,})/i);
    return full ? full[1] : null;
}

function parseBlockHeight(output: string): number | null {
    const candidates = [
        /block(?:\s+height)?[:=]\s*(\d+)/i,
        /height[:=]\s*(\d+)/i,
    ];
    for (const pattern of candidates) {
        const match = output.match(pattern);
        if (match) {
            return Number(match[1]);
        }
    }
    return null;
}

const RPC_TIMEOUT_MS = Number(process.env.ALEO_RPC_TIMEOUT_MS || '10000');

/**
 * Fetch with a hard timeout using AbortController.
 * Throws if the request does not complete within timeoutMs.
 */
async function fetchWithTimeout(url: string, timeoutMs: number = RPC_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export async function getCurrentBlockHeight(): Promise<number> {
    const explicit = process.env.ALEO_CURRENT_BLOCK;
    if (explicit && /^\d+$/.test(explicit)) {
        return Number(explicit);
    }

    const candidates = [
        `${DEFAULT_ENDPOINT}/${DEFAULT_NETWORK}/latest/height`,
        `${DEFAULT_ENDPOINT}/${DEFAULT_NETWORK}/block/latest`,
        `${DEFAULT_ENDPOINT}/${DEFAULT_NETWORK}/blocks/latest`,
    ];

    for (const url of candidates) {
        try {
            const res = await fetchWithTimeout(url);
            if (!res.ok) {
                continue;
            }

            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const json: any = await res.json();
                const raw = Number(json);
                const direct = Number(json?.height);
                const nested = Number(json?.block?.height);
                const altNested = Number(json?.latest?.height);
                const value = [raw, direct, nested, altNested].find((v) => Number.isFinite(v) && v >= 0);
                if (typeof value === 'number') {
                    return value;
                }
            } else {
                const text = (await res.text()).trim();
                const numeric = Number(text);
                if (Number.isFinite(numeric) && numeric >= 0) {
                    return numeric;
                }
            }
        } catch {
            // try next candidate
        }
    }

    throw new Error(
        'Unable to resolve current Aleo block height from endpoint. Set ALEO_CURRENT_BLOCK or provide a reachable ALEO_RPC_URL.'
    );
}

export async function executeLeoTransition(req: LeoExecuteRequest): Promise<LeoExecuteResult> {
    const privateKey = requirePrivateKey(req.callerRole);
    const leoBin = normalizeLeoBinary();

    const args: string[] = [
        'execute',
        req.transition,
        ...req.inputs,
        '--network',
        DEFAULT_NETWORK,
        '--endpoint',
        DEFAULT_ENDPOINT,
        '--consensus-version',
        DEFAULT_CONSENSUS,
        '--private-key',
        privateKey,
        '--broadcast',
        '-y',
        '--print',
    ];

    if (DEFAULT_PRIORITY_FEE !== '0') {
        args.push('--priority-fees', DEFAULT_PRIORITY_FEE);
    }

    if (DEFAULT_PROJECT_DIR) {
        args.push('--path', DEFAULT_PROJECT_DIR);
    }

    const { stdout, stderr, exitCode } = await new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>((resolve) => {
        const child = spawn(leoBin, args, {
            cwd: process.cwd(),
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
        }, DEFAULT_TIMEOUT_MS);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                stdout,
                stderr,
                exitCode: typeof code === 'number' ? code : 1,
            });
        });
    });

    const rawOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (exitCode !== 0) {
        throw new Error(rawOutput || `leo execute failed with exit code ${exitCode}`);
    }

    const txHash = parseTxHash(rawOutput) || `pending_${crypto.randomUUID()}`;
    const blockHeight = parseBlockHeight(rawOutput);

    return {
        txHash,
        blockHeight,
        rawOutput,
    };
}

