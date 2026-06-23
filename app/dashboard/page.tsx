'use client'
import { useCallback, useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { StatusBadge } from '@/components/StatusBadge'
import { getProfile, getJobsByClient, getJobsByFreelancer, shortAddress, formatGEN, timeAgo, writeContract } from '@/lib/genlayer'
import { usePolling } from '@/hooks/usePolling'
import { useConnectModal } from '@rainbow-me/rainbowkit'

export default function DashboardPage() {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const router = useRouter()
  const [tab, setTab] = useState<'jobs' | 'profile'>('jobs')
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [editStatus, setEditStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')

  const profileFetcher = useCallback(() => address ? getProfile(address) : Promise.resolve(null), [address])
  const clientFetcher = useCallback(() => address ? getJobsByClient(address) : Promise.resolve([]), [address])
  const freelancerFetcher = useCallback(() => address ? getJobsByFreelancer(address) : Promise.resolve([]), [address])

  const { data: profile, refetch: refetchProfile } = usePolling(profileFetcher, 8000)
  const { data: cJobs, loading: cL } = usePolling(clientFetcher, 5000)
  const { data: fJobs, loading: fL } = usePolling(freelancerFetcher, 5000)

  const p = profile?.found ? profile : null
  const clientJobs = Array.isArray(cJobs) ? cJobs : []
  const freelancerJobs = Array.isArray(fJobs) ? fJobs : []
  const allJobs = p?.role === 'client' ? clientJobs : freelancerJobs
  const loading = p?.role === 'client' ? cL : fL

  useEffect(() => { if (p) setEditForm({ name: p.name, bio: p.bio, skills: p.skills, rate: p.rate, rate_type: p.rate_type, portfolio: p.portfolio, twitter: p.twitter, github: p.github }) }, [p])

  async function saveProfile() {
    if (!address || !p) return
    setEditStatus('saving')
    try {
      await writeContract(address, 'update_profile', [editForm.name, editForm.bio, editForm.skills, editForm.rate, editForm.rate_type, editForm.portfolio, editForm.twitter, editForm.github])
      setEditStatus('done'); setEditMode(false); setTimeout(refetchProfile, 2000)
    } catch (e: any) { setEditStatus('error') }
  }

  const JobRow = ({ job }: { job: any }) => (
    <div className="card" style={{ padding: '13px 17px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }} onClick={() => router.push(`/job/${job.job_id}`)}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: { OPEN:'#8B35FF',FUNDED:'#00D4FF',SUBMITTED:'#FFB830',PAID:'#00E5A0',DISPUTED:'#FF4D6A',REFUNDED:'#8A9BC1',CANCELLED:'#8A9BC1' }[job.status as string] || '#8A9BC1', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="font-display" style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{job.title}</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusBadge status={job.status} />
          {job.created_at && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{timeAgo(job.created_at)}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: BigInt(job.escrow_balance || '0') > 0n ? 'var(--cyan)' : 'var(--muted)' }}>{formatGEN(job.escrow_balance || '0')}</p>
        <p style={{ fontSize: 10, color: 'var(--muted)' }}>→</p>
      </div>
    </div>
  )

  return (
    <AppShell>
      {!isConnected ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <p className="font-display" style={{ fontSize: 20, fontWeight: 700 }}>Connect wallet</p>
          <button className="btn-primary" style={{ padding: '12px 24px' }} onClick={openConnectModal}>Connect</button>
        </div>
      ) : !p ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <p style={{ color: 'var(--muted)', fontSize: 15 }}>No profile found for this wallet.</p>
          <button className="btn-primary" style={{ padding: '11px 24px', fontSize: 14 }} onClick={() => router.push('/register')}>Create Profile →</button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>{shortAddress(address || '')}</p>
            <h1 className="font-display" style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>{p.name}</h1>
            <span className="badge" style={{ color: p.role === 'freelancer' ? 'var(--cyan)' : 'var(--purple)', background: p.role === 'freelancer' ? 'rgba(0,212,255,0.1)' : 'rgba(139,53,255,0.1)', marginTop: 6, display: 'inline-flex' }}>
              {p.role === 'freelancer' ? '💼' : '🏢'} {p.role}
            </span>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 10, padding: 4, marginBottom: 20 }}>
            {(['jobs', 'profile'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 7, cursor: 'pointer', transition: 'all 0.2s', background: tab === t ? 'var(--grad)' : 'transparent', color: tab === t ? 'white' : 'var(--muted)' }}>
                {t === 'jobs' ? `Jobs (${allJobs.length})` : 'Profile'}
              </button>
            ))}
          </div>

          {tab === 'jobs' && (
            <>
              {loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><div className="spinner" /></div>
              : allJobs.length === 0 ? (
                <div className="panel" style={{ padding: '32px 20px', textAlign: 'center' }}>
                  <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 14 }}>No jobs yet.</p>
                  {p.role === 'client' && <button className="btn-primary" style={{ padding: '10px 20px', fontSize: 13 }} onClick={() => router.push('/marketplace')}>Browse Freelancers →</button>}
                </div>
              ) : allJobs.map((j: any) => <JobRow key={j.job_id} job={j} />)}
            </>
          )}

          {tab === 'profile' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {!editMode ? (
                <>
                  {[['Bio', p.bio], ['Skills', p.skills], ['Rate', p.rate ? `${p.rate} GEN / ${p.rate_type}` : ''], ['Portfolio', p.portfolio], ['Twitter', p.twitter], ['GitHub', p.github]].filter(([, v]) => v).map(([label, val]) => (
                    <div key={label as string} className="panel" style={{ padding: '11px 15px', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
                      <span style={{ fontSize: 13, textAlign: 'right', wordBreak: 'break-word' }}>{val as string}</span>
                    </div>
                  ))}
                  <button className="btn-outline" style={{ padding: '10px', fontSize: 13 }} onClick={() => setEditMode(true)}>Edit Profile</button>
                </>
              ) : (
                <>
                  {[
                    { k: 'name', label: 'Name' },
                    { k: 'bio', label: 'Bio', ta: true },
                    ...(p.role === 'freelancer' ? [{ k: 'skills', label: 'Skills' }, { k: 'rate', label: 'Rate (GEN)' }, { k: 'portfolio', label: 'Portfolio' }] : []),
                    { k: 'twitter', label: 'Twitter' },
                    { k: 'github', label: 'GitHub' },
                  ].map(({ k, label, ta }) => (
                    <div key={k}>
                      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</label>
                      {ta ? (
                        <textarea className="input" style={{ padding: '10px 13px', fontSize: 13 }} value={editForm[k] || ''} onChange={e => setEditForm((f: any) => ({ ...f, [k]: e.target.value }))} />
                      ) : (
                        <input className="input" style={{ padding: '10px 13px', fontSize: 13 }} value={editForm[k] || ''} onChange={e => setEditForm((f: any) => ({ ...f, [k]: e.target.value }))} />
                      )}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn-outline" style={{ padding: '10px', flex: 1 }} onClick={() => setEditMode(false)}>Cancel</button>
                    <button className="btn-primary" style={{ padding: '10px', flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={saveProfile} disabled={editStatus === 'saving'}>
                      {editStatus === 'saving' ? <><div className="spinner" />Saving...</> : 'Save Changes'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}
