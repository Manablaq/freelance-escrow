'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAccount, useDisconnect } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useState } from 'react'
import { getProfile, type Profile } from '@/lib/genlayer'
import { resolveGNS } from '@/lib/gns'

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    return (localStorage.getItem('fm-theme') as 'dark' | 'light' | null) || 'dark'
  })
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  function toggle() {
    const n = theme === 'dark' ? 'light' : 'dark'
    setTheme(n); document.documentElement.setAttribute('data-theme', n)
    localStorage.setItem('fm-theme', n)
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
  { href: '/dashboard', num: '0.3', label: 'Dashboard' },
]

type ProfileState = 'loading' | 'none' | 'registered'

export function TopNav() {
  const path = usePathname()
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()

  // Start as 'loading' so we never flash "Create Profile" for registered users
  const [profileState, setProfileState] = useState<ProfileState>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [genName, setGenName] = useState<string>('')

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      await Promise.resolve()
      if (cancelled) return

      if (!isConnected || !address) {
        setProfileState('loading')
        setProfile(null)
        setGenName('')
        return
      }

      setProfileState('loading')

      try {
        const [p, gns] = await Promise.all([
          getProfile(address),
          resolveGNS(address),
        ])
        if (cancelled) return
        const hasProfile = p?.found === true || p?.found === 'true'
        setProfile(hasProfile ? p : null)
        setGenName(gns || '')
        setProfileState(hasProfile ? 'registered' : 'none')
      } catch {
        if (!cancelled) setProfileState('none')
      }
    }

    void loadProfile()
    return () => { cancelled = true }
  }, [address, isConnected])

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

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <ThemeToggle />

          {!isConnected && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-glass" style={{ padding: '7px 16px', fontSize: 13 }} onClick={openConnectModal}>Login</button>
              <button className="btn-primary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={openConnectModal}>Get Started →</button>
            </div>
          )}

          {isConnected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>

              {/* Only show Create Profile if confirmed NOT registered */}
              {profileState === 'none' && (
                <button className="btn-orange" style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600 }} onClick={() => router.push('/register')}>
                  + Create Profile
                </button>
              )}

              {/* Role badge — only show when confirmed registered */}
              {profileState === 'registered' && profile && (
                <span className="badge" style={{
                  color: profile.role === 'freelancer' ? 'var(--orange)' : 'var(--purple2)',
                  background: profile.role === 'freelancer' ? 'rgba(255,123,53,0.12)' : 'rgba(123,91,255,0.12)',
                  fontSize: 10, padding: '4px 10px',
                }}>
                  {profile.role === 'freelancer' ? '💼' : '🏢'} {profile.role}
                </span>
              )}

              {/* Wallet button */}
              <button className="btn-glass" style={{ padding: '6px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => router.push('/dashboard')}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', flexShrink: 0 }} />
                {genName
                  ? <span style={{ color: 'var(--purple2)', fontWeight: 700 }}>{genName}</span>
                  : <span>{short}</span>
                }
              </button>

              <button className="btn-outline" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => disconnect()}>
                Leave
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav">
        {LINKS.map(({ href, num, label }) => (
          <Link key={href} href={href} className={`mob-item ${path === href ? 'active' : ''}`}>
            <span style={{ fontSize: 14 }}>{num === '0.1' ? '🏠' : num === '0.2' ? '🏪' : '📊'}</span>
            {label}
          </Link>
        ))}
        <div className="mob-item" style={{ cursor: 'pointer' }} onClick={isConnected ? () => router.push('/dashboard') : openConnectModal}>
          <span style={{ fontSize: 14 }}>👤</span>
          {isConnected ? (genName || short.slice(0, 8)) : 'Connect'}
        </div>
      </nav>
    </>
  )
}
