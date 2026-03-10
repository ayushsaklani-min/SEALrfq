import './globals.css';
import { WalletProvider } from '@/contexts/WalletContext';
import type { Metadata } from 'next';
import { IBM_Plex_Mono, Inter, Sora } from 'next/font/google';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WalletErrorModal from '@/components/WalletErrorModal';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});
const sora = Sora({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
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
        className={`${inter.variable} ${sora.variable} ${ibmPlexMono.variable} font-sans bg-black text-cyan-400 min-h-screen flex flex-col`}
      >
        <div className="neon-grid" />
        <WalletProvider>
          <Navbar />
          <WalletErrorModal />
          <main className="flex-grow pt-20 relative z-10">
            {children}
          </main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}
