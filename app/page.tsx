'use client'
import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { AppShell } from '@/components/AppShell'
import { getStats, formatGEN } from '@/lib/genlayer'
import { usePolling } from '@/hooks/usePolling'

const Mochi = dynamic(() => import('@/components/Mochi').then(m => ({ default: m.Mochi })), { ssr: false })

export default function HomePage() {
  const router = useRouter()
  const fetcher = useCallback(() => getStats(), [])
  const { data: stats } = usePolling(fetcher, 5000)
  const s = stats as any

  return (
    <AppShell>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '20px 0' }}>

        <div className="fade-in" style={{ position: 'relative', marginBottom: 20 }}>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,53,255,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <Mochi size={150} />
        </div>

        <div className="fade-in" style={{ animationDelay: '0.1s' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 12, padding: '3px 11px', background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.2)', borderRadius: 999 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 5px var(--green)', display: 'inline-block' }} />
            <span style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>LIVE · GENLAYER BRADBURY</span>
          </div>
          <h1 className="font-display" style={{ fontSize: 'clamp(24px,5vw,40px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 10 }}>
            Hire. Work. <span className="glow-text">Get Paid.</span>
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7, maxWidth: 380, margin: '0 auto 24px' }}>
            AI validators verify deliverables on-chain. Clients and freelancers — no middlemen, no disputes.
          </p>
        </div>

        <div className="fade-in" style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 28, animationDelay: '0.15s' }}>
          <button className="btn-primary" style={{ padding: '11px 24px', fontSize: 14 }} onClick={() => router.push('/marketplace')}>Browse Freelancers →</button>
          <button className="btn-outline" style={{ padding: '11px 20px', fontSize: 14 }} onClick={() => router.push('/register')}>Create Profile</button>
        </div>

        {s && (
          <div className="panel fade-in" style={{ padding: '14px 24px', display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center', animationDelay: '0.2s' }}>
            {[
              { val: s.total_freelancers || '0', label: 'Freelancers' },
              { val: s.total_jobs || '0', label: 'Jobs' },
              { val: formatGEN(s.total_paid || '0'), label: 'Paid Out' },
            ].map(({ val, label }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <p className="font-display glow-text" style={{ fontSize: 20, fontWeight: 800 }}>{val}</p>
                <p style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
