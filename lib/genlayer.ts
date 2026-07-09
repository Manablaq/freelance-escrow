import { CONTRACT_ADDRESS } from './config'
import { TransactionStatus } from 'genlayer-js/types'

export type Profile = {
  found?: boolean | string
  address?: string
  role?: 'client' | 'freelancer' | string
  name?: string
  bio?: string
  skills?: string
  rate?: string
  rate_type?: string
  portfolio?: string
  twitter?: string
  github?: string
  jobs_completed?: string
  total_earned?: string
}

export type Job = {
  found?: boolean | string
  job_id?: string
  title?: string
  description?: string
  client?: string
  freelancer?: string
  deadline?: string
  status?: string
  created_at?: string
  deliverable_url?: string
  ai_verdict?: string
  ai_reasoning?: string
  escrow_balance?: string
}

export type Stats = {
  total_jobs?: string
  total_paid?: string
  total_freelancers?: string
}

export const TX_POLL_INTERVAL_MS = 4000
export const TX_TIMEOUT_MS = 10 * 60 * 1000
const WRITE_METHODS = new Set([
  'register',
  'update_profile',
  'create_job',
  'fund_job',
  'submit_work',
  'verify_and_release',
  'client_refund',
  'cancel_job',
])

// ── Reads via API route ───────────────────────────────────────────────────────

async function readContract<T>(method: string, args: unknown[] = []): Promise<T> {
  const res = await fetch('/api/contract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error)
  let result = json.result
  if (typeof result === 'string') {
    try { result = JSON.parse(result) } catch {}
  }
  return result as T
}

export async function getProfile(address: string) { return readContract<Profile>('get_profile', [address]) }
export async function getAllFreelancers() { return readContract<Profile[]>('get_all_freelancers', []) }
export async function getJob(jobId: string) { return readContract<Job>('get_job', [jobId]) }
export async function getJobsByClient(address: string) { return readContract<Job[]>('get_jobs_by_client', [address]) }
export async function getJobsByFreelancer(address: string) { return readContract<Job[]>('get_jobs_by_freelancer', [address]) }
export async function getStats() { return readContract<Stats>('get_stats', []) }

// ── Writes via genlayer-js ────────────────────────────────────────────────────

async function getClient(address: string) {
  const { createClient } = await import('genlayer-js')
  const { testnetBradbury } = await import('genlayer-js/chains')
  const client = createClient({ chain: testnetBradbury, account: address as `0x${string}` }) as {
    connect?: (chainName: string) => Promise<unknown>
    writeContract: (request: { address: `0x${string}`; functionName: string; args: unknown[]; value: bigint }) => Promise<string>
    waitForTransactionReceipt: (request: { hash: string; status: TransactionStatus; interval: number; retries: number }) => Promise<unknown>
  }
  try { await client.connect?.('testnetBradbury') } catch {}
  return client
}

export async function writeContract(address: string, functionName: string, args: unknown[], value?: bigint) {
  if (!WRITE_METHODS.has(functionName)) throw new Error('Unsupported contract write method.')
  const client = await getClient(address)
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value: value ?? BigInt(0),
  })
  await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 4000, retries: 60 })
  return hash
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function shortAddress(addr: string) {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatGEN(wei: string | number | bigint) {
  try {
    const n = BigInt(wei)
    const eth = Number(n) / 1e18
    if (eth === 0) return '0 GEN'
    if (eth < 0.0001) return '< 0.0001 GEN'
    return `${eth.toFixed(4)} GEN`
  } catch { return '0 GEN' }
}

export function timeAgo(isoStr: string) {
  if (!isoStr) return ''
  try {
    const d = new Date(isoStr)
    const diff = (Date.now() - d.getTime()) / 1000
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  } catch { return '' }
}
