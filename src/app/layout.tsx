export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

export const metadata: Metadata = {
  title: 'Masters Calcutta Pool',
  description: 'Auction-style fantasy pool for The Masters golf tournament',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-masters-cream font-body">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
