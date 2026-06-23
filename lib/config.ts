export const CONTRACT_ADDRESS = '0x6d7e8fE1195919146f1cD7B4e1E1965af4Da101f' as `0x${string}`

export const BRADBURY_CHAIN = {
  id: 4221,
  name: 'GenLayer Bradbury',
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-bradbury.genlayer.com'] } },
  blockExplorers: { default: { name: 'GenExplorer', url: 'https://explorer-bradbury.genlayer.com' } },
} as const
