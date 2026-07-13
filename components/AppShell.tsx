import Link from "next/link";
import { TopNav } from "./TopNav";
import { TransactionTray } from "./TransactionProvider";
import { CONTRACT_ADDRESS, NETWORK_LABEL } from "@/lib/config";

const explorer = `https://explorer-bradbury.genlayer.com/address/${CONTRACT_ADDRESS}`;

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <TopNav />
      <TransactionTray />
      <main className="site-main" id="main-content">
        {children}
      </main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <Link className="brand" href="/">
              <span className="brand-mark">F</span>
              <span>FreelanceMarket</span>
            </Link>
            <p className="footer-copy">
              On-chain freelance escrow with AI-assisted deliverable
              verification on GenLayer.
            </p>
          </div>
          <div>
            <p className="footer-title">Product</p>
            <Link href="/marketplace">Marketplace</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/post-job">Post a job</Link>
          </div>
          <div>
            <p className="footer-title">Transparency</p>
            <a href={explorer} target="_blank" rel="noopener noreferrer">
              Verified contract ↗
            </a>
            <a
              href="https://github.com/Manablaq/freelance-escrow"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub repository ↗
            </a>
            <span>{NETWORK_LABEL}</span>
          </div>
        </div>
        <div className="container footer-legal">
          <span>Bradbury testnet only. GEN has no implied mainnet value.</span>
          <span>
            AI-assisted verification is not legal arbitration or a guarantee of
            fairness.
          </span>
        </div>
      </footer>
    </>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-lede">{description}</p>
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-card">
      <span className="empty-icon" aria-hidden="true">
        ◇
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function SkeletonGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="card-grid" aria-label="Loading">
      <span className="sr-only">Loading content</span>
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-card" key={i}>
          <i />
          <b />
          <b />
          <em />
        </div>
      ))}
    </div>
  );
}
