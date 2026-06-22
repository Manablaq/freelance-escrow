'use client'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { writeContract } from '@/lib/genlayer'
import { useConnectModal } from '@rainbow-me/rainbowkit'

const STEPS = ['Details', 'Freelancer', 'Review']

export default function PostJobPage() {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({ title: '', description: '', freelancer: '', deadline: '' })
  const [txStatus, setTxStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

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

  const f = (key: string, val: string) => setForm(p => ({ ...p, [key]: val }))

  return (
    <AppShell>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '8px 0' }}>

        {/* Step progress */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'unset' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: i <= step ? 'var(--grad)' : 'var(--panel)', border: `1px solid ${i <= step ? 'transparent' : 'var(--border2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: i <= step ? 'white' : 'var(--muted)', transition: 'all 0.2s', flexShrink: 0 }}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: 13, fontWeight: i === step ? 600 : 400, color: i === step ? 'var(--text)' : 'var(--muted)' }}>{s}</span>
              </div>
              {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: i < step ? 'var(--purple)' : 'var(--border2)', margin: '0 12px', transition: 'background 0.3s' }} />}
            </div>
          ))}
        </div>

        {!isConnected ? (
          <div className="panel" style={{ padding: '36px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔌</div>
            <p className="font-display" style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Wallet required</p>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>Connect to post a job</p>
            <button className="btn-primary" style={{ padding: '11px 24px', fontSize: 14 }} onClick={openConnectModal}>Connect Wallet</button>
          </div>
        ) : txStatus === 'done' ? (
          <div className="panel" style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <p className="font-display" style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Job posted!</p>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Going to dashboard...</p>
          </div>
        ) : (
          <>
            {step === 0 && (
              <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Job Title</label>
                  <input className="input" style={{ padding: '11px 14px', fontSize: 14 }} placeholder="e.g. Design a landing page for my Web3 app" value={form.title} onChange={e => f('title', e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Description <span style={{ color: 'var(--purple)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— min 20 chars</span></label>
                  <textarea className="input" style={{ padding: '11px 14px', fontSize: 14 }} placeholder="Describe exactly what needs to be delivered. AI validators will use this to verify the work." value={form.description} onChange={e => f('description', e.target.value)} />
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>{form.description.length} chars</p>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Deadline</label>
                  <input className="input" style={{ padding: '11px 14px', fontSize: 14 }} placeholder="2026-07-15" value={form.deadline} onChange={e => f('deadline', e.target.value)} />
                </div>
                <button className="btn-primary" style={{ padding: '12px', fontSize: 15, marginTop: 6 }} onClick={() => setStep(1)} disabled={!valid0}>
                  Next: Freelancer →
                </button>
              </div>
            )}

            {step === 1 && (
              <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="panel" style={{ padding: '14px 16px' }}>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>Job</p>
                  <p className="font-display" style={{ fontSize: 15, fontWeight: 600 }}>{form.title}</p>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Freelancer Wallet Address</label>
                  <input className="input" style={{ padding: '11px 14px', fontSize: 13, fontFamily: 'JetBrains Mono, monospace' }} placeholder="0x..." value={form.freelancer} onChange={e => f('freelancer', e.target.value)} />
                  {form.freelancer.length > 0 && form.freelancer.length !== 42 && <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 5 }}>Must be a 42-character 0x address</p>}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-outline" style={{ padding: '12px', fontSize: 14, flex: 1 }} onClick={() => setStep(0)}>← Back</button>
                  <button className="btn-primary" style={{ padding: '12px', fontSize: 15, flex: 2 }} onClick={() => setStep(2)} disabled={!valid1}>Review →</button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[['Title', form.title], ['Deadline', form.deadline], ['Freelancer', form.freelancer]].map(([label, val]) => (
                  <div key={label} className="panel" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
                    <span style={{ fontSize: 12, color: 'var(--text)', textAlign: 'right', wordBreak: 'break-all', fontFamily: label === 'Freelancer' ? 'JetBrains Mono, monospace' : 'inherit' }}>{val}</span>
                  </div>
                ))}
                <div className="panel" style={{ padding: '12px 16px' }}>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Description</p>
                  <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{form.description.slice(0, 120)}{form.description.length > 120 ? '...' : ''}</p>
                </div>
                {errMsg && <div style={{ padding: '12px 16px', background: 'rgba(255,77,106,0.08)', border: '1px solid rgba(255,77,106,0.25)', borderRadius: 10, fontSize: 13, color: 'var(--red)', wordBreak: 'break-word' }}>{errMsg}</div>}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-outline" style={{ padding: '12px', fontSize: 14, flex: 1 }} onClick={() => setStep(1)} disabled={txStatus === 'submitting'}>← Back</button>
                  <button className="btn-primary" style={{ padding: '12px', fontSize: 15, flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={submit} disabled={txStatus === 'submitting'}>
                    {txStatus === 'submitting' ? <><div className="spinner" />Confirming...</> : '⚡ Post Job'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
