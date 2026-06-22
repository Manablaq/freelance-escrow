'use client'
import { useCallback } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { BottomNav } from '@/components/BottomNav'
import { StatusBadge } from '@/components/StatusBadge'
import { getJobsByClient, getJobsByFreelancer, shortAddress, formatGEN, timeAgo } from '@/lib/genlayer'
import { usePolling } from '@/hooks/usePolling'
import { ConnectButton } from '@rainbow-me/rainbowkit'

export default function MyJobsPage() {
  const { address, isConnected } = useAccount()
  const router = useRouter()

  const clientFetcher = useCallback(() => address ? getJobsByClient(address) : Promise.resolve([]), [address])
  const freelancerFetcher = useCallback(() => address ? getJobsByFreelancer(address) : Promise.resolve([]), [address])

  const { data: clientJobs, loading: cLoading } = usePolling(clientFetcher, 5000)
  const { data: freelancerJobs, loading: fLoading } = usePolling(freelancerFetcher, 5000)

  if (!isConnected) return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }}>
      <p className="font-display" style={{ fontSize: 20, fontWeight: 700 }}>Connect your wallet</p>
      <ConnectButton />
      <BottomNav />
    </main>
  )

  const allClientJobs = Array.isArray(clientJobs) ? clientJobs : []
  const allFreelancerJobs = Array.isArray(freelancerJobs) ? freelancerJobs : []

  const JobCard = ({ job }: { job: any }) => (
    <div className="card" style={{ padding: '18px 20px', cursor: 'pointer' }} onClick={() => router.push(`/job/${job.job_id}`)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <p className="font-display" style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{job.title}</p>
        <StatusBadge status={job.status} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <span className="address-chip">{shortAddress(job.client === address ? job.freelancer : job.client)}</span>
        {job.deadline && <span className="address-chip">Due {job.deadline}</span>}
        {job.created_at && <span className="address-chip">{timeAgo(job.created_at)}</span>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', flex: 1 }}>{job.description?.slice(0, 80)}{job.description?.length > 80 ? '...' : ''}</p>
        <p style={{ fontSize: 14, fontWeight: 600, color: BigInt(job.escrow_balance || '0') > 0n ? 'var(--green)' : 'var(--muted)', flexShrink: 0, marginLeft: 12 }}>
          {formatGEN(job.escrow_balance || '0')}
        </p>
      </div>
    </div>
  )

  const loading = cLoading || fLoading

  return (
    <main style={{ minHeight: '100vh', padding: '80px 20px 120px', maxWidth: 640, margin: '0 auto' }}>
      <div className="fade-up" style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>Wallet: {shortAddress(address || '')}</p>
        <h1 className="font-display" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>My Jobs</h1>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>
      ) : (
        <>
          {/* Jobs as client */}
          <div style={{ marginBottom: 32 }}>
            <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Posted by me ({allClientJobs.length})</p>
            {allClientJobs.length === 0 ? (
              <div className="card-flat" style={{ padding: '28px 20px', textAlign: 'center' }}>
                <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 14 }}>No jobs posted yet.</p>
                <button className="btn-primary" style={{ padding: '10px 20px', fontSize: 14 }} onClick={() => router.push('/post-job')}>Post a Job →</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {allClientJobs.map((j: any) => <JobCard key={j.job_id} job={j} />)}
              </div>
            )}
          </div>

          {/* Jobs as freelancer */}
          <div>
            <p style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Assigned to me ({allFreelancerJobs.length})</p>
            {allFreelancerJobs.length === 0 ? (
              <div className="card-flat" style={{ padding: '28px 20px', textAlign: 'center' }}>
                <p style={{ color: 'var(--muted)', fontSize: 14 }}>No jobs assigned to your wallet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {allFreelancerJobs.map((j: any) => <JobCard key={j.job_id} job={j} />)}
              </div>
            )}
          </div>
        </>
      )}

      <BottomNav />
    </main>
  )
}
