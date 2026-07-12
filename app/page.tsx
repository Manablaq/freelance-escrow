"use client";
import Link from "next/link";
import { useCallback } from "react";
import { AppShell, SkeletonGrid } from "@/components/AppShell";
import { formatGEN, getStats } from "@/lib/genlayer";
import { usePolling } from "@/hooks/usePolling";

export default function HomePage() {
  const fetcher = useCallback(() => getStats(), []);
  const { data: s, loading } = usePolling(fetcher, 8000);
  return (
    <AppShell>
      <section className="container hero">
        <div className="hero-copy">
          <p className="eyebrow">On-chain escrow · GenLayer Bradbury</p>
          <h1>
            Great work deserves{" "}
            <span className="gradient-text">clear terms.</span>
          </h1>
          <p>
            Hire proven freelancers, lock GEN in transparent escrow, and settle
            public deliverables with AI-assisted verification built into the
            contract workflow.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/marketplace">
              Browse freelancers <span>→</span>
            </Link>
            <Link className="button secondary" href="/register">
              Create your profile
            </Link>
          </div>
          <div className="trust-row">
            <span>Accepted-state contract reads</span>
            <span>Public deliverable evidence</span>
            <span>Source-verifiable escrow</span>
          </div>
        </div>
        <div className="hero-visual" aria-label="Escrow workflow illustration">
          <div className="escrow-orbit">
            <div className="escrow-core">
              <div>
                <strong>GEN</strong>
                <span>Secured in escrow</span>
              </div>
            </div>
          </div>
          <div className="orbit-chip one">
            <strong>01</strong> Client funds
          </div>
          <div className="orbit-chip two">
            <strong>02</strong> Work verified
          </div>
        </div>
      </section>
      <section className="section-muted">
        <div className="container section compact">
          <p className="eyebrow">Live contract activity</p>
          {loading ? (
            <SkeletonGrid count={4} />
          ) : (
            <div className="stat-grid">
              <div className="metric">
                <span>Registered talent</span>
                <strong>{s?.total_freelancers || "0"}</strong>
              </div>
              <div className="metric">
                <span>Jobs created</span>
                <strong>{s?.total_jobs || "0"}</strong>
              </div>
              <div className="metric">
                <span>Total paid</span>
                <strong>{formatGEN(s?.total_paid || "0")}</strong>
              </div>
              <div className="metric">
                <span>Network</span>
                <strong>Bradbury</strong>
              </div>
            </div>
          )}
        </div>
      </section>
      <section className="section container">
        <p className="eyebrow">A legible workflow</p>
        <div className="page-header">
          <div>
            <h1>From scope to settlement.</h1>
            <p className="page-lede">
              Every state change is explicit, role-gated, and reflected from the
              contract’s accepted state.
            </p>
          </div>
        </div>
        <div className="workflow-grid">
          {[
            [
              "01",
              "Create & fund",
              "A client assigns a registered freelancer, then locks the agreed GEN amount.",
            ],
            [
              "02",
              "Complete & submit",
              "The assigned freelancer provides a publicly accessible deliverable URL.",
            ],
            [
              "03",
              "AI-assisted verification",
              "GenLayer validators compare public evidence with the written job scope.",
            ],
            [
              "04",
              "Release or refund",
              "Approval releases escrow. Rejection creates a dispute with a client refund path.",
            ],
          ].map(([n, t, d]) => (
            <article className="workflow-step" key={n}>
              <b>{n}</b>
              <h3>{t}</h3>
              <p>{d}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="section-muted">
        <div className="section container">
          <div className="split-grid">
            <article className="card value-card">
              <p className="eyebrow">For clients</p>
              <h3>Hire with operational clarity.</h3>
              <p>
                Define the job once, see who is accountable, and keep funds
                visible throughout delivery.
              </p>
              <ul className="feature-list">
                <li>Registered freelancer identities</li>
                <li>Role-specific contract controls</li>
                <li>Public submission evidence</li>
              </ul>
            </article>
            <article className="card value-card">
              <p className="eyebrow">For freelancers</p>
              <h3>Turn delivery into proof.</h3>
              <p>
                Work against an on-chain scope, submit evidence publicly, and
                track payment status without guesswork.
              </p>
              <ul className="feature-list">
                <li>Discoverable professional profile</li>
                <li>Funded-work visibility</li>
                <li>On-chain completed-work totals</li>
              </ul>
            </article>
          </div>
        </div>
      </section>
      <section className="section container">
        <div className="page-header">
          <div>
            <p className="eyebrow">Trust through transparency</p>
            <h1>Verify the system, not the slogan.</h1>
            <p className="page-lede">
              Escrow state, participant addresses, job scope, and deliverable
              evidence remain inspectable. The deployed source is verifiable and
              GenLayer validators independently evaluate public evidence.
            </p>
          </div>
        </div>
        <div className="lifecycle" aria-label="Job lifecycle">
          {[
            "OPEN",
            "FUNDED",
            "SUBMITTED",
            "PAID / DISPUTED",
            "REFUNDED / CANCELLED",
          ].map((x, i) => (
            <div className="life-step active" key={x}>
              <span>{i + 1}</span>
              {x}
            </div>
          ))}
        </div>
        <div className="notice info">
          <div>
            <strong>Verification has boundaries.</strong>
            <p>
              AI-assisted evaluation is not legal arbitration, objective truth,
              or a promise of fairness. Accessible evidence and precise job
              descriptions materially affect results.
            </p>
          </div>
        </div>
      </section>
      <section className="section-muted">
        <div className="section container" style={{ textAlign: "center" }}>
          <p className="eyebrow">Start with shared expectations</p>
          <h2 style={{ fontSize: "clamp(32px,5vw,54px)", marginBottom: 24 }}>
            Find the right person. Fund the right work.
          </h2>
          <div className="hero-actions">
            <Link className="button primary" href="/marketplace">
              Explore marketplace
            </Link>
            <Link className="button secondary" href="/post-job">
              Post a job
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
