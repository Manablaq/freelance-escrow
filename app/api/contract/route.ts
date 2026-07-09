import { NextRequest, NextResponse } from 'next/server'
import { CONTRACT_ADDRESS } from '@/lib/config'

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const JOB_ID_RE = /^[1-9][0-9]{0,17}$/

const READ_METHODS = {
  get_profile: {
    argCount: 1,
    validate: (args: unknown[]) => typeof args[0] === 'string' && ADDRESS_RE.test(args[0]),
  },
  get_all_freelancers: {
    argCount: 0,
    validate: () => true,
  },
  get_job: {
    argCount: 1,
    validate: (args: unknown[]) => typeof args[0] === 'string' && JOB_ID_RE.test(args[0]),
  },
  get_jobs_by_client: {
    argCount: 1,
    validate: (args: unknown[]) => typeof args[0] === 'string' && ADDRESS_RE.test(args[0]),
  },
  get_jobs_by_freelancer: {
    argCount: 1,
    validate: (args: unknown[]) => typeof args[0] === 'string' && ADDRESS_RE.test(args[0]),
  },
  get_stats: {
    argCount: 0,
    validate: () => true,
  },
} as const

type ReadMethod = keyof typeof READ_METHODS

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const method = body?.method
    const args = body?.args ?? []

    if (typeof method !== 'string' || !(method in READ_METHODS)) {
      return jsonError('Unsupported contract read method.', 400)
    }

    if (!Array.isArray(args)) {
      return jsonError('Contract read args must be an array.', 400)
    }

    const spec = READ_METHODS[method as ReadMethod]
    if (args.length !== spec.argCount || !spec.validate(args)) {
      return jsonError(`Invalid arguments for ${method}.`, 400)
    }

    const { createClient } = await import('genlayer-js')
    const { testnetBradbury } = await import('genlayer-js/chains')
    const client = createClient({ chain: testnetBradbury, account: undefined }) as {
      readContract: (request: {
        address: `0x${string}`
        functionName: ReadMethod
        args: unknown[]
        stateStatus: 'accepted'
      }) => Promise<unknown>
    }

    const result = await client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: method as ReadMethod,
      args,
      stateStatus: 'accepted',
    })

    return NextResponse.json({ result })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Contract read failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
