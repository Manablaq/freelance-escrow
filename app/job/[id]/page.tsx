'use client'
import { useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { TopNav } from '@/components/TopNav'
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

  async function doAction(label: string, fn: () => Promise<string>) {
    setTxStatus('pending'); setTxLabel(label); setErrMsg('')
    try { await fn(); setTxStatus('done'); setTimeout(refetch, 2000) }
    catch (e: any) { setTxStatus('error'); setErrMsg((e?.message || '').slice(0, 200)) }
  }

  if (loading) return <>
      <TopNav />
      <div className="orb-orange" style={{ opacity: 0.35 }} />
      <div className="orb-purple" style={{ opacity: 0.35 }} />
      <div className="page" style={{ paddingBottom: 100 }}>
        <div className="inner" style={{ paddingTop: 40 }}><div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>        </div>
      </div>
    </>
  if (!job?.found) return <>
      <TopNav />
      <div className="orb-orange" style={{ opacity: 0.35 }} />
      <div className="orb-purple" style={{ opacity: 0.35 }} />
      <div className="page" style={{ paddingBottom: 100 }}>
        <div className="inner" style={{ paddingTop: 40 }}><div style={{ padding: 20 }}><p style={{ color: 'var(--muted)' }}>Job #{id} not found.</p><button className="btn-outline" style={{ padding: '8px 16px', fontSize: 13, marginTop: 12 }} onClick={() => router.back()}>← Back</button></div>        </div>
      </div>
    </>

  const isClient = address?.toLowerCase() === job.client?.toLowerCase()
  const isFreelancer = address?.toLowerCase() === job.freelancer?.toLowerCase()
  const hasBalance = BigInt(job.escrow_balance || '0') > 0n
  const verdictColor = job.ai_verdict === 'APPROVED' ? 'var(--green)' : job.ai_verdict === 'REJECTED' ? 'var(--red)' : 'var(--muted)'

  return (
    <>
      <TopNav />
      <div className="orb-orange" style={{ opacity: 0.35 }} />
      <div className="orb-purple" style={{ opacity: 0.35 }} />
      <div className="page" style={{ paddingBottom: 100 }}>
        <div className="inner" style={{ paddingTop: 40 }}>
      <div style={{ maxWidth: 560 }}>
        {/* Back */}
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 5 }}>← Back</button>

        {/* Title + status */}
        <div className="fade-in" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap' }}>
            <h1 className="font-display" style={{ fontSize: 'clamp(16px,3vw,22px)', fontWeight: 700, letterSpacing: '-0.01em', flex: 1 }}>{job.title}</h1>
            <StatusBadge status={job.status} />
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 12 }}>{job.description}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span className="address-chip">client: {shortAddress(job.client)}</span>
            <span className="address-chip">freelancer: {shortAddress(job.freelancer)}</span>
            {job.deadline && <span className="address-chip">due: {job.deadline}</span>}
            {job.created_at && <span className="address-chip">{timeAgo(job.created_at)}</span>}
          </div>
        </div>

        {/* Balance */}
        <div className="panel fade-in" style={{ padding: '14px 18px', marginBottom: 12, borderColor: hasBalance ? 'rgba(0,212,255,0.25)' : 'var(--border2)', background: hasBalance ? 'rgba(0,212,255,0.04)' : 'var(--panel)' }}>
          <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>Escrowed</p>
          <p className="font-display" style={{ fontSize: 26, fontWeight: 800, color: hasBalance ? 'var(--cyan)' : 'var(--muted)', textShadow: hasBalance ? '0 0 16px rgba(0,212,255,0.35)' : 'none' }}>
            {formatGEN(job.escrow_balance || '0')}
          </p>
        </div>

        {/* AI Verdict */}
        {job.ai_verdict && (
          <div className="panel fade-in" style={{ padding: '14px 18px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13 }}>🤖</span>
              <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>AI Verdict</p>
              <span style={{ fontSize: 13, fontWeight: 700, color: verdictColor }}>{job.ai_verdict}</span>
            </div>
            {job.ai_reasoning && <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.65 }}>{job.ai_reasoning}</p>}
          </div>
        )}

        {/* Deliverable */}
        {job.deliverable_url && (
          <div className="panel fade-in" style={{ padding: '12px 16px', marginBottom: 12 }}>
            <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>Deliverable</p>
            <a href={job.deliverable_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--cyan)', wordBreak: 'break-all', textDecoration: 'none' }}>{job.deliverable_url} ↗</a>
          </div>
        )}

        <hr className="divider" />

        {/* TX feedback */}
        {txStatus === 'pending' && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '12px 16px', background: 'rgba(139,53,255,0.08)', border: '1px solid rgba(139,53,255,0.2)', borderRadius: 10 }}><div className="spinner" /><p style={{ fontSize: 13, color: 'var(--purple)' }}>{txLabel}...</p></div>}
        {txStatus === 'done' && <div style={{ marginBottom: 12, padding: '12px 16px', background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.2)', borderRadius: 10, fontSize: 13, color: 'var(--green)' }}>✓ Done</div>}
        {errMsg && <div style={{ marginBottom: 12, padding: '12px 16px', background: 'rgba(255,77,106,0.08)', border: '1px solid rgba(255,77,106,0.2)', borderRadius: 10, fontSize: 13, color: 'var(--red)', wordBreak: 'break-word' }}>{errMsg}</div>}

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isClient && job.status === 'OPEN' && (
            <div className="panel" style={{ padding: '16px 18px' }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>💰 Fund Escrow</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ padding: '10px 12px', fontSize: 14 }} placeholder="GEN amount" type="number" min="0" step="0.001" value={fundAmount} onChange={e => setFundAmount(e.target.value)} />
                <button className="btn-cyan" style={{ padding: '10px 16px', fontSize: 14, flexShrink: 0 }} onClick={() => doAction('Funding', () => writeContract(address!, 'fund_job', [id], parseEther(fundAmount as `${number}`)))} disabled={!fundAmount || txStatus === 'pending'}>Lock</button>
              </div>
            </div>
          )}
          {isFreelancer && job.status === 'FUNDED' && (
            <div className="panel" style={{ padding: '16px 18px' }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>📎 Submit Work</p>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Any public URL — GitHub, live app, doc, Figma</p>
              <input className="input" style={{ padding: '10px 12px', fontSize: 13, marginBottom: 10 }} placeholder="https://..." value={deliverableUrl} onChange={e => setDeliverableUrl(e.target.value)} />
              <button className="btn-primary" style={{ padding: '11px', fontSize: 14, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }} onClick={() => doAction('Submitting', () => writeContract(address!, 'submit_work', [id, deliverableUrl]))} disabled={!deliverableUrl.startsWith('http') || txStatus === 'pending'}>Submit Work →</button>
            </div>
          )}
          {isClient && job.status === 'SUBMITTED' && (
            <div className="panel" style={{ padding: '16px 18px', borderColor: 'rgba(139,53,255,0.3)', background: 'rgba(139,53,255,0.04)' }}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>🤖 Verify with AI</p>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>5 validators fetch the deliverable and check it against your job description. Approved → payment auto-releases.</p>
              <button className="btn-primary" style={{ padding: '12px', fontSize: 15, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={() => doAction('AI verifying', () => writeContract(address!, 'verify_and_release', [id]))} disabled={txStatus === 'pending'}>
                {txStatus === 'pending' ? <><div className="spinner" />Verifying...</> : '⚡ Verify & Release'}
              </button>
            </div>
          )}
          {isClient && ['DISPUTED', 'FUNDED'].includes(job.status) && (
            <button className="btn-danger" style={{ padding: '12px', fontSize: 14 }} onClick={() => doAction('Refunding', () => writeContract(address!, 'client_refund', [id]))} disabled={txStatus === 'pending'}>Refund Escrowed GEN</button>
          )}
          {isClient && job.status === 'OPEN' && (
            <button className="btn-outline" style={{ padding: '10px', fontSize: 13, opacity: 0.6 }} onClick={() => doAction('Cancelling', () => writeContract(address!, 'cancel_job', [id]))} disabled={txStatus === 'pending'}>Cancel Job</button>
          )}
        </div>
      </div>
            </div>
      </div>
    </>
  )
}
