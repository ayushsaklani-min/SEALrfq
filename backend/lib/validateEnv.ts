/**
 * Environment variable validation.
 * Call this once at application startup. Throws on any misconfiguration
 * so the process fails fast with a clear message rather than silently
 * using insecure defaults in production.
 */

const INSECURE_JWT_DEFAULT = 'development-secret-change-in-production';

interface EnvRule {
    name: string;
    required: boolean;
    insecureValues?: string[];
    description: string;
}

const RULES: EnvRule[] = [
    {
        name: 'JWT_SECRET',
        required: true,
        insecureValues: [INSECURE_JWT_DEFAULT, 'secret', 'changeme', ''],
        description: 'JWT signing secret (min 32 chars, cryptographically random)',
    },
    {
        name: 'DATABASE_URL',
        required: true,
        description: 'Database connection string (PostgreSQL for production)',
    },
    {
        name: 'ALEO_PROGRAM_ID',
        required: true,
        description: 'Deployed Aleo RFQ program ID (e.g. sealrfq_v18.aleo)',
    },
    {
        name: 'ALEO_INVOICE_PROGRAM_ID',
        required: true,
        description: 'Deployed Aleo invoice router program ID (e.g. sealrfq_invoice_v1.aleo)',
    },
    {
        name: 'ALEO_NETWORK',
        required: true,
        description: 'Aleo network (testnet | mainnet)',
    },
    {
        name: 'ALEO_RPC_URL',
        required: true,
        description: 'Aleo RPC endpoint URL',
    },
];

const PRODUCTION_ONLY_RULES: EnvRule[] = [
    {
        name: 'REDIS_URL',
        required: true,
        description: 'Redis connection URL for rate limiting',
    },
];

export function validateEnv(): void {
    const isProduction = process.env.NODE_ENV === 'production';
    const errors: string[] = [];
    const warnings: string[] = [];

    const rulesToCheck = isProduction
        ? [...RULES, ...PRODUCTION_ONLY_RULES]
        : RULES;

    for (const rule of rulesToCheck) {
        const value = process.env[rule.name];

        if (!value || value.trim() === '') {
            if (rule.required) {
                errors.push(`Missing required env var: ${rule.name} — ${rule.description}`);
            } else {
                warnings.push(`Optional env var not set: ${rule.name} — ${rule.description}`);
            }
            continue;
        }

        if (rule.insecureValues?.includes(value)) {
            if (isProduction) {
                errors.push(
                    `Insecure value for ${rule.name} in production. ${rule.description}`
                );
            } else {
                warnings.push(
                    `Insecure default value detected for ${rule.name}. This will fail in production.`
                );
            }
        }
    }

    // JWT_SECRET length check
    const jwtSecret = process.env.JWT_SECRET || '';
    if (jwtSecret.length < 32 && jwtSecret !== '') {
        const msg = `JWT_SECRET is too short (${jwtSecret.length} chars). Minimum 32 characters required.`;
        if (isProduction) errors.push(msg);
        else warnings.push(msg);
    }

    // Block insecure flags in production
    if (isProduction) {
        if (process.env.DEMO_MODE === 'true') {
            errors.push('DEMO_MODE=true is not allowed in production.');
        }
        if (process.env.ALLOW_MOCK_WALLET_SIGNATURE === 'true') {
            errors.push('ALLOW_MOCK_WALLET_SIGNATURE=true is not allowed in production.');
        }
        if (process.env.ALLOW_INSECURE_WALLET_SIGNATURE === 'true') {
            errors.push('ALLOW_INSECURE_WALLET_SIGNATURE=true is not allowed in production.');
        }
    }

    if (warnings.length > 0) {
        console.warn('[ENV] Configuration warnings:\n' + warnings.map((w) => `  ⚠ ${w}`).join('\n'));
    }

    if (errors.length > 0) {
        const message =
            '[ENV] Fatal configuration errors. Fix these before starting the server:\n' +
            errors.map((e) => `  ✗ ${e}`).join('\n');
        throw new Error(message);
    }

    console.log('[ENV] Environment validation passed.');
}
