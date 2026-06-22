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
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 0, padding: '20px 0' }}>

        {/* Mochi mascot */}
        <div className="fade-in" style={{ position: 'relative', marginBottom: 24 }}>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,53,255,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,212,255,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <Mochi size={160} />
        </div>

        {/* Tagline */}
        <div className="fade-in" style={{ animationDelay: '0.1s' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 14, padding: '4px 12px', background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.2)', borderRadius: 999 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 5px var(--green)', display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>LIVE · GENLAYER BRADBURY</span>
          </div>
          <h1 className="font-display" style={{ fontSize: 'clamp(26px,5vw,42px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 12 }}>
            Work. Submit. <span className="glow-text">Get Paid.</span>
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 15, lineHeight: 1.7, maxWidth: 400, margin: '0 auto 28px' }}>
            AI validators verify your deliverable on-chain. No middlemen. No disputes. Payment releases automatically.
          </p>
        </div>

        {/* CTAs */}
        <div className="fade-in" style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 32, animationDelay: '0.2s' }}>
          <button className="btn-primary" style={{ padding: '12px 26px', fontSize: 15 }} onClick={() => router.push('/post-job')}>
            Post a Job →
          </button>
          <button className="btn-outline" style={{ padding: '12px 22px', fontSize: 15 }} onClick={() => router.push('/dashboard')}>
            My Dashboard
          </button>
        </div>

        {/* Stats */}
        {s && (
          <div className="panel fade-in" style={{ padding: '16px 28px', display: 'flex', gap: 28, animationDelay: '0.3s', flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              { val: s.total_jobs || '0', label: 'Jobs' },
              { val: formatGEN(s.total_paid || '0'), label: 'Paid Out' },
              { val: '5', label: 'AI Validators' },
            ].map(({ val, label }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <p className="font-display glow-text" style={{ fontSize: 22, fontWeight: 800 }}>{val}</p>
                <p style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
