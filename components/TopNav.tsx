"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { getProfile, shortAddress, type Profile } from "@/lib/genlayer";

const links = [
  { href: "/", label: "Home" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/post-job", label: "Post a Job" },
];

export function TopNav() {
  const path = usePathname();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileAddress, setProfileAddress] = useState("");
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    let live = true;
    if (!address) return;
    const load = () =>
      getProfile(address)
        .then((p) => {
          if (live)
            setProfile(p?.found === true || p?.found === "true" ? p : null);
          if (live) setProfileAddress(address);
        })
        .catch(() => {});
    void load();
    window.addEventListener("freelance-market:refresh", load);
    return () => {
      live = false;
      window.removeEventListener("freelance-market:refresh", load);
    };
  }, [address]);
  useEffect(() => {
    if (!menu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menu]);
  const active = (href: string) =>
    href === "/" ? path === href : path.startsWith(href);
  const visibleProfile = profileAddress === address ? profile : null;
  return (
    <header className="nav-shell">
      <nav className="topnav container" aria-label="Primary navigation">
        <Link className="brand" href="/">
          <span className="brand-mark">F</span>
          <span>FreelanceMarket</span>
          <small>beta</small>
        </Link>
        <div className="nav-links">
          {links.map((l) => (
            <Link
              className={active(l.href) ? "active" : ""}
              href={l.href}
              key={l.href}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="nav-actions">
          <span className="network-badge">
            <i />
            Bradbury
          </span>
          {!isConnected ? (
            <button
              className="button primary compact"
              onClick={openConnectModal}
            >
              Connect wallet
            </button>
          ) : (
            <>
              <button
                className="wallet-button"
                onClick={() => router.push("/dashboard")}
              >
                <i />
                {visibleProfile?.name || shortAddress(address || "")}
                <small>{visibleProfile?.role || "connected"}</small>
              </button>
              <button
                className="icon-button desktop-only"
                onClick={() => disconnect()}
                aria-label="Disconnect wallet"
              >
                ↪
              </button>
            </>
          )}
          <button
            className="menu-button"
            onClick={() => setMenu((v) => !v)}
            aria-expanded={menu}
            aria-controls="mobile-navigation"
            aria-label="Toggle navigation"
          >
            <span />
            <span />
          </button>
        </div>
      </nav>
      {menu && (
        <div className="mobile-menu container" id="mobile-navigation">
          {links.map((l) => (
            <Link
              onClick={() => setMenu(false)}
              className={active(l.href) ? "active" : ""}
              href={l.href}
              key={l.href}
            >
              {l.label}
              <span>→</span>
            </Link>
          ))}
          {isConnected && (
            <button onClick={() => disconnect()}>Disconnect wallet</button>
          )}
        </div>
      )}
    </header>
  );
}
