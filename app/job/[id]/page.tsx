"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { parseEther } from "viem";
import { AppShell, EmptyState, SkeletonGrid } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Address } from "@/components/Web3UI";
import {
  formatGEN,
  getJob,
  isJobId,
  isPublicUrl,
  submitContract,
} from "@/lib/genlayer";
import { usePolling } from "@/hooks/usePolling";
import { useTransactionSync } from "@/hooks/useTransactionSync";
import type { ConfirmationDescriptor, PendingEntityType } from "@/lib/pending-transactions";
import { useTransactions } from "@/components/TransactionProvider";

const terminal = ["PAID", "REFUNDED", "CANCELLED"];
const explanation: Record<string, string> = {
  OPEN: "Created and awaiting client funding.",
  FUNDED: "GEN is locked. The assigned freelancer can submit work.",
  SUBMITTED:
    "Public evidence is ready for client-triggered AI-assisted verification.",
  PAID: "Verification approved the work and escrow was released.",
  DISPUTED:
    "Verification did not approve the evidence. The client may refund escrow.",
  REFUNDED: "Escrow was returned through the contract refund path.",
  CANCELLED: "The unfunded job was cancelled by its client.",
};
export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { address } = useAccount();
  const fetcher = useCallback(() => getJob(id), [id]);
  const {
    data: j,
    loading,
    error: loadError,
  } = usePolling(fetcher, 5000);
  const [amount, setAmount] = useState("");
  const [url, setUrl] = useState("");
  const transaction = useTransactionSync(`${address || "disconnected"}:${id}`);
  const { hasPendingEntityKey } = useTransactions();
  const jobActionPending = hasPendingEntityKey(id);
  async function act(
    label: string,
    method: string,
    args: unknown[],
    entityType: PendingEntityType,
    confirmation: ConfirmationDescriptor,
    optimisticData: Record<string, unknown> = {},
    value?: bigint,
  ) {
    if (!address) return false;
    const result = await transaction.execute({
      label,
      method,
      entityType,
      entityKey: id,
      optimisticData,
      confirmation,
      submit: (lifecycle) =>
        submitContract(address, method, args, value, lifecycle),
    });
    return result.submitted;
  }
  if (!isJobId(id))
    return (
      <AppShell>
        <section className="section container">
          <EmptyState
            title="Invalid job ID"
            description="Use a positive numeric job ID without a label or prefix."
            action={
              <Link className="button secondary" href="/dashboard">
                Open dashboard
              </Link>
            }
          />
        </section>
      </AppShell>
    );
  if (loading)
    return (
      <AppShell>
        <section className="section container">
          <SkeletonGrid count={3} />
        </section>
      </AppShell>
    );
  if (loadError || !j?.found)
    return (
      <AppShell>
        <section className="section container">
          <EmptyState
            title={`Job #${id} not found`}
            description="The accepted contract state did not return this job. Check the ID or try again after finalization."
            action={
              <Link className="button secondary" href="/dashboard">
                Open dashboard
              </Link>
            }
          />
        </section>
      </AppShell>
    );
  const status = j.status || "UNKNOWN";
  const client = address?.toLowerCase() === j.client?.toLowerCase();
  const freelancer = address?.toLowerCase() === j.freelancer?.toLowerCase();
  const balance = BigInt(j.escrow_balance || "0");
  const stages = [
    "OPEN",
    "FUNDED",
    "SUBMITTED",
    status === "DISPUTED" || status === "REFUNDED"
      ? "DISPUTED"
      : status === "CANCELLED"
        ? "CANCELLED"
        : "PAID",
  ];
  const stage = status === "REFUNDED" ? 3 : stages.indexOf(status);
  const canFund = client && status === "OPEN";
  const canSubmit = freelancer && status === "FUNDED";
  const canVerify = client && status === "SUBMITTED";
  const canRefund = client && ["FUNDED", "DISPUTED"].includes(status);
  const canCancel = client && status === "OPEN";
  const validAmount = Number(amount) > 0 && Number.isFinite(Number(amount));
  const hasAction = canFund || canSubmit || canVerify || canRefund || canCancel;
  return (
    <AppShell>
      <section className="section container">
        <div className="job-header">
          <div>
            <p className="eyebrow">Job #{id} · Accepted contract state</p>
            <h1>{j.title || `Job #${id}`}</h1>
            <p className="page-lede">
              {explanation[status] ||
                "This job returned an unknown contract status."}
            </p>
          </div>
          <StatusBadge status={status} />
        </div>
        <div className="lifecycle" style={{ margin: "30px 0" }}>
          {stages.map((s, i) => (
            <div
              className={`life-step ${stage >= i ? "active" : ""}`}
              key={`${s}-${i}`}
            >
              <span>{stage >= i ? "✓" : i + 1}</span>
              {s}
            </div>
          ))}
        </div>
        <div className="job-layout">
          <div className="job-main">
            <article className="card job-panel">
              <p className="eyebrow">Scope & requirements</p>
              <p className="job-description">
                {j.description || "No description was stored."}
              </p>
            </article>
            <article className="panel job-panel">
              <p className="eyebrow">Participants</p>
              <div className="detail-grid">
                <div className="detail">
                  <span>Client</span>
                  <strong>{j.client_name || "Client wallet"}</strong>
                  <Address value={j.client || ""} />
                </div>
                <div className="detail">
                  <span>Freelancer</span>
                  <strong>{j.freelancer_name || "Freelancer wallet"}</strong>
                  <Address value={j.freelancer || ""} />
                </div>
              </div>
            </article>
            {j.deliverable_url && (
              <article className="panel job-panel">
                <p className="eyebrow">Public deliverable evidence</p>
                <a
                  href={j.deliverable_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--cyan)", overflowWrap: "anywhere" }}
                >
                  {j.deliverable_url} ↗
                </a>
              </article>
            )}
            {j.ai_verdict && (
              <article className="panel job-panel">
                <div className="job-header">
                  <div>
                    <p className="eyebrow">AI-assisted verification</p>
                    <h2>{j.ai_verdict}</h2>
                  </div>
                  {j.ai_score && <strong>{j.ai_score}/100</strong>}
                </div>
                {j.ai_reasoning && (
                  <p className="job-description" style={{ marginTop: 18 }}>
                    {j.ai_reasoning}
                  </p>
                )}
                {j.ai_evidence_summary && (
                  <div className="notice info">
                    <div>
                      <strong>Evidence summary</strong>
                      <p>{j.ai_evidence_summary}</p>
                    </div>
                  </div>
                )}
                <p className="field-hint" style={{ marginTop: 18 }}>
                  This is an AI-assisted contract outcome, not legal arbitration
                  or proof of objective truth.
                </p>
              </article>
            )}
            <article className="panel job-panel">
              <p className="eyebrow">Contract timestamps</p>
              <div className="detail-grid">
                {[
                  ["Created", j.created_at],
                  ["Funded", j.funded_at],
                  ["Submitted", j.submitted_at],
                  ["Resolved", j.resolved_at],
                ].map(([k, v]) => (
                  <div className="detail" key={k}>
                    <span>{k}</span>
                    <strong>
                      {v ? new Date(v).toLocaleString() : "Not reached"}
                    </strong>
                  </div>
                ))}
              </div>
            </article>
          </div>
          <aside>
            <div className="card sidebar-card">
              <p className="eyebrow">Escrow balance</p>
              <strong className="price">{formatGEN(balance)}</strong>
              <p>
                {balance > 0n
                  ? "Locked in the deployed contract."
                  : "No GEN currently held for this job."}
              </p>
              <div className="detail" style={{ marginBottom: 18 }}>
                <span>Deadline</span>
                <strong>{j.deadline || "Not specified"}</strong>
              </div>
              {!address && (
                <div className="notice info">
                  <div>
                    <strong>Connect the assigned wallet</strong>
                    <p>
                      Contract actions appear only for the client or freelancer
                      recorded on this job.
                    </p>
                  </div>
                </div>
              )}
              {hasAction && (
                <div className="form-stack">
                  {canFund && (
                    <div className="action-card panel">
                      <h2>Fund escrow</h2>
                      <p>
                        Enter the agreed amount. This calls payable fund_job.
                      </p>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.001"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="GEN amount"
                      />
                      <button
                        className="button primary"
                        disabled={!validAmount || transaction.pending || jobActionPending}
                        style={{ width: "100%", marginTop: 10 }}
                        onClick={() => {
                          const expected = parseEther(amount as `${number}`);
                          void act(
                            "Fund escrow",
                            "fund_job",
                            [id],
                            "funding",
                            { kind: "job_state", jobId: id, statuses: ["FUNDED"], balance: expected.toString() },
                            { amount: expected.toString() },
                            expected,
                          );
                        }}
                      >
                        Lock GEN
                      </button>
                    </div>
                  )}
                  {canSubmit && (
                    <div className="action-card panel">
                      <h2>Submit work</h2>
                      <p>Provide a public, accessible evidence URL.</p>
                      <input
                        className="input"
                        value={url}
                        onChange={(e) =>
                          setUrl(
                            e.target.value.replace(
                              /^\s*deliverable_url\s*:\s*/i,
                              "",
                            ),
                          )
                        }
                        placeholder="https://..."
                        aria-invalid={Boolean(url && !isPublicUrl(url))}
                        aria-describedby="deliverable-error"
                      />
                      {url && !isPublicUrl(url) && (
                        <span className="field-error" id="deliverable-error">
                          Enter a complete public URL.
                        </span>
                      )}
                      <button
                        className="button primary"
                        disabled={!isPublicUrl(url) || transaction.pending || jobActionPending}
                        style={{ width: "100%", marginTop: 10 }}
                        onClick={() => {
                          const expectedUrl = url.trim();
                          void act(
                            "Submit work",
                            "submit_work",
                            [id, expectedUrl],
                            "submission",
                            { kind: "job_state", jobId: id, statuses: ["SUBMITTED"], deliverableUrl: expectedUrl },
                            { deliverableUrl: expectedUrl },
                          );
                        }}
                      >
                        Submit evidence
                      </button>
                    </div>
                  )}
                  {canVerify && (
                    <div className="action-card panel">
                      <h2>Verify & settle</h2>
                      <p>
                        Independent validators evaluate public evidence against
                        the stored scope. Approval releases GEN; rejection marks
                        the job disputed.
                      </p>
                      <button
                        className="button primary"
                        disabled={transaction.pending || jobActionPending}
                        onClick={() =>
                          void act(
                            "AI-assisted verification",
                            "verify_and_release",
                            [id],
                            "settlement",
                            { kind: "job_state", jobId: id, statuses: ["PAID", "DISPUTED"] },
                          )
                        }
                      >
                        Start verification
                      </button>
                    </div>
                  )}
                  {canRefund && (
                    <button
                      className="button danger"
                      disabled={transaction.pending || jobActionPending}
                      onClick={() =>
                        void act(
                          "Refund escrow",
                          "client_refund",
                          [id],
                          "settlement",
                          { kind: "job_state", jobId: id, statuses: ["REFUNDED"], balance: "0" },
                        )
                      }
                    >
                      Refund escrowed GEN
                    </button>
                  )}
                  {canCancel && (
                    <button
                      className="button secondary"
                      disabled={transaction.pending || jobActionPending}
                      onClick={() =>
                        void act(
                          "Cancel job",
                          "cancel_job",
                          [id],
                          "settlement",
                          { kind: "job_state", jobId: id, statuses: ["CANCELLED"] },
                        )
                      }
                    >
                      Cancel unfunded job
                    </button>
                  )}
                </div>
              )}
              {terminal.includes(status) && (
                <div className="notice success">
                  <div>
                    <strong>Job lifecycle complete</strong>
                    <p>
                      No further contract actions are available in this state.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}
