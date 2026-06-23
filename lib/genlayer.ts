import { CONTRACT_ADDRESS } from './config'
import { TransactionStatus } from 'genlayer-js/types'

export const TX_POLL_INTERVAL_MS = 4000
export const TX_TIMEOUT_MS = 10 * 60 * 1000

// ── Reads via API route ───────────────────────────────────────────────────────

async function readContract(method: string, args: unknown[] = []) {
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
  return result
}

export async function getProfile(address: string) { return readContract('get_profile', [address]) }
export async function getAllFreelancers() { return readContract('get_all_freelancers', []) }
export async function getJob(jobId: string) { return readContract('get_job', [jobId]) }
export async function getJobsByClient(address: string) { return readContract('get_jobs_by_client', [address]) }
export async function getJobsByFreelancer(address: string) { return readContract('get_jobs_by_freelancer', [address]) }
export async function getStats() { return readContract('get_stats', []) }

// ── Writes via genlayer-js ────────────────────────────────────────────────────

async function getClient(address: string) {
  const { createClient } = await import('genlayer-js')
  const { testnetBradbury } = await import('genlayer-js/chains')
  const client = createClient({ chain: testnetBradbury, account: address as `0x${string}` })
  try { await (client as any).connect('testnetBradbury') } catch {}
  return client as any
}

export async function writeContract(address: string, functionName: string, args: unknown[], value?: bigint) {
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
