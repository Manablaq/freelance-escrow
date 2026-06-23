'use client'
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopNav } from '@/components/TopNav'
import { getAllFreelancers, shortAddress } from '@/lib/genlayer'
import { usePolling } from '@/hooks/usePolling'

export default function MarketplacePage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const fetcher = useCallback(() => getAllFreelancers(), [])
  const { data, loading } = usePolling(fetcher, 10000)
  const freelancers = Array.isArray(data) ? data : []
  const filtered = freelancers.filter(f => !search || [f.name, f.skills, f.bio].join(' ').toLowerCase().includes(search.toLowerCase()))

  return (
    <>
      <TopNav />
      <div className="orb-orange" style={{ opacity: 0.5 }} />
      <div className="orb-purple" style={{ opacity: 0.5 }} />

      <div className="page" style={{ paddingBottom: 100 }}>
        <div className="inner" style={{ paddingTop: 48 }}>

          {/* Header */}
          <div className="fade-up" style={{ marginBottom: 40 }}>
            <p style={{ fontSize: 11, color: 'var(--purple2)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em', marginBottom: 8 }}>0.2 / MARKETPLACE</p>
            <h1 className="font-display" style={{ fontSize: 'clamp(28px,5vw,48px)', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 10 }}>
              Find Your <span className="glow-text">Freelancer</span>
            </h1>
            <p style={{ color: 'var(--muted)', fontSize: 15 }}>Browse verified freelancers. AI verifies every delivery.</p>
          </div>

          {/* Search */}
          <div className="fade-up-d1" style={{ position: 'relative', marginBottom: 32, maxWidth: 440 }}>
            <input className="input" style={{ padding: '12px 16px 12px 42px', fontSize: 14 }} placeholder="Search by name, skill..." value={search} onChange={e => setSearch(e.target.value)} />
            <svg style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>

          {/* Grid */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ padding: '60px 24px', textAlign: 'center', maxWidth: 400 }}>
              <p style={{ fontSize: 40, marginBottom: 12 }}>🔍</p>
              <p style={{ color: 'var(--muted)', marginBottom: 16 }}>{search ? `No results for "${search}"` : 'No freelancers yet. Be the first!'}</p>
              {!search && <button className="btn-primary" style={{ padding: '10px 22px', fontSize: 14 }} onClick={() => router.push('/register')}>Register as Freelancer</button>}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {filtered.map((fl: any, i: number) => (
                <div key={i} className="card fade-up" style={{ padding: '22px', cursor: 'pointer', animationDelay: `${i * 0.05}s` }} onClick={() => router.push(`/freelancer/${fl.address}`)}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, color: 'white', flexShrink: 0 }}>
                      {(fl.name?.[0] || '?').toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p className="font-display" style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fl.name}</p>
                      <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>{shortAddress(fl.address)}</p>
                    </div>
                  </div>

                  {/* Bio */}
                  {fl.bio && <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{fl.bio}</p>}

                  {/* Skills */}
                  {fl.skills && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                      {fl.skills.split(',').slice(0, 3).map((s: string) => (
                        <span key={s} style={{ fontSize: 10, padding: '3px 8px', background: 'rgba(123,91,255,0.15)', color: 'var(--purple2)', borderRadius: 5, fontWeight: 600 }}>{s.trim()}</span>
                      ))}
                    </div>
                  )}

                  {/* Rate + hire */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {fl.rate && <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--orange)' }}>{fl.rate} GEN <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>/ {fl.rate_type}</span></p>}
                    <button className="btn-primary" style={{ padding: '7px 16px', fontSize: 12 }} onClick={e => { e.stopPropagation(); router.push(`/freelancer/${fl.address}`) }}>
                      Hire →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
