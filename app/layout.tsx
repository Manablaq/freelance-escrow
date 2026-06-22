import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
export const metadata: Metadata = { title: 'FreelanceEscrow — AI-Powered Payments', description: 'Trustless freelance escrow on GenLayer. AI verifies your work.' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>
}
