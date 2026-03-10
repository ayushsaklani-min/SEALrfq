"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { getShieldWalletAddress, signShieldWalletMessage, WalletError, type WalletErrorType } from "@/lib/shieldWallet";

export interface WalletConnectionError {
    type: WalletErrorType;
    title: string;
    hint: string;
}

interface WalletContextType {
    ready: boolean;
    walletAddress: string | null;
    role: string | null;
    connecting: boolean;
    switchingRole: boolean;
    connectionError: WalletConnectionError | null;
    connectWallet: () => Promise<boolean>;
    disconnectWallet: () => void;
    switchRole: (nextRole: string) => Promise<void>;
    clearConnectionError: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(false);
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [switchingRole, setSwitchingRole] = useState(false);
    const [connectionError, setConnectionError] = useState<WalletConnectionError | null>(null);

    useEffect(() => {
        const storedAddress = localStorage.getItem("walletAddress");
        const storedRole = localStorage.getItem("role");
        if (storedAddress) setWalletAddress(storedAddress);
        if (storedRole) setRole(storedRole);
        setReady(true);
    }, []);

    const clearConnectionError = () => setConnectionError(null);

    const connectWallet = async () => {
        if (connecting) return false;
        setConnecting(true);
        setConnectionError(null);

        try {
            const address = await getShieldWalletAddress();

            const challengeRes = await fetch("/api/auth/challenge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ walletAddress: address }),
            });

            const challengeData = await challengeRes.json();
            if (!challengeRes.ok || challengeData.status !== "success") {
                throw new Error(challengeData?.error?.message || "Failed to create auth challenge");
            }

            const nonce = challengeData.data.nonce as string;
            const message =
                (challengeData.data.message as string | undefined) ||
                `Sign this nonce to authenticate: ${nonce}`;
            const signature = await signShieldWalletMessage(message);

            const connectRes = await fetch("/api/auth/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    walletAddress: address,
                    nonce,
                    signature,
                }),
            });

            const connectData = await connectRes.json();
            if (!connectRes.ok || connectData.status !== "success") {
                throw new Error(connectData?.error?.message || "Failed to connect wallet");
            }

            // Tokens are stored in httpOnly cookies by the server — do not store in localStorage.
            // Only non-sensitive UI state is kept in localStorage.
            localStorage.setItem("walletAddress", connectData.data.walletAddress);
            localStorage.setItem("role", connectData.data.role);
            setWalletAddress(connectData.data.walletAddress);
            setRole(connectData.data.role);
            return true;
        } catch (error: any) {
            console.error(error);
            if (error instanceof WalletError) {
                setConnectionError({
                    type: error.errorType,
                    title: error.userMessage,
                    hint: error.hint,
                });
            } else {
                setConnectionError({
                    type: 'UNKNOWN',
                    title: 'Connection failed',
                    hint: error?.message || 'Make sure Shield wallet is installed and unlocked, then try again.',
                });
            }
            return false;
        } finally {
            setConnecting(false);
        }
    };

    const disconnectWallet = () => {
        // Token cookies are cleared server-side via /api/auth/logout.
        fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        localStorage.removeItem("walletAddress");
        localStorage.removeItem("role");
        setWalletAddress(null);
        setRole(null);
    };

    const switchRole = async (nextRole: string) => {
        if (!walletAddress || !nextRole || nextRole === role || switchingRole) return;
        setSwitchingRole(true);
        try {
            // Cookies are sent automatically — no manual Authorization header needed.
            const res = await fetch("/api/auth/dev/switch-role", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: nextRole }),
            });
            const json = await res.json();
            if (!res.ok || json.status !== "success") {
                throw new Error(json?.error?.message || "Failed to switch role");
            }

            // Token updated in httpOnly cookie by server; only UI state in localStorage.
            localStorage.setItem("walletAddress", json.data.walletAddress);
            localStorage.setItem("role", json.data.role);
            setRole(json.data.role);
            setWalletAddress(json.data.walletAddress);
        } catch (error: any) {
            console.error(error);
        } finally {
            setSwitchingRole(false);
        }
    };

    return (
        <WalletContext.Provider
            value={{
                ready,
                walletAddress,
                role,
                connecting,
                switchingRole,
                connectionError,
                connectWallet,
                disconnectWallet,
                switchRole,
                clearConnectionError,
            }}
        >
            {children}
        </WalletContext.Provider>
    );
}

export function useWallet() {
    const context = useContext(WalletContext);
    if (context === undefined) {
        throw new Error("useWallet must be used within a WalletProvider");
    }
    return context;
}
