import { NextRequest, NextResponse } from 'next/server'
import { CONTRACT_ADDRESS } from '@/lib/config'

// Supports optional `contract` field to query different contracts (e.g. GNS)
export async function POST(req: NextRequest) {
  try {
    const { method, args = [], contract } = await req.json()
    const targetContract = contract || CONTRACT_ADDRESS

    const { createClient } = await import('genlayer-js')
    const { testnetBradbury } = await import('genlayer-js/chains')
    const client = createClient({ chain: testnetBradbury, account: undefined })

    const result = await (client as any).readContract({
      address: targetContract,
      functionName: method,
      args,
      stateStatus: 'accepted',
    })

    return NextResponse.json({ result })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
