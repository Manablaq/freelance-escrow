"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  AppShell,
  EmptyState,
  PageHeader,
  SkeletonGrid,
} from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Address } from "@/components/Web3UI";
import { Modal } from "@/components/Modal";
import {
  formatGEN,
  getJobsByClient,
  getJobsByFreelancer,
  getProfile,
  isJobId,
  timeAgo,
  checkTransactionReceipt,
  writeContract,
  type Job,
  type Profile,
} from "@/lib/genlayer";
import { usePolling } from "@/hooks/usePolling";
import { useTransactionSync } from "@/hooks/useTransactionSync";

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [lookup, setLookup] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Profile>>({});
  const transaction = useTransactionSync(address || "disconnected");
  useEffect(() => {
    if (transaction.state.phase !== "confirmed") return;
    const closeId = window.setTimeout(() => setEditing(false), 0);
    return () => window.clearTimeout(closeId);
  }, [transaction.state.phase]);
  const pf = useCallback(
    () => (address ? getProfile(address) : Promise.resolve(null)),
    [address],
  );
  const cf = useCallback(
    () => (address ? getJobsByClient(address) : Promise.resolve([])),
    [address],
  );
  const ff = useCallback(
    () => (address ? getJobsByFreelancer(address) : Promise.resolve([])),
    [address],
  );
  const {
    data: profile,
    loading: profileLoading,
    refetch: reloadProfile,
  } = usePolling(pf, 8000);
  const p = profile?.found ? profile : null;
  const { data: cJobs, loading: cLoading } = usePolling(cf, 5000);
  const { data: fJobs, loading: fLoading } = usePolling(ff, 5000);
  const jobs = (p?.role === "client" ? cJobs : fJobs) as Job[] | null;
  const list = useMemo(() => (Array.isArray(jobs) ? jobs : []), [jobs]);
  const filtered =
    filter === "all" ? list : list.filter((j) => j.status === filter);
  const action = useMemo(
    () =>
      list.filter((j) =>
        p?.role === "client"
          ? ["OPEN", "SUBMITTED", "DISPUTED"].includes(j.status || "")
          : j.status === "FUNDED",
      ),
    [list, p?.role],
  );
  const escrow = list.reduce(
    (sum, j) => sum + BigInt(j.escrow_balance || "0"),
    0n,
  );
  const paid = list.filter((j) => j.status === "PAID").length;
  function edit() {
    if (!p) return;
    setForm({
      name: p.name,
      bio: p.bio,
      skills: p.skills,
      rate: p.rate,
      rate_type: p.rate_type,
      portfolio: p.portfolio,
      twitter: p.twitter,
      github: p.github,
    });
    setEditing(true);
  }
  async function save() {
    if (!address || (form.name || "").trim().length < 2) return;
    const expected = {
      name: form.name || "",
      bio: form.bio || "",
      skills: form.skills || "",
      rate: form.rate || "",
      rate_type: form.rate_type || "fixed",
      portfolio: form.portfolio || "",
      twitter: form.twitter || "",
      github: form.github || "",
    };
    const confirmed = await transaction.execute({
      label: "Update profile",
      checkReceipt: (hash) => checkTransactionReceipt(address, hash),
      submit: (lifecycle) =>
        writeContract(
          address,
          "update_profile",
          Object.values(expected),
          undefined,
          lifecycle,
        ),
      confirm: async (signal) => {
        const updated = await getProfile(address, signal);
        return (Object.keys(expected) as Array<keyof typeof expected>).every(
          (key) => updated[key] === expected[key],
        );
      },
    });
    if (confirmed) {
      setEditing(false);
      await reloadProfile();
    }
  }
  return (
    <AppShell>
      <section className="section container">
        {!isConnected ? (
          <EmptyState
            title="Your workspace starts with a wallet"
            description="Connect the wallet associated with your FreelanceMarket profile to load role-specific jobs and actions."
            action={
              <button className="button primary" onClick={openConnectModal}>
                Connect wallet
              </button>
            }
          />
        ) : profileLoading ? (
          <SkeletonGrid count={3} />
        ) : !p ? (
          <EmptyState
            title="No profile for this wallet"
            description="Register as a client or freelancer before using the workspace."
            action={
              <Link className="button primary" href="/register">
                Create profile
              </Link>
            }
          />
        ) : (
          <>
            <PageHeader
              eyebrow={`${p.role} workspace`}
              title={
                <>
                  Welcome back, <span className="gradient-text">{p.name}.</span>
                </>
              }
              description={
                p.role === "client"
                  ? "Review engagements, fund open jobs, and act on submitted or disputed work."
                  : "Track assignments, submit funded work, and follow each engagement through settlement."
              }
              actions={
                p.role === "client" ? (
                  <Link className="button primary" href="/marketplace">
                    Hire a freelancer
                  </Link>
                ) : undefined
              }
            />
            <div className="stat-grid">
              <div className="metric">
                <span>Total jobs</span>
                <strong>{list.length}</strong>
              </div>
              <div className="metric">
                <span>Action required</span>
                <strong>{action.length}</strong>
              </div>
              <div className="metric">
                <span>Active escrow</span>
                <strong>{formatGEN(escrow)}</strong>
              </div>
              <div className="metric">
                <span>Paid jobs</span>
                <strong>{paid}</strong>
              </div>
            </div>
            <div className="split-grid" style={{ marginTop: 22 }}>
              <div className="panel profile-panel">
                <p className="eyebrow">Action required</p>
                {action.length ? (
                  <div className="job-list">
                    {action.slice(0, 4).map((j) => (
                      <JobRow job={j} key={j.job_id} />
                    ))}
                  </div>
                ) : (
                  <p className="page-lede">
                    Nothing needs your attention right now.
                  </p>
                )}
              </div>
              <div className="panel profile-panel">
                <p className="eyebrow">Open by job ID</p>
                <p className="field-hint" style={{ marginBottom: 12 }}>
                  Use the numeric contract job ID.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={lookup}
                    onChange={(e) =>
                      setLookup(
                        e.target.value.replace(/^\s*job_id\s*:\s*/i, ""),
                      )
                    }
                    placeholder="Job ID"
                    aria-label="Job ID"
                  />
                  <button
                    className="button secondary"
                    disabled={!isJobId(lookup)}
                    onClick={() => router.push(`/job/${lookup}`)}
                  >
                    Open
                  </button>
                </div>
              </div>
            </div>
            <div className="dashboard-tabs" style={{ marginTop: 36 }}>
              {[
                "all",
                "OPEN",
                "FUNDED",
                "SUBMITTED",
                "PAID",
                "DISPUTED",
                "REFUNDED",
              ].map((x) => (
                <button
                  className={filter === x ? "active" : ""}
                  key={x}
                  onClick={() => setFilter(x)}
                >
                  {x === "all" ? "All jobs" : x}
                </button>
              ))}
            </div>
            {cLoading || fLoading ? (
              <SkeletonGrid count={2} />
            ) : filtered.length ? (
              <div className="job-list">
                {filtered.map((j) => (
                  <JobRow job={j} key={j.job_id} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No jobs in this view"
                description={
                  list.length
                    ? "Choose another lifecycle filter."
                    : p.role === "client"
                      ? "Browse the marketplace to create your first engagement."
                      : "Assigned jobs will appear after a client creates one for this wallet."
                }
              />
            )}
            <section className="section compact">
              <div className="page-header">
                <div>
                  <p className="eyebrow">Profile settings</p>
                  <h2>{p.name}</h2>
                  <Address value={address || ""} />
                </div>
                <button className="button secondary" onClick={edit}>
                  Edit profile
                </button>
              </div>
            </section>
            {editing && (
              <Modal
                titleId="edit-profile-title"
                closeDisabled={transaction.pending}
                onClose={() => setEditing(false)}
              >
                  <p className="eyebrow">On-chain profile</p>
                  <h2 id="edit-profile-title">Edit profile</h2>
                  <div className="form-stack" style={{ marginTop: 20 }}>
                    {[
                      "name",
                      "bio",
                      ...(p.role === "freelancer"
                        ? ["skills", "rate", "rate_type", "portfolio"]
                        : []),
                      "twitter",
                      "github",
                    ].map((k) => (
                      <div className="field" key={k}>
                        <label htmlFor={`edit-${k}`}>
                          {k.replace("_", " ")}
                        </label>
                        {k === "bio" ? (
                          <textarea
                            id={`edit-${k}`}
                            className="input"
                            value={String(form[k as keyof Profile] || "")}
                            onChange={(e) =>
                              setForm((x) => ({ ...x, [k]: e.target.value }))
                            }
                          />
                        ) : (
                          <input
                            id={`edit-${k}`}
                            className="input"
                            value={String(form[k as keyof Profile] || "")}
                            onChange={(e) =>
                              setForm((x) => ({ ...x, [k]: e.target.value }))
                            }
                          />
                        )}
                      </div>
                    ))}
                    <div
                      className="form-actions"
                      style={{ display: "flex", gap: 8 }}
                    >
                      <button
                        className="button secondary"
                        onClick={() => setEditing(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="button primary"
                        disabled={
                          transaction.pending ||
                          (form.name || "").trim().length < 2
                        }
                        onClick={() => void save()}
                      >
                        Save changes
                      </button>
                    </div>
                  </div>
              </Modal>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
function JobRow({ job }: { job: Job }) {
  return (
    <Link className="card job-row" href={`/job/${job.job_id}`}>
      <div>
        <h3>{job.title || `Job #${job.job_id}`}</h3>
        <div className="job-meta">
          <StatusBadge status={job.status || "UNKNOWN"} />
          <p>
            {job.created_at ? timeAgo(job.created_at) : `Job #${job.job_id}`}
          </p>
        </div>
      </div>
      <strong>{formatGEN(job.escrow_balance || "0")}</strong>
      <span>→</span>
    </Link>
  );
}
