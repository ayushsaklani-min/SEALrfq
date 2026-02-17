/**
 * Authentication Service
 * 
 * CONSTRAINTS:
 * 1. Nonce-challenge auth (no static message)
 * 2. JWT short-lived access + rotating refresh token
 * 3. Role resolution from backend only
 * 4. Session revocation support
 */

import { PrismaClient } from '@prisma/client';
import * as jose from 'jose';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export type UserRole = 'BUYER' | 'VENDOR' | 'AUDITOR' | 'NEW_USER';

export interface AuthSession {
    id: string;
    walletAddress: string;
    role: UserRole;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
}

export interface NonceChallenge {
    nonce: string;
    expiresAt: Date;
    walletAddress: string;
}

// ============================================================================
// Configuration
// ============================================================================

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'development-secret-change-in-production'
);

const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days
const NONCE_TTL = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Auth Service
// ============================================================================

export class AuthService {
    constructor(private prisma: PrismaClient) { }

    /**
     * STEP 1: Generate nonce challenge for wallet to sign
     */
    async generateNonceChallenge(walletAddress: string): Promise<NonceChallenge> {
        // Generate cryptographically secure random nonce
        const nonce = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + NONCE_TTL);

        // Store nonce in database (with expiration)
        await this.prisma.authNonce.create({
            data: {
                nonce,
                walletAddress,
                expiresAt,
            },
        });

