'use client'
import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { TopNav } from '@/components/TopNav'
import { getProfile, shortAddress, formatGEN } from '@/lib/genlayer'
import { usePolling } from '@/hooks/usePolling'

export default function FreelancerPage() {
  const { address: freelancerAddr } = useParams<{ address: string }>()
  const router = useRouter()
  const { address: myAddress } = useAccount()
  const fetcher = useCallback(() => getProfile(freelancerAddr), [freelancerAddr])
  const { data: profile, loading } = usePolling(fetcher, 10000)

  const isMe = myAddress?.toLowerCase() === freelancerAddr?.toLowerCase()

  if (loading) return <>
      <TopNav />
      <div className="orb-orange" style={{ opacity: 0.35 }} />
      <div className="orb-purple" style={{ opacity: 0.35 }} />
      <div className="page" style={{ paddingBottom: 100 }}>
        <div className="inner" style={{ paddingTop: 40 }}><div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>        </div>
      </div>
    </>
  if (!profile?.found || profile?.role !== 'freelancer') return (
    <>
      <TopNav />
      <div className="orb-orange" style={{ opacity: 0.35 }} />
      <div className="orb-purple" style={{ opacity: 0.35 }} />
      <div className="page" style={{ paddingBottom: 100 }}>
        <div className="inner" style={{ paddingTop: 40 }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <p style={{ color: 'var(--muted)', marginBottom: 16 }}>Freelancer not found.</p>
        <button className="btn-outline" style={{ padding: '9px 18px', fontSize: 13 }} onClick={() => router.push('/marketplace')}>← Back to Marketplace</button>
      </div>
            </div>
      </div>
    </>
  )

  const skills = profile.skills ? profile.skills.split(',').map((s: string) => s.trim()).filter(Boolean) : []
  const totalEarned = formatGEN(profile.total_earned || '0')

  return (
    <>
      <TopNav />
      <div className="orb-orange" style={{ opacity: 0.35 }} />
      <div className="orb-purple" style={{ opacity: 0.35 }} />
      <div className="page" style={{ paddingBottom: 100 }}>
        <div className="inner" style={{ paddingTop: 40 }}>
      <div style={{ maxWidth: 540 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 5 }}>← Back</button>

        {/* Profile header */}
        <div className="card fade-in" style={{ padding: '24px 22px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, color: 'white', flexShrink: 0, boxShadow: 'var(--gp)' }}>
              {(profile.name?.[0] || '?').toUpperCase()}
            </div>
            <div>
              <h1 className="font-display" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', marginBottom: 4 }}>{profile.name}</h1>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="address-chip">{shortAddress(profile.address || freelancerAddr)}</span>
                <span className="badge" style={{ color: 'var(--cyan)', background: 'rgba(0,212,255,0.1)' }}>💼 Freelancer</span>
              </div>
            </div>
          </div>

          {profile.bio && <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 14 }}>{profile.bio}</p>}

          {/* Links */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {profile.portfolio && <a href={profile.portfolio} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--purple)', textDecoration: 'none' }}>🔗 Portfolio</a>}
            {profile.twitter && <a href={`https://x.com/${profile.twitter.replace('@', '')}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--purple)', textDecoration: 'none' }}>𝕏 {profile.twitter}</a>}
            {profile.github && <a href={`https://github.com/${profile.github}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--purple)', textDecoration: 'none' }}>⌥ {profile.github}</a>}
          </div>
        </div>

        {/* Skills */}
        {skills.length > 0 && (
          <div className="panel fade-in" style={{ padding: '16px 20px', marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Skills</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {skills.map((s: string) => (
                <span key={s} style={{ fontSize: 12, padding: '4px 10px', background: 'rgba(139,53,255,0.12)', color: 'var(--purple)', borderRadius: 7, fontWeight: 600 }}>{s}</span>
              ))}
            </div>
          </div>
        )}

        {/* Rate + Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          {[
            { val: `${profile.rate || '0'} GEN`, label: `per ${profile.rate_type || 'job'}`, color: 'var(--cyan)' },
            { val: profile.jobs_completed || '0', label: 'jobs done', color: 'var(--green)' },
            { val: totalEarned, label: 'total earned', color: 'var(--purple)' },
          ].map(({ val, label, color }) => (
            <div key={label} className="panel" style={{ padding: '14px 16px', textAlign: 'center' }}>
              <p className="font-display" style={{ fontSize: 16, fontWeight: 800, color, marginBottom: 2 }}>{val}</p>
              <p style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Hire button */}
        {!isMe && (
          <button className="btn-primary" style={{ padding: '14px', fontSize: 16, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={() => router.push(`/post-job?freelancer=${profile.address || freelancerAddr}&name=${encodeURIComponent(profile.name || '')}`)}>
            ⚡ Hire {profile.name} →
          </button>
        )}

        {isMe && (
          <button className="btn-outline" style={{ padding: '12px', fontSize: 14, width: '100%' }} onClick={() => router.push('/dashboard')}>
            Edit Profile in Dashboard
          </button>
        )}
      </div>
            </div>
      </div>
    </>
  )
}
