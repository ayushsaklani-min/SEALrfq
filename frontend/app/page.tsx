"use client";

import { useWallet } from "@/contexts/WalletContext";
import Dashboard from "@/components/Dashboard";
import VideoGate from "@/components/VideoGate";

export default function Home() {
    const { walletAddress } = useWallet();

    if (!walletAddress) {
        return <VideoGate />;
    }

    return <Dashboard />;
}
