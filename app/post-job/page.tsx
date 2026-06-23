'use client'
import { useState, useEffect, Suspense } from 'react'
import { useAccount } from 'wagmi'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { writeContract, getProfile } from '@/lib/genlayer'
import { useConnectModal } from '@rainbow-me/rainbowkit'

function PostJobContent() {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const router = useRouter()
  const params = useSearchParams()
  const preFilledFreelancer = params.get('freelancer') || ''
  const preFilledName = params.get('name') || ''

  const [step, setStep] = useState(0)
  const [form, setForm] = useState({ title: '', description: '', freelancer: preFilledFreelancer, deadline: '' })
  const [txStatus, setTxStatus] = useState<'idle' | 'checking' | 'submitting' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [clientProfile, setClientProfile] = useState<any>(null)

  useEffect(() => {
    if (!address) return
    getProfile(address).then(p => setClientProfile(p?.found ? p : null)).catch(() => {})
  }, [address])

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))
  const valid0 = form.title.length >= 3 && form.description.length >= 20 && form.deadline.length > 0
  const valid1 = form.freelancer.length === 42 && form.freelancer.startsWith('0x')

  async function submit() {
    if (!address) return
    setTxStatus('submitting'); setErrMsg('')
    try {
      await writeContract(address, 'create_job', [form.title, form.description, form.freelancer, form.deadline])
      setTxStatus('done')
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (e: any) {
      setTxStatus('error')
      setErrMsg((e?.message || String(e)).slice(0, 200))
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
        {['Details', 'Freelancer', 'Review'].map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < 2 ? 1 : 'unset' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: i <= step ? 'var(--grad)' : 'var(--panel)', border: `1px solid ${i <= step ? 'transparent' : 'var(--border2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: i <= step ? 'white' : 'var(--muted)', flexShrink: 0 }}>
                {i < step ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 12, fontWeight: i === step ? 600 : 400, color: i === step ? 'var(--text)' : 'var(--muted)' }}>{s}</span>
            </div>
            {i < 2 && <div style={{ flex: 1, height: 1, background: i < step ? 'var(--purple)' : 'var(--border2)', margin: '0 10px' }} />}
          </div>
        ))}
      </div>

      {!isConnected ? (
        <div className="panel" style={{ padding: '36px 24px', textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>Connect wallet to post a job</p>
          <button className="btn-primary" style={{ padding: '11px 24px', fontSize: 14 }} onClick={openConnectModal}>Connect Wallet</button>
        </div>
      ) : !clientProfile ? (
        <div className="panel" style={{ padding: '36px 24px', textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>You need a client profile to post jobs</p>
          <button className="btn-primary" style={{ padding: '11px 24px', fontSize: 14 }} onClick={() => router.push('/register')}>Register as Client</button>
        </div>
      ) : clientProfile.role !== 'client' ? (
        <div className="panel" style={{ padding: '36px 24px', textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)' }}>Only clients can post jobs. You are registered as a freelancer.</p>
        </div>
      ) : txStatus === 'done' ? (
        <div className="panel" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
          <p className="font-display" style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Job posted!</p>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Redirecting to dashboard...</p>
        </div>
      ) : (
        <>
          {step === 0 && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Job Title</label>
                <input className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder="e.g. Design a landing page for my Web3 startup" value={form.title} onChange={e => f('title', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Description <span style={{ color: 'var(--purple)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— min 20 chars</span></label>
                <textarea className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder="Describe exactly what needs to be delivered. AI validators will use this to verify the work." value={form.description} onChange={e => f('description', e.target.value)} />
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{form.description.length} chars</p>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Deadline</label>
                <input className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder="2026-07-15" value={form.deadline} onChange={e => f('deadline', e.target.value)} />
              </div>
              <button className="btn-primary" style={{ padding: '12px', fontSize: 15, marginTop: 4 }} onClick={() => setStep(1)} disabled={!valid0}>Next →</button>
            </div>
          )}

          {step === 1 && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {preFilledFreelancer ? (
                <div className="panel" style={{ padding: '14px 16px', borderColor: 'rgba(0,212,255,0.25)', background: 'rgba(0,212,255,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cyan)', display: 'inline-block' }} />
                    <p style={{ fontSize: 14, fontWeight: 600 }}>{preFilledName}</p>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: 4 }}>{preFilledFreelancer}</p>
                  <p style={{ fontSize: 11, color: 'var(--cyan)', marginTop: 6 }}>Pre-filled from marketplace ✓</p>
                </div>
              ) : (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Freelancer Wallet Address</label>
                  <input className="input" style={{ padding: '10px 13px', fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }} placeholder="0x..." value={form.freelancer} onChange={e => f('freelancer', e.target.value)} />
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>Or browse from <button onClick={() => router.push('/marketplace')} style={{ background: 'none', border: 'none', color: 'var(--purple)', cursor: 'pointer', fontSize: 11 }}>Marketplace →</button></p>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-outline" style={{ padding: '11px', fontSize: 14, flex: 1 }} onClick={() => setStep(0)}>← Back</button>
                <button className="btn-primary" style={{ padding: '11px', fontSize: 15, flex: 2 }} onClick={() => setStep(2)} disabled={!valid1}>Review →</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[['Title', form.title], ['Deadline', form.deadline], ['Freelancer', form.freelancer]].map(([label, val]) => (
                <div key={label} className="panel" style={{ padding: '11px 15px', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                  <span style={{ fontSize: 12, textAlign: 'right', wordBreak: 'break-all', fontFamily: label === 'Freelancer' ? 'JetBrains Mono, monospace' : 'inherit' }}>{val}</span>
                </div>
              ))}
              <div className="panel" style={{ padding: '11px 15px' }}>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Description</p>
                <p style={{ fontSize: 13, lineHeight: 1.6 }}>{form.description.slice(0, 100)}{form.description.length > 100 ? '...' : ''}</p>
              </div>
              {errMsg && <div style={{ padding: '11px 15px', background: 'rgba(255,77,106,0.08)', border: '1px solid rgba(255,77,106,0.25)', borderRadius: 10, fontSize: 13, color: 'var(--red)', wordBreak: 'break-word' }}>{errMsg}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-outline" style={{ padding: '11px', fontSize: 14, flex: 1 }} onClick={() => setStep(1)} disabled={txStatus === 'submitting'}>← Back</button>
                <button className="btn-primary" style={{ padding: '11px', fontSize: 15, flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={submit} disabled={txStatus === 'submitting'}>
                  {txStatus === 'submitting' ? <><div className="spinner" />Confirming...</> : '⚡ Post Job'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function PostJobPage() {
  return (
    <AppShell>
      <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" style={{ width: 24, height: 24 }} /></div>}>
        <PostJobContent />
      </Suspense>
    </AppShell>
  )
}
