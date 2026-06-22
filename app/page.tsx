'use client'
import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { BottomNav } from '@/components/BottomNav'
import { getStats } from '@/lib/genlayer'
import { formatGEN } from '@/lib/genlayer'
import { usePolling } from '@/hooks/usePolling'
import { ConnectButton } from '@rainbow-me/rainbowkit'

export default function HomePage() {
  const router = useRouter()
  const { isConnected } = useAccount()
  const statsFetcher = useCallback(() => getStats(), [])
  const { data: stats } = usePolling(statsFetcher, 5000)

  return (
    <main style={{ minHeight: '100vh', padding: '80px 20px 120px', maxWidth: 640, margin: '0 auto' }}>

      {/* Hero */}
      <div className="fade-up" style={{ marginBottom: 48, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#10B981,#3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🤝</div>
          <span className="font-display" style={{ fontSize: 20, fontWeight: 700 }}>FreelanceEscrow</span>
        </div>
        <h1 className="font-display" style={{ fontSize: 'clamp(28px,7vw,48px)', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em', marginBottom: 14 }}>
          Get paid for<br />
          <span style={{ background: 'linear-gradient(135deg,#10B981,#3B82F6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>real work.</span>
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 16, lineHeight: 1.7, maxWidth: 460, margin: '0 auto 28px' }}>
          AI-powered freelance escrow on GenLayer. Work gets verified by 5 independent AI validators before payment is released. No middlemen. No disputes.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn-primary" style={{ padding: '13px 28px', fontSize: 15 }} onClick={() => router.push('/post-job')}>
            Post a Job →
          </button>
          <button className="btn-outline" style={{ padding: '13px 24px', fontSize: 15 }} onClick={() => router.push('/my-jobs')}>
            My Jobs
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="card-flat fade-up-d1" style={{ padding: '20px 24px', marginBottom: 28, display: 'flex', justifyContent: 'space-around' }}>
          <div style={{ textAlign: 'center' }}>
            <p className="font-display" style={{ fontSize: 30, fontWeight: 700 }}>{(stats as any).total_jobs || '0'}</p>
            <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Jobs Created</p>
          </div>
          <div style={{ width: 1, background: 'var(--border)' }} />
          <div style={{ textAlign: 'center' }}>
            <p className="font-display" style={{ fontSize: 30, fontWeight: 700 }}>{formatGEN((stats as any).total_paid || '0')}</p>
            <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Total Paid Out</p>
          </div>
          <div style={{ width: 1, background: 'var(--border)' }} />
          <div style={{ textAlign: 'center' }}>
            <p className="font-display" style={{ fontSize: 30, fontWeight: 700 }}>AI</p>
            <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Verified</p>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="fade-up-d2" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 16 }}>How it works</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { step: '01', title: 'Client posts a job', desc: 'Describe the work, set deadline, add freelancer wallet', color: '#3B82F6' },
            { step: '02', title: 'Client locks GEN in escrow', desc: 'Payment is held in the smart contract — not with a middleman', color: '#10B981' },
            { step: '03', title: 'Freelancer submits a URL', desc: 'GitHub repo, deployed app, doc, Figma — any public link', color: '#F59E0B' },
            { step: '04', title: 'AI validates the work', desc: '5 validators fetch the URL and verify it meets the brief', color: '#8B5CF6' },
            { step: '05', title: 'Payment auto-releases', desc: 'Approved → GEN goes to freelancer. Rejected → client refunds', color: '#10B981' },
          ].map(({ step, title, desc, color }) => (
            <div key={step} className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>{step}</span>
              </div>
              <div>
                <p className="font-display" style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{title}</p>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <BottomNav />
    </main>
  )
}
