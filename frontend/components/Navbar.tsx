'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from '@/contexts/WalletContext';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Wallet, LogOut, Menu, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Navbar() {
    const pathname = usePathname();
    const [isOpen, setIsOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const { walletAddress, role, connecting, switchRole, connectWallet, disconnectWallet, switchingRole } = useWallet();
    const showRoleSwitcher = process.env.NODE_ENV !== 'production';

    // Handle scroll effect
    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Hide Navbar on landing page if not connected
    if (!walletAddress && pathname === '/') {
        return null;
    }



    const navLinks = [
        { name: 'Home', href: '/' },
        ...(role === 'VENDOR'
            ? [{ name: 'Vendor Dashboard', href: '/vendor/my-bids' }]
            : [{ name: 'Buyer Dashboard', href: '/buyer/rfqs' }]),
        { name: 'Escrow', href: '/escrow' },
        { name: 'Audit', href: '/audit' },
    ];



    const walletLabel = walletAddress
        ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
        : 'Connect Shield';

    return (
        <motion.nav
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.5 }}
            className={cn(
                "fixed w-full z-50 top-0 start-0 transition-all duration-300 border-b border-white/5",
                scrolled ? "glass-panel border-white/10" : "bg-transparent border-transparent"
            )}
        >
            <div className="max-w-7xl flex flex-wrap items-center justify-between mx-auto p-4">
                <Link href="/" className="flex items-center space-x-2 rtl:space-x-reverse group">
                    <div className="relative w-10 h-10 group-hover:scale-105 transition-transform duration-300">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/logo.png" alt="SealRFQ Logo" className="w-full h-full object-contain drop-shadow-lg" />
                    </div>
                    <span className="self-center text-xl font-bold whitespace-nowrap dark:text-white font-display tracking-tight group-hover:text-primary-300 transition-colors">
                        Seal<span className="text-primary-500">RFQ</span>
                    </span>
                </Link>

                <div className="flex md:order-2 space-x-3 md:space-x-4 rtl:space-x-reverse items-center">
                    {walletAddress && showRoleSwitcher && (
                        <div className="relative group hidden sm:block">
                            <select
                                value={role || 'NEW_USER'}
                                onChange={(e) => switchRole(e.target.value)}
                                disabled={switchingRole}
                                className="appearance-none bg-black border-2 border-cyan-400/30 text-cyan-400 text-xs rounded-lg px-3 py-1.5 pr-8 focus:outline-none focus:ring-1 focus:ring-cyan-400 transition-colors cursor-pointer hover:bg-cyan-400/5 hover:border-cyan-400/50"
                                style={{
                                    textShadow: '0 0 5px rgba(34, 211, 238, 0.5)',
                                    boxShadow: '0 0 10px rgba(34, 211, 238, 0.2)'
                                }}
                                title="Dev role switcher"
                            >
                                <option value="BUYER" className="bg-black text-cyan-400">BUYER</option>
                                <option value="VENDOR" className="bg-black text-cyan-400">VENDOR</option>
                                <option value="AUDITOR" className="bg-black text-cyan-400">AUDITOR</option>
                                <option value="NEW_USER" className="bg-black text-cyan-400">NEW_USER</option>
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-cyan-400 pointer-events-none" style={{ filter: 'drop-shadow(0 0 3px rgba(34, 211, 238, 0.5))' }} />
                        </div>
                    )}

                    {walletAddress ? (
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="hidden sm:inline-flex border-primary-500/30 bg-primary-500/10 text-primary-300">
                                {role}
                            </Badge>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={disconnectWallet}
                                leftIcon={<LogOut className="w-4 h-4" />}
                            >
                                {walletLabel}
                            </Button>
                        </div>
                    ) : (
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={connectWallet}
                            isLoading={connecting}
                            leftIcon={<Wallet className="w-4 h-4" />}
                        >
                            {walletLabel}
                        </Button>
                    )}

                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        type="button"
                        className="inline-flex items-center p-2 w-10 h-10 justify-center text-sm text-gray-400 rounded-lg md:hidden hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-primary-500/50 transition-colors"
                        aria-expanded={isOpen}
                    >
                        <span className="sr-only">Open main menu</span>
                        {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </button>
                </div>

                <div className={cn(
                    "items-center justify-between w-full md:flex md:w-auto md:order-1 transition-all duration-300 ease-in-out",
                    isOpen ? "block" : "hidden"
                )}>
                    <ul className="flex flex-col p-4 md:p-0 mt-4 font-medium border-2 border-cyan-400/30 rounded-xl bg-black/90 md:space-x-8 rtl:space-x-reverse md:flex-row md:mt-0 md:border-0 md:bg-transparent backdrop-blur-md md:backdrop-blur-none" style={{ boxShadow: '0 0 20px rgba(34, 211, 238, 0.3)' }}>
                        {navLinks.map((link) => {
                            const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
                            return (
                                <li key={link.name}>
                                    <Link
                                        href={link.href}
                                        className={cn(
                                            "block py-2 px-3 rounded-lg md:p-0 transition-all duration-200 relative",
                                            isActive
                                                ? "text-cyan-400 bg-cyan-400/10 md:bg-transparent md:text-cyan-400 border border-cyan-400/30 md:border-0"
                                                : "text-cyan-300/70 hover:text-cyan-400 hover:bg-cyan-400/5 md:hover:bg-transparent"
                                        )}
                                        aria-current={isActive ? 'page' : undefined}
                                        onClick={() => setIsOpen(false)}
                                    >
                                        {link.name}
                                        {isActive && (
                                            <span className="absolute -bottom-1 left-0 w-full h-0.5 bg-cyan-400/80 rounded-full hidden md:block animate-fade-in" style={{ boxShadow: '0 0 5px rgba(34, 211, 238, 0.8)' }} />
                                        )}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </motion.nav>
    );
}
