'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Dashboard from '@/components/Dashboard';
import { useWallet } from '@/contexts/WalletContext';

export default function DashboardPage() {
    const router = useRouter();
    const { ready, walletAddress, role } = useWallet();

    useEffect(() => {
        if (!ready) return;
        if (!walletAddress) {
            router.replace('/');
            return;
        }
        if (!role || role === 'NEW_USER') {
            router.replace('/select-role');
        }
    }, [ready, router, walletAddress, role]);

    if (!ready || !walletAddress || !role || role === 'NEW_USER') {
        return <div className="min-h-screen bg-black" />;
    }

    return <Dashboard />;
}
