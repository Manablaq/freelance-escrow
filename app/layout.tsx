import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
export const metadata: Metadata = { title: 'FreelanceEscrow', description: 'AI-powered freelance escrow on GenLayer.' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Providers>{children}</Providers></body></html>
}
