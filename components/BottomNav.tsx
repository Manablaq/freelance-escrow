'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount, useDisconnect } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'

export function BottomNav() {
  const path = usePathname()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  const short = address ? `${address.slice(0,6)}...${address.slice(-4)}` : ''

  return (
    <>
      <div style={{ position:'fixed', top:16, right:16, zIndex:200, display:'flex', alignItems:'center', gap:8 }}>
        {isConnected ? (
          <>
            <div className="address-chip">{short}</div>
            <button onClick={() => disconnect()} style={{ background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:10, padding:'7px 14px', fontSize:13, color:'var(--red)', cursor:'pointer', fontWeight:500 }}>
              Disconnect
            </button>
          </>
        ) : (
          <button onClick={openConnectModal} className="btn-primary" style={{ padding:'9px 20px', fontSize:14 }}>
            Connect Wallet
          </button>
        )}
      </div>

      <nav className="bottom-nav">
        <Link href="/" className={`nav-item ${path === '/' ? 'active' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/></svg>
          Dashboard
        </Link>
        <Link href="/post-job" className={`nav-item ${path === '/post-job' ? 'active' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Post Job
        </Link>
        <Link href="/my-jobs" className={`nav-item ${path === '/my-jobs' ? 'active' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          My Jobs
        </Link>
      </nav>
    </>
  )
}
