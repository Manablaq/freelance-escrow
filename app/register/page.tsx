'use client'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { TopNav } from '@/components/TopNav'
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setStatus('error'); setErrMsg(message.slice(0, 200))
    }
  }

  return (
    <>
      <TopNav />
      <div className="orb-purple" style={{ opacity: 0.6 }} />

      <div className="page" style={{ paddingBottom: 100 }}>
        <div className="inner" style={{ paddingTop: 48, maxWidth: 560 }}>
          <div className="fade-up" style={{ marginBottom: 32 }}>
            <p style={{ fontSize: 11, color: 'var(--purple2)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em', marginBottom: 8 }}>GET STARTED</p>
            <h1 className="font-display" style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>Create Profile</h1>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>Choose your role to join FreelanceMarket.</p>
          </div>

          {!isConnected ? (
            <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
              <p style={{ color: 'var(--muted)', marginBottom: 20, fontSize: 15 }}>Connect your wallet to register</p>
              <button className="btn-primary" style={{ padding: '12px 28px', fontSize: 15 }} onClick={openConnectModal}>Connect Wallet</button>
            </div>
          ) : status === 'done' ? (
            <div className="card" style={{ padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>🎉</div>
              <p className="font-display" style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Profile created!</p>
              <p style={{ color: 'var(--muted)' }}>Redirecting...</p>
            </div>
          ) : !role ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[
                { r: 'client' as const, icon: '🏢', title: 'Client', desc: 'Post jobs, hire freelancers, manage escrow' },
                { r: 'freelancer' as const, icon: '💼', title: 'Freelancer', desc: 'List services, get hired, get paid in GEN' },
              ].map(({ r, icon, title, desc }) => (
                <div key={r} className="card" style={{ padding: '28px 20px', cursor: 'pointer', textAlign: 'center' }} onClick={() => setRole(r)}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
                  <p className="font-display" style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{title}</p>
                  <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>{desc}</p>
                  <div style={{ padding: '9px', background: 'var(--grad)', borderRadius: 9, fontSize: 13, fontWeight: 600, color: 'white', fontFamily: 'Space Grotesk, sans-serif' }}>Join as {title}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card fade-up" style={{ padding: '28px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                <span style={{ fontSize: 14, color: 'var(--muted)' }}>Role:</span>
                <span className="badge" style={{ color: role === 'freelancer' ? 'var(--orange)' : 'var(--purple2)', background: role === 'freelancer' ? 'rgba(255,123,53,0.12)' : 'rgba(123,91,255,0.12)' }}>
                  {role === 'freelancer' ? '💼' : '🏢'} {role}
                </span>
                <button onClick={() => setRole(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>change</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[{ k: 'name', l: 'Display Name *', ph: 'Your name' }, { k: 'bio', l: 'Bio', ph: 'Brief intro...' }].map(({ k, l, ph }) => (
                  <div key={k}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{l}</label>
                    <input className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder={ph} value={form[k as keyof typeof form]} onChange={e => f(k, e.target.value)} />
                  </div>
                ))}

                {role === 'freelancer' && <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Skills * <span style={{ color: 'var(--orange)', fontWeight: 400, textTransform: 'none' }}>comma separated</span></label>
                    <input className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder="React, Node.js, Web3..." value={form.skills} onChange={e => f('skills', e.target.value)} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Rate (GEN) *</label>
                      <input className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder="5" type="number" value={form.rate} onChange={e => f('rate', e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Type</label>
                      <select className="input" style={{ padding: '10px 13px', fontSize: 14 }} value={form.rate_type} onChange={e => f('rate_type', e.target.value)}>
                        <option value="fixed">Fixed</option>
                        <option value="hourly">Hourly</option>
                      </select>
                    </div>
                  </div>
                  {[{ k: 'portfolio', ph: 'https://yoursite.com' }, { k: 'twitter', ph: '@handle' }, { k: 'github', ph: 'username' }].map(({ k, ph }) => (
                    <div key={k}>
                      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{k}</label>
                      <input className="input" style={{ padding: '10px 13px', fontSize: 14 }} placeholder={ph} value={form[k as keyof typeof form]} onChange={e => f(k, e.target.value)} />
                    </div>
                  ))}
                </>}

                {errMsg && <div style={{ padding: '12px 16px', background: 'rgba(255,77,106,0.1)', border: '1px solid rgba(255,77,106,0.25)', borderRadius: 10, fontSize: 13, color: 'var(--red)' }}>{errMsg}</div>}

                <button className="btn-orange" style={{ padding: '13px', fontSize: 16, justifyContent: 'center' }} onClick={handleRegister} disabled={!valid || status === 'submitting'}>
                  {status === 'submitting' ? <><div className="spinner" />Confirming...</> : 'Create Profile →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
