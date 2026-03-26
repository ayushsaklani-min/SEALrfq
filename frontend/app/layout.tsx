import './globals.css';
import { WalletProvider } from '@/contexts/WalletContext';
import { ProvableWalletProvider } from '@/contexts/ProvableWalletProvider';
import { ToastProvider } from '@/components/Toast';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WalletErrorModal from '@/components/WalletErrorModal';
import AppRouteGuard from '@/components/AppRouteGuard';
import AppBackdrop from '@/components/AppBackdrop';

const jakarta = Plus_Jakarta_Sans({
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
      <body className={`${jakarta.variable} font-sans min-h-screen flex flex-col`}>
        <ProvableWalletProvider>
        <WalletProvider>
          <ToastProvider>
            <Navbar />
            <WalletErrorModal />
            <main className="premium-app flex-grow pt-16 relative">
              <AppBackdrop />
              <div className="relative z-10">
                <AppRouteGuard>{children}</AppRouteGuard>
              </div>
            </main>
            <Footer />
          </ToastProvider>
        </WalletProvider>
        </ProvableWalletProvider>
      </body>
    </html>
  );
}
