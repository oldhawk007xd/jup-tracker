import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JUP Tracker Stats | @olldhawk',
  description:
    'Track your Jupiter wallet: JUP balance, staking, and portfolio overview. Paste any Solana address. NFA.',
  openGraph: {
    title: 'JUP Tracker Stats',
    description: 'Track JUP balance, staking & portfolio. By @olldhawk',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
