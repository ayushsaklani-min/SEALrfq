"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { getShieldWalletAddress, signShieldWalletNonce } from "@/lib/shieldWallet";

interface WalletContextType {
    walletAddress: string | null;
    role: string | null;
    connecting: boolean;
    switchingRole: boolean;
    connectWallet: () => Promise<void>;
    disconnectWallet: () => void;
    switchRole: (nextRole: string) => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [switchingRole, setSwitchingRole] = useState(false);

    useEffect(() => {
        const storedAddress = localStorage.getItem("walletAddress");
        const storedRole = localStorage.getItem("role");
        if (storedAddress) setWalletAddress(storedAddress);
        if (storedRole) setRole(storedRole);
    }, []);

    const connectWallet = async () => {
        if (connecting) return;
        setConnecting(true);

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
            const signature = await signShieldWalletNonce(nonce);

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

            localStorage.setItem("accessToken", connectData.data.accessToken);
            localStorage.setItem("walletAddress", connectData.data.walletAddress);
            localStorage.setItem("role", connectData.data.role);
            setWalletAddress(connectData.data.walletAddress);
            setRole(connectData.data.role);
        } catch (error: any) {
            console.error(error);
            alert(error?.message || "Shield wallet connection failed");
        } finally {
            setConnecting(false);
        }
    };

    const disconnectWallet = () => {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("walletAddress");
        localStorage.removeItem("role");
        setWalletAddress(null);
        setRole(null);
    };

    const switchRole = async (nextRole: string) => {
        if (!walletAddress || !nextRole || nextRole === role || switchingRole) return;
        setSwitchingRole(true);
        try {
            const res = await fetch("/api/auth/dev/switch-role", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("accessToken") || ""}`,
                },
                body: JSON.stringify({ role: nextRole }),
            });
            const json = await res.json();
            if (!res.ok || json.status !== "success") {
                throw new Error(json?.error?.message || "Failed to switch role");
            }

            localStorage.setItem("accessToken", json.data.accessToken);
            localStorage.setItem("walletAddress", json.data.walletAddress);
            localStorage.setItem("role", json.data.role);
            setRole(json.data.role);
            setWalletAddress(json.data.walletAddress);
        } catch (error: any) {
            console.error(error);
            alert(error?.message || "Role switch failed");
        } finally {
            setSwitchingRole(false);
        }
    };

    return (
        <WalletContext.Provider
            value={{
                walletAddress,
                role,
                connecting,
                switchingRole,
                connectWallet,
                disconnectWallet,
                switchRole,
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
