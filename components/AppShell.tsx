'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount, useDisconnect } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useState, ReactNode } from 'react'

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    const saved = localStorage.getItem('fe-theme') as 'dark' | 'light' | null
    if (saved) { setTheme(saved); document.documentElement.setAttribute('data-theme', saved) }
  }, [])
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('fe-theme', next)
  }
  return (
    <button onClick={toggle} title="Toggle theme" style={{ background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 14 }}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}

const NAV = [
  { href: '/', label: 'Home', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )},
  { href: '/post-job', label: 'Post Job', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  )},
  { href: '/dashboard', label: 'Dashboard', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
    </svg>
  )},
]

const SECTION_LABELS: Record<string, string> = {
  '/': 'Home',
  '/post-job': 'Post a Job',
  '/dashboard': 'Dashboard',
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  const short = address ? `${address.slice(0, 6)}···${address.slice(-4)}` : ''

  const sectionLabel = SECTION_LABELS[path] ?? path.startsWith('/job/') ? 'Job Detail' : ''

  return (
    <div className="app-shell">

      {/* ── TOPBAR ── */}
      <header className="topbar">
        {/* Left: logo + breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🤝</div>
            <span className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>FreelanceEscrow</span>
          </div>
          {sectionLabel && (
            <>
              <span style={{ color: 'var(--border2)', fontSize: 16 }}>/</span>
              <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>{sectionLabel}</span>
            </>
          )}
        </div>

        {/* Right: theme + wallet */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThemeToggle />
          {isConnected ? (
            <button
              onClick={() => disconnect()}
              style={{ background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 8, padding: '5px 12px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', flexShrink: 0 }} />
              {short}
            </button>
          ) : (
            <button onClick={openConnectModal} className="btn-primary" style={{ padding: '6px 14px', fontSize: 13 }}>
              Connect
            </button>
          )}
        </div>
      </header>

      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        {/* Mochi mini */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', marginBottom: 20 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#8B35FF,#C840E9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 0 12px rgba(139,53,255,0.4)' }}>🤖</div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.05em' }}>MOCHI</p>
            <p style={{ fontSize: 10, color: 'var(--muted)' }}>AI Arbitrator</p>
          </div>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1 }}>
          {NAV.map(({ href, label, icon }) => (
            <Link key={href} href={href} className={`sidebar-item ${path === href ? 'active' : ''}`}>
              {icon}
              <span>{label}</span>
            </Link>
          ))}
        </div>

        {/* Network indicator */}
        <div style={{ padding: '10px 12px', background: 'rgba(0,229,160,0.06)', border: '1px solid rgba(0,229,160,0.15)', borderRadius: 10, marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)', display: 'inline-block' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)' }}>LIVE</span>
          </div>
          <p style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>GenLayer Bradbury</p>
        </div>
      </aside>

      {/* ── CONTENT ── */}
      <main className="content">
        <div className="content-inner">
          {children}
        </div>
      </main>

      {/* ── MOBILE NAV ── */}
      <nav className="mobile-nav">
        {NAV.map(({ href, label, icon }) => (
          <Link key={href} href={href} className={`mobile-nav-item ${path === href ? 'active' : ''}`}>
            {icon}
            {label}
          </Link>
        ))}
        <div className="mobile-nav-item" style={{ cursor: 'pointer' }} onClick={isConnected ? () => disconnect() : openConnectModal}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          {isConnected ? short.slice(0,6) : 'Connect'}
        </div>
      </nav>
    </div>
  )
}
