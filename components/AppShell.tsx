'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAccount, useDisconnect } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useState, useCallback, ReactNode } from 'react'
import { getProfile } from '@/lib/genlayer'

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    const saved = localStorage.getItem('fm-theme') as 'dark' | 'light' | null
    if (saved) { setTheme(saved); document.documentElement.setAttribute('data-theme', saved) }
  }, [])
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next); document.documentElement.setAttribute('data-theme', next); localStorage.setItem('fm-theme', next)
  }
  return (
    <button onClick={toggle} style={{ background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 14 }}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}

const NAV = [
  { href: '/', label: 'Home', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
  { href: '/marketplace', label: 'Marketplace', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/></svg> },
  { href: '/dashboard', label: 'Dashboard', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> },
]

const LABELS: Record<string, string> = {
  '/': 'Home',
  '/marketplace': 'Marketplace',
  '/dashboard': 'Dashboard',
  '/register': 'Register',
  '/post-job': 'Post Job',
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname()
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  const [profile, setProfile] = useState<any>(null)
  const short = address ? `${address.slice(0, 6)}···${address.slice(-4)}` : ''

  useEffect(() => {
    if (!address) { setProfile(null); return }
    getProfile(address).then(p => setProfile(p?.found ? p : null)).catch(() => {})
  }, [address])

  const roleColor = profile?.role === 'freelancer' ? 'var(--cyan)' : profile?.role === 'client' ? 'var(--purple)' : 'var(--muted)'
  const sectionLabel = LABELS[path] ?? (path.startsWith('/job/') ? 'Job Detail' : path.startsWith('/freelancer/') ? 'Freelancer Profile' : '')

  return (
    <div className="app-shell">
      {/* TOPBAR */}
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🤝</div>
            <span className="font-display" style={{ fontSize: 14, fontWeight: 700 }}>FreelanceMarket</span>
          </div>
          {sectionLabel && <><span style={{ color: 'var(--border2)', fontSize: 16 }}>/</span><span style={{ fontSize: 13, color: 'var(--muted)' }}>{sectionLabel}</span></>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThemeToggle />
          {isConnected ? (
            <button onClick={() => disconnect()} style={{ background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 8, padding: '5px 12px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
              {short}
            </button>
          ) : (
            <button onClick={openConnectModal} className="btn-primary" style={{ padding: '6px 14px', fontSize: 13 }}>Connect</button>
          )}
        </div>
      </header>

      {/* SIDEBAR */}
      <aside className="sidebar">
        {/* Role badge */}
        <div style={{ padding: '6px 12px', marginBottom: 16 }}>
          {profile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                {profile.role === 'freelancer' ? '💼' : '🏢'}
              </div>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{profile.name}</p>
                <p style={{ fontSize: 10, color: roleColor, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{profile.role}</p>
              </div>
            </div>
          ) : isConnected ? (
            <button onClick={() => router.push('/register')} className="btn-primary" style={{ padding: '8px 12px', fontSize: 12, width: '100%' }}>
              + Register Profile
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🤖</div>
              <div><p style={{ fontSize: 11, color: 'var(--muted)' }}>FreelanceMarket</p><p style={{ fontSize: 10, color: 'var(--muted)', opacity: 0.6 }}>Connect wallet</p></div>
            </div>
          )}
        </div>

        {/* Nav */}
        <div style={{ flex: 1 }}>
          {NAV.map(({ href, label, icon }) => (
            <Link key={href} href={href} className={`sidebar-item ${path === href ? 'active' : ''}`}>
              {icon}<span>{label}</span>
            </Link>
          ))}
          {profile && (
            <Link href="/post-job" className={`sidebar-item ${path === '/post-job' ? 'active' : ''}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              <span>Post Job</span>
            </Link>
          )}
        </div>

        {/* Network */}
        <div style={{ padding: '10px 12px', background: 'rgba(0,229,160,0.06)', border: '1px solid rgba(0,229,160,0.15)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)', display: 'inline-block' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)' }}>LIVE</span>
          </div>
          <p style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>GenLayer Bradbury</p>
        </div>
      </aside>

      {/* CONTENT */}
      <main className="content">
        <div className="content-inner">{children}</div>
      </main>

      {/* MOBILE NAV */}
      <nav className="mobile-nav">
        {NAV.map(({ href, label, icon }) => (
          <Link key={href} href={href} className={`mobile-nav-item ${path === href ? 'active' : ''}`}>
            {icon}{label}
          </Link>
        ))}
        <div className="mobile-nav-item" style={{ cursor: 'pointer' }} onClick={isConnected ? () => disconnect() : openConnectModal}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          {isConnected ? short.slice(0, 8) : 'Connect'}
        </div>
      </nav>
    </div>
  )
}
