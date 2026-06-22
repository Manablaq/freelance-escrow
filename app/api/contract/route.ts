import { NextRequest, NextResponse } from 'next/server'
import { CONTRACT_ADDRESS } from '@/lib/config'

export async function POST(req: NextRequest) {
  try {
    const { method, args = [] } = await req.json()
    const { createClient } = await import('genlayer-js')
    const { testnetBradbury } = await import('genlayer-js/chains')
    const client = createClient({ chain: testnetBradbury, account: undefined })
    const result = await (client as any).readContract({
      address: CONTRACT_ADDRESS,
      functionName: method,
      args,
      stateStatus: 'accepted',
    })
    return NextResponse.json({ result })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
