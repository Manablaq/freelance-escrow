export const CONTRACT_ADDRESS = '0x6d7e8fE1195919146f1cD7B4e1E1965af4Da101f' as `0x${string}`

export const BRADBURY_CHAIN = {
  id: 4221,
  name: 'GenLayer Bradbury',
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-bradbury.genlayer.com'] } },
  blockExplorers: { default: { name: 'GenExplorer', url: 'https://explorer-bradbury.genlayer.com' } },
} as const

export const TX_POLL_INTERVAL_MS = 4000
export const TX_TIMEOUT_MS = 10 * 60 * 1000

export const JOB_STATUSES = {
  OPEN: { label: 'Open', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
  FUNDED: { label: 'Funded', color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
  SUBMITTED: { label: 'Submitted', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  PAID: { label: 'Paid', color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
  DISPUTED: { label: 'Disputed', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  REFUNDED: { label: 'Refunded', color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
  CANCELLED: { label: 'Cancelled', color: '#6B7280', bg: 'rgba(107,114,128,0.12)' },
} as const
