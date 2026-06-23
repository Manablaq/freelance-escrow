'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAccount, useDisconnect } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useState } from 'react'

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    const s = localStorage.getItem('fm-theme') as 'dark' | 'light' | null
    if (s) { setTheme(s); document.documentElement.setAttribute('data-theme', s) }
  }, [])
  function toggle() {
    const n = theme === 'dark' ? 'light' : 'dark'
    setTheme(n); document.documentElement.setAttribute('data-theme', n); localStorage.setItem('fm-theme', n)
  }
  return (
    <button onClick={toggle} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}

const LINKS = [
  { href: '/', num: '0.1', label: 'Home' },
  { href: '/marketplace', num: '0.2', label: 'Marketplace' },
  { href: '/post-job', num: '0.3', label: 'Post Job' },
  { href: '/dashboard', num: '0.4', label: 'Dashboard' },
]

export function TopNav() {
  const path = usePathname()
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()
  const short = address ? `${address.slice(0, 6)}···${address.slice(-4)}` : ''

  return (
    <>
      <nav className="topnav">
        {/* Logo */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🤝</div>
          <span className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>FreelanceMarket</span>
        </Link>

        {/* Center nav */}
        <div className="nav-links">
          {LINKS.map(({ href, num, label }) => (
            <Link key={href} href={href} className={`nav-link ${path === href ? 'active' : ''}`}>
              <span className="num">{num} /</span> {label}
            </Link>
          ))}
        </div>

        {/* Right: theme + wallet */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <ThemeToggle />
          {isConnected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="btn-glass" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => router.push('/dashboard')}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                {short}
              </button>
              <button className="btn-outline" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => disconnect()}>
                Leave
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-glass" style={{ padding: '7px 16px', fontSize: 13 }} onClick={openConnectModal}>Login</button>
              <button className="btn-primary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={() => { openConnectModal?.(); }}>
                Get Started →
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav">
        {LINKS.map(({ href, num, label }) => (
          <Link key={href} href={href} className={`mob-item ${path === href ? 'active' : ''}`}>
            <span style={{ fontSize: 14 }}>{num === '0.1' ? '🏠' : num === '0.2' ? '🏪' : num === '0.3' ? '➕' : '📊'}</span>
            {label}
          </Link>
        ))}
        <div className="mob-item" style={{ cursor: 'pointer' }} onClick={isConnected ? () => disconnect() : openConnectModal}>
          <span style={{ fontSize: 14 }}>👤</span>
          {isConnected ? short.slice(0, 8) : 'Connect'}
        </div>
      </nav>
    </>
  )
}
