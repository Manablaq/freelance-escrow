'use client'
import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { TopNav } from '@/components/TopNav'
import { getStats, formatGEN } from '@/lib/genlayer'
import { usePolling } from '@/hooks/usePolling'

const Mochi = dynamic(() => import('@/components/Mochi').then(m => ({ default: m.Mochi })), { ssr: false })

export default function HomePage() {
  const router = useRouter()
  const fetcher = useCallback(() => getStats(), [])
  const { data: stats } = usePolling(fetcher, 5000)
  const s = stats as any

  return (
    <>
      <TopNav />
      {/* Atmospheric orbs */}
      <div className="orb-orange" />
      <div className="orb-purple" />

      <div className="page" style={{ paddingBottom: 80 }}>
        <div className="inner" style={{ paddingTop: 60 }}>
          {/* Hero grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, alignItems: 'center', minHeight: '80vh' }}>

            {/* Left: text */}
            <div style={{ position: 'relative', zIndex: 1 }}>
              {/* Live badge */}
              <div className="fade-up" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 24, padding: '5px 14px', background: 'rgba(123,91,255,0.1)', border: '1px solid rgba(123,91,255,0.25)', borderRadius: 999 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 8px var(--green)', display: 'inline-block' }} />
                <span style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em' }}>LIVE ON GENLAYER BRADBURY</span>
              </div>

              {/* Headline */}
              <h1 className="font-display fade-up-d1" style={{ fontSize: 'clamp(36px,5vw,64px)', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.03em', marginBottom: 24 }}>
                Hire. Work.<br />
                <span className="glow-text">Get Paid.</span>
              </h1>

              <p className="fade-up-d2" style={{ fontSize: 16, lineHeight: 1.8, color: 'var(--muted)', marginBottom: 32, maxWidth: 420 }}>
                AI-powered freelance marketplace on GenLayer. 5 independent validators verify your work. Payment auto-releases on approval. No middlemen.
              </p>

              {/* CTAs */}
              <div className="fade-up-d3" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 48 }}>
                <button className="btn-orange" style={{ padding: '13px 28px', fontSize: 15 }} onClick={() => router.push('/marketplace')}>
                  Browse Freelancers →
                </button>
                <button className="btn-glass" style={{ padding: '13px 24px', fontSize: 15 }} onClick={() => router.push('/register')}>
                  Create Profile
                </button>
              </div>

              {/* Stats row — FXIFY style */}
              <div className="fade-up-d4" style={{ display: 'flex', gap: 40, borderTop: '1px solid var(--border2)', paddingTop: 32, flexWrap: 'wrap' }}>
                {[
                  { val: s?.total_freelancers || '0', label: 'freelancers' },
                  { val: s?.total_jobs || '0', label: 'jobs posted' },
                  { val: formatGEN(s?.total_paid || '0'), label: 'paid out' },
                  { val: 'AI', label: 'verified' },
                ].map(({ val, label }) => (
                  <div key={label}>
                    <p className="font-display" style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>{val}</p>
                    <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.05em' }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Mochi visual */}
            <div className="fade-up-d2" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
              {/* Glow ring behind mochi */}
              <div style={{ position: 'absolute', width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(123,91,255,0.15) 0%, rgba(255,123,53,0.08) 50%, transparent 70%)', zIndex: 0 }} />
              <div style={{ position: 'absolute', width: 280, height: 280, borderRadius: '50%', border: '1px solid rgba(123,91,255,0.15)', zIndex: 0 }} />
              <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', border: '1px solid rgba(255,123,53,0.1)', zIndex: 0 }} />

              {/* Mochi */}
              <div style={{ position: 'relative', zIndex: 1 }}>
                <Mochi size={240} />
              </div>

              {/* Floating stat cards — FXIFY-style */}
              <div style={{ position: 'absolute', top: '10%', right: '-5%', background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', backdropFilter: 'blur(12px)', zIndex: 2, minWidth: 120 }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--green)' }} className="font-display">{s?.total_jobs || '0'}</p>
                <p style={{ fontSize: 11, color: 'var(--muted)' }}>Jobs Created</p>
              </div>

              <div style={{ position: 'absolute', bottom: '15%', left: '-5%', background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', backdropFilter: 'blur(12px)', zIndex: 2, minWidth: 130 }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--orange)' }} className="font-display">{s?.total_freelancers || '0'}</p>
                <p style={{ fontSize: 11, color: 'var(--muted)' }}>Freelancers</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom padding */}
      <div style={{ height: 80 }} className="mobile-spacer" />
    </>
  )
}
