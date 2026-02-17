
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet } from '@/contexts/WalletContext';

export default function Footer() {
    const pathname = usePathname();
    const { walletAddress } = useWallet();

    // Hide Footer on landing page if not connected
    if (!walletAddress && pathname === '/') {
        return null;
    }

    return (
        <footer className="w-full border-t border-white/5 bg-black text-white mt-auto">
            <div className="max-w-7xl mx-auto p-8 md:py-12">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div className="col-span-1 md:col-span-1">
                        <Link href="/" className="flex items-center space-x-2 mb-4 group">
                            <div className="relative w-10 h-10 transition-transform duration-300 group-hover:scale-105">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src="/logo.png" alt="SealRFQ Logo" className="w-full h-full object-contain" />
                            </div>
                            <span className="self-center text-xl font-bold whitespace-nowrap dark:text-white font-display tracking-tight">
                                Seal<span className="text-primary-500">RFQ</span>
                            </span>
                        </Link>
                        <p className="text-sm text-gray-500 mb-4">
                            Secure, privacy-preserving Request for Quote platform built on Aleo.
                        </p>
                    </div>

                    <div>
                        <h3 className="font-semibold text-gray-300 mb-4 uppercase text-xs tracking-wider">Platform</h3>
                        <ul className="space-y-2 text-sm text-gray-500">
                            <li><Link href="/" className="hover:text-primary-400 transition-colors">Home</Link></li>
                            <li><Link href="/escrow" className="hover:text-primary-400 transition-colors">Escrow</Link></li>
                            <li><Link href="/audit" className="hover:text-primary-400 transition-colors">Audit</Link></li>
                        </ul>
                    </div>

                    <div>
                        <h3 className="font-semibold text-gray-300 mb-4 uppercase text-xs tracking-wider">Legal</h3>
                        <ul className="space-y-2 text-sm text-gray-500">
                            <li><a href="#" className="hover:text-primary-400 transition-colors">Privacy Policy</a></li>
                            <li><a href="#" className="hover:text-primary-400 transition-colors">Terms of Service</a></li>
                        </ul>
                    </div>

                    <div>
                        <h3 className="font-semibold text-gray-300 mb-4 uppercase text-xs tracking-wider">Connect</h3>
                        <ul className="space-y-2 text-sm text-gray-500">
                            <li><a href="#" className="hover:text-primary-400 transition-colors">Twitter</a></li>
                            <li><a href="#" className="hover:text-primary-400 transition-colors">Discord</a></li>
                            <li><a href="#" className="hover:text-primary-400 transition-colors">GitHub</a></li>
                        </ul>
                    </div>
                </div>

                <div className="border-t border-white/5 mt-8 pt-8 flex flex-col md:flex-row justify-between items-center text-sm text-gray-600">
                    <span>&copy; {new Date().getFullYear()} SealRFQ. All rights reserved.</span>
                    <div className="flex items-center gap-4 mt-4 md:mt-0">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                        <span>Systems Operational</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}
