'use client'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { BottomNav } from '@/components/BottomNav'
import { writeContract } from '@/lib/genlayer'
import { ConnectButton } from '@rainbow-me/rainbowkit'

export default function PostJobPage() {
  const { address, isConnected } = useAccount()
  const router = useRouter()
  const [form, setForm] = useState({ title: '', description: '', freelancer: '', deadline: '' })
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')

  async function handleSubmit() {
    if (!address) return
    setStatus('submitting')
    setErrMsg('')
    try {
      await writeContract(address, 'create_job', [form.title, form.description, form.freelancer, form.deadline])
      setStatus('done')
      setTimeout(() => router.push('/my-jobs'), 1500)
    } catch (e: any) {
      setStatus('error')
      setErrMsg((e?.message || String(e)).slice(0, 200))
    }
  }

  const valid = form.title.length >= 3 && form.description.length >= 20 && form.freelancer.length === 42 && form.freelancer.startsWith('0x') && form.deadline.length > 0

  if (!isConnected) return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }}>
      <p className="font-display" style={{ fontSize: 20, fontWeight: 700 }}>Connect wallet to post a job</p>
      <ConnectButton />
      <BottomNav />
    </main>
  )

  return (
    <main style={{ minHeight: '100vh', padding: '80px 20px 120px', maxWidth: 560, margin: '0 auto' }}>
      <div className="fade-up" style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>New Job</p>
        <h1 className="font-display" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>Post a Job</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>Describe the work clearly — AI validators will use this to verify the deliverable.</p>
      </div>

      {status === 'done' ? (
        <div className="card-flat fade-up" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 48, marginBottom: 12 }}>✅</p>
          <p className="font-display" style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Job posted!</p>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Redirecting to My Jobs...</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { key: 'title', label: 'Job Title', placeholder: 'e.g. Build a landing page for my Web3 startup', type: 'text' },
            { key: 'freelancer', label: 'Freelancer Wallet Address', placeholder: '0x...', type: 'text' },
            { key: 'deadline', label: 'Deadline', placeholder: 'e.g. 2026-07-15', type: 'text' },
          ].map(({ key, label, placeholder, type }) => (
            <div key={key} className="card-flat fade-up" style={{ padding: '16px 18px' }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 8, fontWeight: 500 }}>{label}</label>
              <input
                className="input"
                style={{ padding: '10px 14px', fontSize: 14 }}
                type={type}
                placeholder={placeholder}
                value={form[key as keyof typeof form]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                disabled={status === 'submitting'}
              />
            </div>
          ))}

          <div className="card-flat fade-up" style={{ padding: '16px 18px' }}>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 8, fontWeight: 500 }}>
              Job Description <span style={{ color: 'var(--muted)' }}>(min 20 characters)</span>
            </label>
            <textarea
              className="input"
              style={{ padding: '10px 14px', fontSize: 14, minHeight: 120 }}
              placeholder="Describe exactly what needs to be delivered. Be specific — the AI will verify the work against this description."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              disabled={status === 'submitting'}
            />
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{form.description.length} / 1000 chars</p>
          </div>

          {errMsg && (
            <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, fontSize: 13, color: 'var(--red)', wordBreak: 'break-word' }}>
              {errMsg}
            </div>
          )}

          <button
            className="btn-primary fade-up"
            style={{ padding: '14px', fontSize: 16, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={handleSubmit}
            disabled={!valid || status === 'submitting'}
          >
            {status === 'submitting' ? <><div className="spinner" />Confirm in wallet...</> : 'Post Job →'}
          </button>

          <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
            After posting, you'll fund the escrow separately. The freelancer won't see payment until work is verified.
          </p>
        </div>
      )}

      <BottomNav />
    </main>
  )
}
