'use client'
import { useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { BottomNav } from '@/components/BottomNav'
import { StatusBadge } from '@/components/StatusBadge'
import { getJob, writeContract, shortAddress, formatGEN, timeAgo } from '@/lib/genlayer'
import { usePolling } from '@/hooks/usePolling'
import { parseEther } from 'viem'

export default function JobPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { address } = useAccount()

  const fetcher = useCallback(() => getJob(id), [id])
  const { data: job, loading, refetch } = usePolling(fetcher, 5000)

  const [fundAmount, setFundAmount] = useState('')
  const [deliverableUrl, setDeliverableUrl] = useState('')
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle')
  const [txLabel, setTxLabel] = useState('')
  const [errMsg, setErrMsg] = useState('')

  if (loading) return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </main>
  )

  if (!job?.found) return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
      <p style={{ fontSize: 18, color: 'var(--muted)' }}>Job #{id} not found.</p>
      <button className="btn-outline" style={{ padding: '10px 20px' }} onClick={() => router.back()}>← Back</button>
      <BottomNav />
    </main>
  )

  const isClient = address?.toLowerCase() === job.client?.toLowerCase()
  const isFreelancer = address?.toLowerCase() === job.freelancer?.toLowerCase()

  async function doAction(label: string, fn: () => Promise<string>) {
    setTxStatus('pending')
    setTxLabel(label)
    setErrMsg('')
    try {
      await fn()
      setTxStatus('done')
      setTimeout(refetch, 2000)
    } catch (e: any) {
      setTxStatus('error')
      setErrMsg((e?.message || String(e)).slice(0, 200))
    }
  }

  const verdictColor = job.ai_verdict === 'APPROVED' ? 'var(--green)' : job.ai_verdict === 'REJECTED' ? 'var(--red)' : 'var(--muted)'

  return (
    <main style={{ minHeight: '100vh', padding: '80px 20px 120px', maxWidth: 600, margin: '0 auto' }}>
      <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6 }}>← Back</button>

      {/* Header */}
      <div className="fade-up" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <h1 className="font-display" style={{ fontSize: 'clamp(18px,4vw,24px)', fontWeight: 700, letterSpacing: '-0.01em', flex: 1 }}>{job.title}</h1>
          <StatusBadge status={job.status} />
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>{job.description}</p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span className="address-chip">Client: {shortAddress(job.client)}</span>
          <span className="address-chip">Freelancer: {shortAddress(job.freelancer)}</span>
          {job.deadline && <span className="address-chip">Due: {job.deadline}</span>}
          {job.created_at && <span className="address-chip">{timeAgo(job.created_at)}</span>}
        </div>
      </div>

      {/* Escrow balance */}
      <div className="card-flat fade-up-d1" style={{ padding: '18px 20px', marginBottom: 16 }}>
        <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>Escrowed</p>
        <p className="font-display" style={{ fontSize: 28, fontWeight: 700, color: BigInt(job.escrow_balance || '0') > 0n ? 'var(--green)' : 'var(--muted)' }}>
          {formatGEN(job.escrow_balance || '0')}
        </p>
      </div>

      {/* AI Verdict */}
      {job.ai_verdict && (
        <div className="card-flat fade-up-d1" style={{ padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>AI Verdict</p>
            <span style={{ fontSize: 13, fontWeight: 700, color: verdictColor }}>{job.ai_verdict}</span>
          </div>
          {job.ai_reasoning && <p style={{ fontSize: 13, color: 'rgba(241,245,249,0.6)', lineHeight: 1.6 }}>{job.ai_reasoning}</p>}
        </div>
      )}

      {/* Deliverable */}
      {job.deliverable_url && (
        <div className="card-flat fade-up-d2" style={{ padding: '18px 20px', marginBottom: 16 }}>
          <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Deliverable</p>
          <a href={job.deliverable_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--blue)', wordBreak: 'break-all' }}>{job.deliverable_url}</a>
        </div>
      )}

      <hr className="divider" />

      {/* Actions */}
      {txStatus === 'pending' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '12px 16px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12 }}>
          <div className="spinner" />
          <p style={{ fontSize: 14, color: 'var(--green)' }}>{txLabel}...</p>
        </div>
      )}
      {txStatus === 'done' && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, fontSize: 14, color: 'var(--green)' }}>
          ✓ Done! Refreshing...
        </div>
      )}
      {errMsg && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, fontSize: 13, color: 'var(--red)', wordBreak: 'break-word' }}>
          {errMsg}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Fund Job — client, OPEN */}
        {isClient && job.status === 'OPEN' && (
          <div className="card-flat" style={{ padding: '18px 20px' }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Fund Escrow</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <input className="input" style={{ padding: '10px 14px', fontSize: 14 }} placeholder="Amount in GEN" type="number" min="0" step="0.001" value={fundAmount} onChange={e => setFundAmount(e.target.value)} />
              <button className="btn-primary" style={{ padding: '10px 18px', fontSize: 14, flexShrink: 0 }}
                onClick={() => doAction('Funding escrow', () => writeContract(address!, 'fund_job', [id], parseEther(fundAmount as `${number}`)))}
                disabled={!fundAmount || txStatus === 'pending'}>
                Lock GEN
              </button>
            </div>
          </div>
        )}

        {/* Submit Work — freelancer, FUNDED */}
        {isFreelancer && job.status === 'FUNDED' && (
          <div className="card-flat" style={{ padding: '18px 20px' }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Submit Your Work</p>
            <input className="input" style={{ padding: '10px 14px', fontSize: 14, marginBottom: 10 }} placeholder="https://github.com/... or any public URL" value={deliverableUrl} onChange={e => setDeliverableUrl(e.target.value)} />
            <button className="btn-primary" style={{ padding: '12px', fontSize: 15, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onClick={() => doAction('Submitting work', () => writeContract(address!, 'submit_work', [id, deliverableUrl]))}
              disabled={!deliverableUrl.startsWith('http') || txStatus === 'pending'}>
              Submit Work →
            </button>
          </div>
        )}

        {/* Verify & Release — client, SUBMITTED */}
        {isClient && job.status === 'SUBMITTED' && (
          <div className="card-flat" style={{ padding: '18px 20px', background: 'rgba(16,185,129,0.04)' }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Verify Deliverable</p>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>AI validators will fetch the deliverable URL and check it against your job description. If approved, GEN is automatically sent to the freelancer.</p>
            <button className="btn-primary" style={{ padding: '13px', fontSize: 15, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onClick={() => doAction('Running AI verification', () => writeContract(address!, 'verify_and_release', [id]))}
              disabled={txStatus === 'pending'}>
              {txStatus === 'pending' ? <><div className="spinner" />Verifying with AI...</> : '🤖 Verify & Release Payment'}
            </button>
          </div>
        )}

        {/* Refund — client, DISPUTED or FUNDED */}
        {isClient && ['DISPUTED', 'FUNDED'].includes(job.status) && (
          <button className="btn-danger" style={{ padding: '12px', fontSize: 14, width: '100%' }}
            onClick={() => doAction('Requesting refund', () => writeContract(address!, 'client_refund', [id]))}
            disabled={txStatus === 'pending'}>
            Refund Escrowed GEN
          </button>
        )}

        {/* Cancel — client, OPEN */}
        {isClient && job.status === 'OPEN' && (
          <button className="btn-outline" style={{ padding: '10px', fontSize: 13, width: '100%' }}
            onClick={() => doAction('Cancelling job', () => writeContract(address!, 'cancel_job', [id]))}
            disabled={txStatus === 'pending'}>
            Cancel Job
          </button>
        )}
      </div>

      <BottomNav />
    </main>
  )
}
