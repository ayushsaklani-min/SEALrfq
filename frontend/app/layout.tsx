import './globals.css';
import { WalletProvider } from '@/contexts/WalletContext';
import type { Metadata } from 'next';
import { Chakra_Petch, IBM_Plex_Mono, Manrope } from 'next/font/google';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});
const chakraPetch = Chakra_Petch({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

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
      <body
        className={`${manrope.variable} ${chakraPetch.variable} ${ibmPlexMono.variable} font-sans bg-black text-cyan-400 min-h-screen flex flex-col`}
      >
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
