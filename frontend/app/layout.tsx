import './globals.css';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/components/Toast';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WalletErrorModal from '@/components/WalletErrorModal';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SealRFQ - Private Procurement on Aleo',
  description: 'Zero-knowledge sealed-bid procurement platform. Create RFQs, bid privately, settle on-chain.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans min-h-screen flex flex-col`}>
        <WalletProvider>
          <ToastProvider>
            <Navbar />
            <WalletErrorModal />
            <main className="flex-grow pt-16 relative z-10">
              {children}
            </main>
            <Footer />
          </ToastProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
