'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { RainbowKitProvider, getDefaultConfig, darkTheme } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { BRADBURY_CHAIN } from '@/lib/config'
import { http } from 'wagmi'
const config = getDefaultConfig({ appName: 'FreelanceEscrow', projectId: 'freelance-escrow-genlayer', chains: [BRADBURY_CHAIN], transports: { [BRADBURY_CHAIN.id]: http() }, ssr: false })
const qc = new QueryClient()
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider theme={darkTheme({ accentColor: '#10B981', accentColorForeground: 'white', borderRadius: 'medium' })}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