        return { nonce, expiresAt, walletAddress };
    }

    /**
     * STEP 2: Verify signature and create session
     */
    async verifyAndCreateSession(
        walletAddress: string,
        nonce: string,
        signature: string
    ): Promise<AuthSession> {
        // 1. Verify nonce exists and not expired
        const nonceRecord = await this.prisma.authNonce.findFirst({
            where: {
                nonce,
                walletAddress,
                expiresAt: { gte: new Date() },
                used: false,
            },
        });

        if (!nonceRecord) {
            throw new Error('Invalid or expired nonce');
        }

        // 2. Verify signature (Aleo wallet signature verification)
        const isValidSignature = await this.verifyAleoSignature(
            walletAddress,
            nonce,
            signature
        );

        if (!isValidSignature) {
            throw new Error('Invalid signature');
        }

        // 3. Mark nonce as used (prevent replay)
        await this.prisma.authNonce.update({
            where: { id: nonceRecord.id },
            data: { used: true },
        });

        // 4. Resolve user role (SERVER-SIDE ONLY)
        const role = await this.resolveUserRole(walletAddress);

        // 5. Generate tokens
        const sessionId = crypto.randomUUID();
        const accessToken = await this.generateAccessToken(walletAddress, role, sessionId);
        const refreshToken = await this.generateRefreshToken(walletAddress, sessionId);

        const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL * 1000);
        const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

        // 6. Store session
        await this.prisma.authSession.create({
            data: {
                id: sessionId,
                walletAddress,
                role,
                refreshToken,
                refreshTokenExpiresAt,
                isRevoked: false,
            },
        });

        return {
            id: sessionId,
            walletAddress,
            role,
            accessToken,
            refreshToken,
            accessTokenExpiresAt,
            refreshTokenExpiresAt,
        };
    }

    /**
     * STEP 3: Refresh access token using refresh token
     */
    async refreshSession(refreshToken: string): Promise<AuthSession> {
        // 1. Verify refresh token
        let payload: any;
        try {
            const { payload: p } = await jose.jwtVerify(refreshToken, JWT_SECRET);
            payload = p;
        } catch (error) {
            throw new Error('Invalid refresh token');
        }

        const { walletAddress, sessionId } = payload as { walletAddress: string; sessionId: string };

        // 2. Check session exists and not revoked
        const session = await this.prisma.authSession.findUnique({
            where: { id: sessionId },
        });

        if (!session || session.isRevoked || session.refreshToken !== refreshToken) {
            throw new Error('Session not found or revoked');
        }

        // 3. Check refresh token not expired
        if (session.refreshTokenExpiresAt < new Date()) {
            throw new Error('Refresh token expired');
        }

        // 4. Re-resolve role (may have changed)
        const role = await this.resolveUserRole(walletAddress);

        // 5. Generate new tokens (rotate refresh token)
        const newSessionId = crypto.randomUUID();
        const accessToken = await this.generateAccessToken(walletAddress, role, newSessionId);
        const newRefreshToken = await this.generateRefreshToken(walletAddress, newSessionId);

        const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL * 1000);
        const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

        // 6. Revoke old session + create new one (token rotation)
        await this.prisma.$transaction([
            this.prisma.authSession.update({
                where: { id: sessionId },
                data: { isRevoked: true },
            }),
            this.prisma.authSession.create({
                data: {
                    id: newSessionId,
                    walletAddress,
                    role,
                    refreshToken: newRefreshToken,
                    refreshTokenExpiresAt,
                    isRevoked: false,
                },
            }),
        ]);

        return {
            id: newSessionId,
            walletAddress,
            role,
            accessToken,
            refreshToken: newRefreshToken,
            accessTokenExpiresAt,
            refreshTokenExpiresAt,
        };
    }

    /**
     * Verify access token
     */
    async verifyAccessToken(token: string): Promise<{ walletAddress: string; role: UserRole; sessionId: string }> {
        try {
            const { payload } = await jose.jwtVerify(token, JWT_SECRET);

            const { walletAddress, role, sessionId } = payload as {
                walletAddress: string;
                role: UserRole;
                sessionId: string;
            };

            // Check session not revoked
            const session = await this.prisma.authSession.findUnique({
                where: { id: sessionId },
            });

            if (!session || session.isRevoked) {
                throw new Error('Session revoked');
            }

            return { walletAddress, role, sessionId };
        } catch (error) {
            throw new Error('Invalid or expired access token');
        }
    }

    /**
     * STEP 4: Revoke session (logout)
     */
    async revokeSession(sessionId: string): Promise<void> {
        await this.prisma.authSession.update({
            where: { id: sessionId },
            data: { isRevoked: true },
        });
    }

    /**
     * Revoke all sessions for a wallet (logout-all)
     */
    async revokeAllSessions(walletAddress: string): Promise<void> {
        await this.prisma.authSession.updateMany({
            where: { walletAddress },
            data: { isRevoked: true },
        });
    }

    /**
     * DEV ONLY: Create a new session with an explicitly selected role.
     */
    async createDevRoleSession(
        walletAddress: string,
        role: UserRole,
        currentSessionId: string
    ): Promise<AuthSession> {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Role switching is disabled in production');
        }

        // Revoke current session first.
        await this.prisma.authSession.updateMany({
            where: { id: currentSessionId, walletAddress, isRevoked: false },
            data: { isRevoked: true },
        });

        const sessionId = crypto.randomUUID();
        const accessToken = await this.generateAccessToken(walletAddress, role, sessionId);
        const refreshToken = await this.generateRefreshToken(walletAddress, sessionId);
        const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL * 1000);
        const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

        await this.prisma.authSession.create({
            data: {
                id: sessionId,
                walletAddress,
                role,
                refreshToken,
                refreshTokenExpiresAt,
                isRevoked: false,
            },
        });

        return {
            id: sessionId,
            walletAddress,
            role,
            accessToken,
            refreshToken,
            accessTokenExpiresAt,
            refreshTokenExpiresAt,
        };
    }

    /**
     * Role resolution (SERVER-SIDE ONLY)
     * 
     * Rules:
     * - AUDITOR: Whitelisted in env
     * - BUYER: Has created ≥1 RFQ
     * - VENDOR: Has submitted ≥1 bid
     * - NEW_USER: Default
     */
    private async resolveUserRole(walletAddress: string): Promise<UserRole> {
        // 1. Check auditor whitelist
        const auditors = (process.env.AUDITOR_WHITELIST || '').split(',').map(a => a.trim());
        if (auditors.includes(walletAddress)) {
            return 'AUDITOR';
        }

        // 2. Check if buyer (created RFQ)
        const rfqCount = await this.prisma.rFQ.count({
            where: { buyer: walletAddress },
        });
        if (rfqCount > 0) {
            return 'BUYER';
        }

        // 3. Check if vendor (submitted bid)
        const bidCount = await this.prisma.bid.count({
            where: { vendor: walletAddress },
        });
        if (bidCount > 0) {
            return 'VENDOR';
        }

        // 4. Default: new user
        return 'NEW_USER';
    }

    /**
     * Generate access token (short-lived, 15 minutes)
     */
    private async generateAccessToken(
        walletAddress: string,
        role: UserRole,
        sessionId: string
    ): Promise<string> {
        return await new jose.SignJWT({ walletAddress, role, sessionId })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
            .sign(JWT_SECRET);
    }

    /**
     * Generate refresh token (long-lived, 7 days)
     */
    private async generateRefreshToken(
        walletAddress: string,
        sessionId: string
    ): Promise<string> {
        return await new jose.SignJWT({ walletAddress, sessionId })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime(`${REFRESH_TOKEN_TTL}s`)
            .sign(JWT_SECRET);
    }

    /**
     * Verify Aleo wallet signature
     * 
     * NOTE: This is a placeholder. Real implementation needs Aleo SDK.
     */
    private async verifyAleoSignature(
        walletAddress: string,
        message: string,
        signature: string
    ): Promise<boolean> {
        const allowMockSignature =
            process.env.ALLOW_MOCK_WALLET_SIGNATURE === 'true' ||
            process.env.NODE_ENV === 'test';
        const allowInsecureDevSignature =
            process.env.NODE_ENV !== 'production' &&
            process.env.ALLOW_INSECURE_WALLET_SIGNATURE !== 'false';

        if (allowMockSignature) {
            if (signature === `mock_signature_${walletAddress}_${message}`) {
                return true;
            }

            // When dev fallback is enabled, allow real wallet signatures even if
            // mock mode was accidentally left on.
            if (allowInsecureDevSignature) {
                return signature.trim().length > 0 && walletAddress.startsWith('aleo1');
            }
            return false;
        }

        if (allowInsecureDevSignature) {
            return signature.trim().length > 0 && walletAddress.startsWith('aleo1');
        }

        // Production path: require strict integration until cryptographic verifier is wired.
        throw new Error(
            'Aleo signature verification requires a configured verifier. Set ALLOW_MOCK_WALLET_SIGNATURE=true only for controlled local testing.'
        );
    }

    /**
     * Clean up expired nonces (background job)
     */
    async cleanupExpiredNonces(): Promise<number> {
        const result = await this.prisma.authNonce.deleteMany({
            where: {
                expiresAt: { lt: new Date() },
            },
        });
        return result.count;
    }

    /**
     * Clean up expired sessions (background job)
     */
    async cleanupExpiredSessions(): Promise<number> {
        const result = await this.prisma.authSession.deleteMany({
            where: {
                refreshTokenExpiresAt: { lt: new Date() },
            },
        });
        return result.count;
    }
}
