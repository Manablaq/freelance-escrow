'use client'
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { getAllFreelancers, shortAddress, formatGEN } from '@/lib/genlayer'
import { usePolling } from '@/hooks/usePolling'

export default function MarketplacePage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const fetcher = useCallback(() => getAllFreelancers(), [])
  const { data, loading } = usePolling(fetcher, 10000)
  const freelancers = Array.isArray(data) ? data : []

  const filtered = freelancers.filter(f => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      f.name?.toLowerCase().includes(q) ||
      f.skills?.toLowerCase().includes(q) ||
      f.bio?.toLowerCase().includes(q)
    )
  })

  return (
    <AppShell>
      <div>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 }}>Marketplace</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Browse verified freelancers. Click Hire to create a job with them.</p>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <input
            className="input"
            style={{ padding: '10px 14px 10px 38px', fontSize: 14 }}
            placeholder="Search by name, skill..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </div>

        {/* Count */}
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          {loading ? 'Loading...' : `${filtered.length} freelancer${filtered.length !== 1 ? 's' : ''} found`}
        </p>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" style={{ width: 32, height: 32 }} /></div>
        ) : filtered.length === 0 ? (
          <div className="panel" style={{ padding: '40px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>🔍</p>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>
              {search ? `No freelancers match "${search}"` : 'No freelancers registered yet. Be the first!'}
            </p>
            {!search && <button className="btn-primary" style={{ padding: '10px 22px', fontSize: 14, marginTop: 16 }} onClick={() => router.push('/register')}>Register as Freelancer</button>}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {filtered.map((fl: any, i: number) => (
              <div key={i} className="card" style={{ padding: '18px 20px', cursor: 'pointer' }} onClick={() => router.push(`/freelancer/${fl.address}`)}>
                {/* Avatar + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, color: 'white' }}>
                    {(fl.name?.[0] || '?').toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p className="font-display" style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fl.name}</p>
                    <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>{shortAddress(fl.address)}</p>
                  </div>
                </div>

                {/* Bio */}
                {fl.bio && <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 10, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{fl.bio}</p>}

                {/* Skills */}
                {fl.skills && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
                    {fl.skills.split(',').slice(0, 3).map((s: string) => (
                      <span key={s} style={{ fontSize: 10, padding: '2px 7px', background: 'rgba(139,53,255,0.12)', color: 'var(--purple)', borderRadius: 5, fontWeight: 600 }}>
                        {s.trim()}
                      </span>
                    ))}
                    {fl.skills.split(',').length > 3 && <span style={{ fontSize: 10, color: 'var(--muted)' }}>+{fl.skills.split(',').length - 3}</span>}
                  </div>
                )}

                {/* Rate + stats */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    {fl.rate && <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--cyan)' }}>{fl.rate} GEN <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>/ {fl.rate_type}</span></p>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 11, color: 'var(--muted)' }}>{fl.jobs_completed || '0'} jobs</p>
                  </div>
                </div>

                {/* Hire button */}
                <button className="btn-primary" style={{ padding: '9px', fontSize: 13, width: '100%', marginTop: 12 }} onClick={e => { e.stopPropagation(); router.push(`/freelancer/${fl.address}`) }}>
                  View & Hire →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
