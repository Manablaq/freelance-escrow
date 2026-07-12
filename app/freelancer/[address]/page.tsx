"use client";
import { useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { AppShell, EmptyState, SkeletonGrid } from "@/components/AppShell";
import { Address } from "@/components/Web3UI";
import { formatGEN, getProfile, isAddress } from "@/lib/genlayer";
import { usePolling } from "@/hooks/usePolling";

const external = (value: string, type: "portfolio" | "twitter" | "github") =>
  type === "portfolio"
    ? value
    : type === "twitter"
      ? `https://x.com/${value.replace("@", "")}`
      : `https://github.com/${value.replace(/^@/, "")}`;
export default function FreelancerProfile() {
  const { address: addr } = useParams<{ address: string }>();
  const { address: mine } = useAccount();
  const fetcher = useCallback(() => getProfile(addr), [addr]);
  const { data: p, loading, error } = usePolling(fetcher, 10000);
  const me = mine?.toLowerCase() === addr.toLowerCase();
  const skills = (p?.skills || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return (
    <AppShell>
      <section className="section container">
        {loading ? (
          <SkeletonGrid count={2} />
        ) : error ||
          !isAddress(addr) ||
          !p?.found ||
          p.role !== "freelancer" ? (
          <EmptyState
            title="Freelancer not found"
            description="This address does not resolve to a registered freelancer profile in the accepted contract state."
            action={
              <Link className="button secondary" href="/marketplace">
                Back to marketplace
              </Link>
            }
          />
        ) : (
          <>
            <p className="eyebrow">Freelancer profile</p>
            <div className="profile-layout">
              <div className="profile-main">
                <article className="card profile-panel">
                  <div className="profile-identity">
                    <div className="avatar">
                      {(p.name?.[0] || "?").toUpperCase()}
                    </div>
                    <div>
                      <h1>{p.name || "Unnamed freelancer"}</h1>
                      <Address value={p.address || addr} />
                    </div>
                  </div>
                  <p className="profile-bio">
                    {p.bio ||
                      "This freelancer has not added a professional summary yet."}
                  </p>
                  <div className="social-links">
                    {(["portfolio", "twitter", "github"] as const).map((k) =>
                      p[k] ? (
                        <a
                          className="button secondary compact"
                          key={k}
                          href={external(p[k] || "", k)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {k[0].toUpperCase() + k.slice(1)} ↗
                        </a>
                      ) : null,
                    )}
                  </div>
                </article>
                <article className="panel profile-panel">
                  <p className="eyebrow">Skills & expertise</p>
                  {skills.length ? (
                    <div className="skills">
                      {skills.map((s) => (
                        <span className="skill" key={s}>
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="page-lede">No skills have been listed.</p>
                  )}
                </article>
                <article className="panel profile-panel">
                  <p className="eyebrow">On-chain work record</p>
                  <div
                    className="stat-grid"
                    style={{ gridTemplateColumns: "1fr 1fr" }}
                  >
                    <div className="metric">
                      <span>Completed jobs</span>
                      <strong>{p.jobs_completed || "0"}</strong>
                    </div>
                    <div className="metric">
                      <span>Total earned</span>
                      <strong>{formatGEN(p.total_earned || "0")}</strong>
                    </div>
                  </div>
                  <p className="field-hint" style={{ marginTop: 14 }}>
                    These totals are returned by the deployed contract.
                    FreelanceMarket does not infer ratings or private work
                    history.
                  </p>
                </article>
              </div>
              <aside>
                <div className="card sidebar-card">
                  <p className="eyebrow">Published rate</p>
                  <strong className="price">{p.rate || "—"} GEN</strong>
                  <p>
                    {p.rate_type
                      ? `Rate type: ${p.rate_type}`
                      : "No rate type provided"}
                  </p>
                  {me ? (
                    <Link className="button secondary" href="/dashboard">
                      Manage your profile
                    </Link>
                  ) : (
                    <Link
                      className="button primary"
                      href={`/post-job?freelancer=${p.address || addr}&name=${encodeURIComponent(p.name || "")}`}
                    >
                      Hire {p.name || "this freelancer"}
                    </Link>
                  )}
                  <div className="notice info" style={{ marginBottom: 0 }}>
                    <div>
                      <strong>Hiring creates an on-chain job.</strong>
                      <p>
                        Funding is a separate action after you review the
                        created job.
                      </p>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
