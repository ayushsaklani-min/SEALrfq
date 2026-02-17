import './globals.css';
import { WalletProvider } from '@/contexts/WalletContext';
import type { Metadata } from 'next';
import { Inter, Outfit } from 'next/font/google';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });

export const metadata: Metadata = {
  title: 'SealRFQ - Secure On-Chain Bidding',
  description: 'A privacy-preserving Request for Quote platform built on Aleo.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${outfit.variable} font-sans bg-black text-cyan-400 min-h-screen flex flex-col`}>
        <div className="neon-grid" />
        <WalletProvider>
          <Navbar />
          <main className="flex-grow pt-20 relative z-10">
            {children}
          </main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}
