// lib/gns.ts — GNS integration for FreelanceMarket
// Resolves .gen names from the GenLayer Name Service
// Contract: 0x15Ca354C73D7f8Ffa02a1e644dCDf41958a7b8A2 (Bradbury)

const GNS_CONTRACT = '0x15Ca354C73D7f8Ffa02a1e644dCDf41958a7b8A2'

async function readGNS(method: string, args: unknown[] = []) {
  try {
    const res = await fetch('/api/contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args, contract: GNS_CONTRACT }),
    })
    const json = await res.json()
    if (json.error) return null
    let result = json.result
    if (typeof result === 'string') {
      try { result = JSON.parse(result) } catch {}
    }
    return result
  } catch { return null }
}

// Resolve wallet address → .gen name (reverse lookup)
export async function resolveGNS(address: string): Promise<string> {
  try {
    const result = await readGNS('reverse_resolve', [address])
    if (result?.found && result?.name) return result.name
    return ''
  } catch { return '' }
}

// Resolve .gen name → wallet address
export async function lookupGNS(name: string): Promise<string> {
  try {
    const result = await readGNS('resolve', [name])
    if (result?.found && result?.address) return result.address
    return ''
  } catch { return '' }
}

// Format address with .gen name if available
export function formatAddress(address: string, genName?: string): string {
  if (genName) return genName
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
