const configuredAddress = process.env.NEXT_PUBLIC_FREELANCE_MARKET_ADDRESS

export const CONTRACT_ADDRESS = (configuredAddress || '0x75af88bfA0592CFA63c06f2F68BfD35C13dDd4EF') as `0x${string}`
export const DEPLOYMENT_TX = '0x27a83352d39feda126c0d122a3e3223c238708c99f75bfddbb3bf280283902b1'
export const NETWORK_LABEL = 'GenLayer Bradbury Testnet'

export const BRADBURY_CHAIN = {
  id: 4221,
  name: 'GenLayer Bradbury',
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-bradbury.genlayer.com'] } },
  blockExplorers: { default: { name: 'GenExplorer', url: 'https://explorer-bradbury.genlayer.com' } },
} as const
