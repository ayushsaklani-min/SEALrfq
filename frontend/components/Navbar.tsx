'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Wallet, LogOut, Menu, X, ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Navbar() {
    const pathname = usePathname();
    const [isOpen, setIsOpen] = useState(false);
    const { walletAddress, role, connecting, switchRole, connectWallet, disconnectWallet, switchingRole } = useWallet();

    const hideOnLanding = !walletAddress && pathname === '/';
    if (hideOnLanding) return null;

    const homeHref = walletAddress ? '/dashboard' : '/';

    const navLinks = [
        { name: 'Dashboard', href: '/dashboard' },
        ...(role === 'BUYER'
            ? [
                { name: 'Create RFQ', href: '/buyer/create-rfq' },
                { name: 'My RFQs', href: '/buyer/rfqs' },
              ]
            : role === 'VENDOR'
            ? [
                { name: 'Open RFQs', href: '/buyer/rfqs' },
                { name: 'My Bids', href: '/vendor/my-bids' },
              ]
            : []),
        { name: 'Auctions', href: '/auctions' },
        { name: 'Escrow', href: '/escrow' },
    ];

    const walletLabel = walletAddress
        ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
        : 'Connect Wallet';

    return (
        <nav className="fixed w-full z-50 top-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/95 backdrop-blur-sm">
            <div className="max-w-7xl flex items-center justify-between mx-auto px-4 h-16">
                <Link href={homeHref} className="flex items-center gap-2 group">
                    <div className="w-8 h-8 rounded-lg bg-[hsl(var(--primary))] flex items-center justify-center text-[hsl(var(--primary-foreground))] font-bold text-sm">
                        S
                    </div>
                    <span className="text-lg font-semibold text-white tracking-tight">
                        Seal<span className="text-[hsl(var(--primary))]">RFQ</span>
                    </span>
                </Link>

                {/* Desktop nav */}
                <div className="hidden md:flex items-center gap-1">
                    {navLinks.map((link) => {
                        const isActive = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
                        return (
                            <Link
                                key={link.name}
                                href={link.href}
                                className={cn(
                                    'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                                    isActive
                                        ? 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]'
                                        : 'text-[hsl(var(--muted-foreground))] hover:text-white hover:bg-white/5'
                                )}
                            >
                                {link.name}
                            </Link>
                        );
                    })}
                </div>

                <div className="flex items-center gap-2">
                    {walletAddress && (role === 'BUYER' || role === 'VENDOR') && (
                        <button
                            onClick={() => switchRole(role === 'BUYER' ? 'VENDOR' : 'BUYER')}
                            disabled={switchingRole}
                            className="hidden sm:flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                        >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                            {switchingRole ? '...' : role === 'BUYER' ? 'Vendor' : 'Buyer'}
                        </button>
                    )}

                    {walletAddress ? (
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="hidden sm:inline-flex">
                                {role === 'BUYER' ? 'Buyer' : role === 'VENDOR' ? 'Vendor' : role}
                            </Badge>
                            <Button variant="secondary" size="sm" onClick={disconnectWallet} leftIcon={<LogOut className="w-3.5 h-3.5" />}>
                                {walletLabel}
                            </Button>
                        </div>
                    ) : (
                        <Button variant="primary" size="sm" onClick={connectWallet} isLoading={connecting} leftIcon={<Wallet className="w-3.5 h-3.5" />}>
                            {walletLabel}
                        </Button>
                    )}

                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        className="inline-flex items-center p-2 rounded-lg md:hidden text-[hsl(var(--muted-foreground))] hover:bg-white/5"
                    >
                        {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile menu */}
            {isOpen && (
                <div className="md:hidden border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]">
                    <div className="px-4 py-3 space-y-1">
                        {navLinks.map((link) => {
                            const isActive = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
                            return (
                                <Link
                                    key={link.name}
                                    href={link.href}
                                    onClick={() => setIsOpen(false)}
                                    className={cn(
                                        'block px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                                        isActive
                                            ? 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]'
                                            : 'text-[hsl(var(--muted-foreground))] hover:text-white hover:bg-white/5'
                                    )}
                                >
                                    {link.name}
                                </Link>
                            );
                        })}
                    </div>
                </div>
            )}
        </nav>
    );
}
