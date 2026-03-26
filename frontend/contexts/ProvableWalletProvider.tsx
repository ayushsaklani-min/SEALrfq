'use client';

import { useMemo } from 'react';
import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react';
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield';
import { DecryptPermission } from '@provablehq/aleo-wallet-adaptor-core';
import { Network } from '@provablehq/aleo-types';

const PROGRAMS = [
    process.env.NEXT_PUBLIC_ALEO_PROGRAM_ID || 'sealrfq_v18.aleo',
    'credits.aleo',
    'test_usdcx_stablecoin.aleo',
    'test_usad_stablecoin.aleo',
];

export function ProvableWalletProvider({ children }: { children: React.ReactNode }) {
    const wallets = useMemo(
        () => [new ShieldWalletAdapter({ appName: 'SealRFQ' })],
        [],
    );

    return (
        <AleoWalletProvider
            wallets={wallets}
            decryptPermission={DecryptPermission.AutoDecrypt}
            network={Network.TESTNET}
            autoConnect={false}
            programs={PROGRAMS}
        >
            {children}
        </AleoWalletProvider>
    );
}
