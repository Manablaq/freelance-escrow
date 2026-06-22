'use client'
import { useCallback, useState } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { StatusBadge } from '@/components/StatusBadge'
import { getJobsByClient, getJobsByFreelancer, shortAddress, formatGEN, timeAgo } from '@/lib/genlayer'
import { usePolling } from '@/hooks/usePolling'
import { useConnectModal } from '@rainbow-me/rainbowkit'

export default function DashboardPage() {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const router = useRouter()
  const [tab, setTab] = useState<'client' | 'freelancer'>('client')

  const cf = useCallback(() => address ? getJobsByClient(address) : Promise.resolve([]), [address])
  const ff = useCallback(() => address ? getJobsByFreelancer(address) : Promise.resolve([]), [address])
  const { data: cJobs, loading: cL } = usePolling(cf, 5000)
  const { data: fJobs, loading: fL } = usePolling(ff, 5000)

  const client = Array.isArray(cJobs) ? cJobs : []
  const freelancer = Array.isArray(fJobs) ? fJobs : []
  const active = tab === 'client' ? client : freelancer
  const loading = tab === 'client' ? cL : fL

  const JobRow = ({ job }: { job: any }) => {
    const hasBalance = BigInt(job.escrow_balance || '0') > 0n
    return (
      <div className="card" style={{ padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }} onClick={() => router.push(`/job/${job.job_id}`)}>
        {/* Status dot */}
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: { OPEN:'#8B35FF', FUNDED:'#00D4FF', SUBMITTED:'#FFB830', PAID:'#00E5A0', DISPUTED:'#FF4D6A', REFUNDED:'#8A9BC1', CANCELLED:'#8A9BC1' }[job.status] || '#8A9BC1', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="font-display" style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title}</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge status={job.status} />
            {job.created_at && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{timeAgo(job.created_at)}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: hasBalance ? 'var(--cyan)' : 'var(--muted)' }}>{formatGEN(job.escrow_balance || '0')}</p>
          <p style={{ fontSize: 11, color: 'var(--muted)' }}>→</p>
        </div>
      </div>
    )
  }

  return (
    <AppShell>
      {!isConnected ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <p className="font-display" style={{ fontSize: 20, fontWeight: 700 }}>Connect to view dashboard</p>
          <button className="btn-primary" style={{ padding: '12px 24px', fontSize: 15 }} onClick={openConnectModal}>Connect Wallet</button>
        </div>
      ) : (
        <div>
          {/* Header */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4, letterSpacing: '0.08em' }}>{shortAddress(address || '')}</p>
            <h1 className="font-display" style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>Dashboard</h1>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 10, padding: 4 }}>
            {(['client', 'freelancer'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '9px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s', background: tab === t ? 'var(--grad)' : 'transparent', color: tab === t ? 'white' : 'var(--muted)' }}>
                {t === 'client' ? `Posted (${client.length})` : `Assigned (${freelancer.length})`}
              </button>
            ))}
          </div>

          {/* Jobs list */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>
          ) : active.length === 0 ? (
            <div className="panel" style={{ padding: '36px 24px', textAlign: 'center' }}>
              <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: tab === 'client' ? 16 : 0 }}>
                {tab === 'client' ? 'No jobs posted yet.' : 'No jobs assigned to this wallet.'}
              </p>
              {tab === 'client' && (
                <button className="btn-primary" style={{ padding: '10px 22px', fontSize: 14 }} onClick={() => router.push('/post-job')}>Post a Job →</button>
              )}
            </div>
          ) : (
            <div>{active.map((j: any) => <JobRow key={j.job_id} job={j} />)}</div>
          )}
        </div>
      )}
    </AppShell>
  )
}
