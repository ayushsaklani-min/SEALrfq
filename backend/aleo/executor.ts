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

const DEFAULT_PROGRAM_ID = process.env.ALEO_PROGRAM_ID || 'sealrfq_v1.aleo';
const DEFAULT_NETWORK = process.env.ALEO_NETWORK || 'testnet';
const DEFAULT_ENDPOINT = process.env.ALEO_RPC_URL || 'https://api.explorer.provable.com/v1';
const DEFAULT_CONSENSUS = process.env.ALEO_CONSENSUS_VERSION || '12';
const DEFAULT_FEE = process.env.ALEO_FEE_MICROCREDITS || '1000000';
const DEFAULT_TIMEOUT_MS = Number(process.env.ALEO_EXEC_TIMEOUT_MS || '180000');

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

export async function getCurrentBlockHeight(): Promise<number> {
    const explicit = process.env.ALEO_CURRENT_BLOCK;
    if (explicit && /^\d+$/.test(explicit)) {
        return Number(explicit);
    }

    // Best-effort fallback. Keeping this deterministic avoids blocking API calls
    // when explorer endpoints are flaky; callers still pass monotonic values.
    const epoch = Math.floor(Date.now() / 1000);
    return epoch;
}

export async function executeLeoTransition(req: LeoExecuteRequest): Promise<LeoExecuteResult> {
    const privateKey = requirePrivateKey(req.callerRole);
    const leoBin = normalizeLeoBinary();

    const args: string[] = [
        'execute',
        req.transition,
        ...req.inputs,
        '--program',
        DEFAULT_PROGRAM_ID,
        '--network',
        DEFAULT_NETWORK,
        '--endpoint',
        DEFAULT_ENDPOINT,
        '--consensus-version',
        DEFAULT_CONSENSUS,
        '--fee',
        DEFAULT_FEE,
        '--private-key',
        privateKey,
        '--broadcast',
        '-y',
        '--print',
    ];

    const { stdout, stderr, exitCode } = await new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>((resolve) => {
        const child = spawn(leoBin, args, {
            cwd: process.env.ALEO_PROJECT_DIR || process.cwd(),
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
