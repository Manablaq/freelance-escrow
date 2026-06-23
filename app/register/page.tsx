'use client'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { writeContract } from '@/lib/genlayer'
import { useConnectModal } from '@rainbow-me/rainbowkit'

export default function RegisterPage() {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const router = useRouter()
  const [role, setRole] = useState<'freelancer' | 'client' | null>(null)
  const [form, setForm] = useState({ name: '', bio: '', skills: '', rate: '', rate_type: 'fixed', portfolio: '', twitter: '', github: '' })
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))
  const valid = form.name.length >= 2 && (role === 'client' || (form.skills.length > 0 && form.rate.length > 0))

  async function handleRegister() {
    if (!address || !role) return
    setStatus('submitting'); setErrMsg('')
    try {
      await writeContract(address, 'register', [role, form.name, form.bio, form.skills, form.rate, form.rate_type, form.portfolio, form.twitter, form.github])
      setStatus('done')
      setTimeout(() => router.push(role === 'freelancer' ? '/dashboard' : '/marketplace'), 1500)
    } catch (e: any) {
      setStatus('error')
      setErrMsg((e?.message || String(e)).slice(0, 200))
    }
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 }}>Create Profile</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Choose your role to get started on FreelanceMarket.</p>
        </div>

        {!isConnected ? (
          <div className="panel" style={{ padding: '36px 24px', textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', marginBottom: 16 }}>Connect your wallet to register</p>
            <button className="btn-primary" style={{ padding: '11px 24px', fontSize: 14 }} onClick={openConnectModal}>Connect Wallet</button>
          </div>
        ) : status === 'done' ? (
          <div className="panel" style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <p className="font-display" style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Profile created!</p>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Redirecting...</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Role selection */}
            {!role ? (
              <div style={{ display: 'flex', gap: 12 }}>
                {[
                  { r: 'client' as const, label: 'Client', desc: 'Hire freelancers and manage projects', icon: '🏢' },
                  { r: 'freelancer' as const, label: 'Freelancer', desc: 'Offer services and get paid in GEN', icon: '💼' },
                ].map(({ r, label, desc, icon }) => (
                  <div key={r} className="card" style={{ flex: 1, padding: '20px 16px', cursor: 'pointer', textAlign: 'center', borderColor: 'var(--border2)' }} onClick={() => setRole(r)}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
                    <p className="font-display" style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{label}</p>
                    <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{desc}</p>
                    <div style={{ marginTop: 14, padding: '8px', background: 'var(--grad)', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'white' }}>
                      Join as {label}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Role badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>Registering as</span>
                  <span className="badge" style={{ color: role === 'freelancer' ? 'var(--cyan)' : 'var(--purple)', background: role === 'freelancer' ? 'rgba(0,212,255,0.12)' : 'rgba(139,53,255,0.12)', fontSize: 12 }}>
                    {role === 'freelancer' ? '💼' : '🏢'} {role}
                  </span>
                  <button onClick={() => setRole(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>change</button>
                </div>

                {/* Common fields */}
                {[
                  { k: 'name', label: 'Display Name *', ph: 'Your name or alias', req: true },
                  { k: 'bio', label: 'Bio', ph: role === 'freelancer' ? 'Experienced frontend developer...' : 'Building the next big thing...', req: false },
                ].map(({ k, label, ph }) => (
                  <div key={k}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</label>
                    <input className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder={ph} value={form[k as keyof typeof form]} onChange={e => f(k, e.target.value)} />
                  </div>
                ))}

                {/* Freelancer-only fields */}
                {role === 'freelancer' && (
                  <>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Skills * <span style={{ color: 'var(--cyan)', fontWeight: 400, textTransform: 'none' }}>comma separated</span></label>
                      <input className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder="UI Design, React, Web3, Motion Design" value={form.skills} onChange={e => f('skills', e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ flex: 2 }}>
                        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Rate (GEN) *</label>
                        <input className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder="5" type="number" value={form.rate} onChange={e => f('rate', e.target.value)} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Type</label>
                        <select className="input" style={{ padding: '10px 13px', fontSize: 14 }} value={form.rate_type} onChange={e => f('rate_type', e.target.value)}>
                          <option value="fixed">Fixed</option>
                          <option value="hourly">Hourly</option>
                        </select>
                      </div>
                    </div>
                    {[
                      { k: 'portfolio', label: 'Portfolio URL', ph: 'https://yoursite.com' },
                      { k: 'twitter', label: 'Twitter/X', ph: '@yourhandle' },
                      { k: 'github', label: 'GitHub', ph: 'username' },
                    ].map(({ k, label, ph }) => (
                      <div key={k}>
                        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</label>
                        <input className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder={ph} value={form[k as keyof typeof form]} onChange={e => f(k, e.target.value)} />
                      </div>
                    ))}
                  </>
                )}

                {errMsg && <div style={{ padding: '12px 16px', background: 'rgba(255,77,106,0.08)', border: '1px solid rgba(255,77,106,0.25)', borderRadius: 10, fontSize: 13, color: 'var(--red)', wordBreak: 'break-word' }}>{errMsg}</div>}

                <button className="btn-primary" style={{ padding: '13px', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={handleRegister} disabled={!valid || status === 'submitting'}>
                  {status === 'submitting' ? <><div className="spinner" />Confirming...</> : 'Create Profile →'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
