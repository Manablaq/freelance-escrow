// GNS lookups are disabled for this submission so all app reads target only the
// deployed FreelanceMarket contract through the hardened read API.
export async function resolveGNS(address: string): Promise<string> {
  void address
  return ''
}

export async function lookupGNS(name: string): Promise<string> {
  void name
  return ''
}

export function formatAddress(address: string, genName?: string): string {
  if (genName) return genName
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
