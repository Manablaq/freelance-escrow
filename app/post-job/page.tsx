"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Address } from "@/components/Web3UI";
import { Modal } from "@/components/Modal";
import {
  getJobsByClient,
  getProfile,
  isAddress,
  submitContract,
  type Profile,
} from "@/lib/genlayer";
import { useTransactionSync } from "@/hooks/useTransactionSync";
import { useTransactions } from "@/components/TransactionProvider";

function Form() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const router = useRouter();
  const params = useSearchParams();
  const [profile, setProfile] = useState<Profile | null | undefined>();
  const [freelancer, setFreelancer] = useState(params.get("freelancer") || "");
  const [name] = useState(params.get("name") || "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [review, setReview] = useState(false);
  const transaction = useTransactionSync(address || "disconnected");
  const { hasPendingEntityKey } = useTransactions();
  const createPending = Boolean(address && hasPendingEntityKey(`create:${address.toLowerCase()}`));
  useEffect(() => {
    if (!address) return;
    getProfile(address)
      .then((p) => setProfile(p?.found ? p : null))
      .catch(() => setProfile(null));
  }, [address]);
  const valid =
    title.trim().length >= 3 &&
    description.trim().length >= 20 &&
    deadline.trim() !== "" &&
    isAddress(freelancer) &&
    freelancer.toLowerCase() !== address?.toLowerCase();
  async function submit() {
    if (!address || !valid) return;
    const existing = await getJobsByClient(address);
    const knownJobIds = existing.map((job) => job.job_id || "");
    await transaction.execute({
      label: "Create job",
      method: "create_job",
      entityType: "job",
      entityKey: `create:${address.toLowerCase()}`,
      optimisticData: { title: title.trim(), description: description.trim(), freelancer: freelancer.trim(), deadline: deadline.trim() },
      confirmation: { kind: "create_job", knownJobIds, expected: { client: address.toLowerCase(), freelancer: freelancer.trim().toLowerCase(), title: title.trim(), description: description.trim(), deadline: deadline.trim() } },
      submit: (lifecycle) =>
        submitContract(
          address,
          "create_job",
          [
            title.trim(),
            description.trim(),
            freelancer.trim(),
            deadline.trim(),
          ],
          undefined,
          lifecycle,
        ),
      onSubmitted: () => { setReview(false); router.push("/dashboard"); },
    });
  }
  if (!isConnected)
    return (
      <div className="empty-card">
        <h2>Connect a client wallet</h2>
        <p>
          Job creation is available to registered client wallets on Bradbury.
        </p>
        <button className="button primary" onClick={openConnectModal}>
          Connect wallet
        </button>
      </div>
    );
  if (profile === undefined) return <div className="skeleton-card" />;
  if (!profile)
    return (
      <div className="empty-card">
        <h2>Register before posting</h2>
        <p>This wallet has no accepted on-chain profile.</p>
        <Link className="button primary" href="/register">
          Create client profile
        </Link>
      </div>
    );
  if (profile.role !== "client")
    return (
      <div className="empty-card">
        <h2>A client wallet is required</h2>
        <p>
          This wallet is registered as a freelancer. Contract permissions do not
          allow it to create jobs.
        </p>
        <Link className="button secondary" href="/dashboard">
          Return to dashboard
        </Link>
      </div>
    );
  return (
    <div className="job-layout">
      <div className="card profile-panel">
        <div className="form-stack">
          <div className="field">
            <label htmlFor="title">Job title *</label>
            <input
              id="title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              placeholder="e.g. Design and implement a responsive checkout"
              required
            />
            <span className="field-hint">
              Be specific enough to identify the outcome · {title.length}/100
            </span>
          </div>
          <div className="field">
            <label htmlFor="description">
              Scope and acceptance requirements *
            </label>
            <textarea
              id="description"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the deliverable, required behavior, evidence, and objective acceptance checks."
              required
              maxLength={1000}
            />
            <span className="field-hint">
              Minimum 20 characters. The contract stores this as the description
              and uses it as verification criteria.
            </span>
          </div>
          <div className="field">
            <label htmlFor="deadline">Deadline *</label>
            <input
              id="deadline"
              className="input"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              placeholder="e.g. 2026-08-15 or agreed milestone date"
              required
              maxLength={30}
            />
            <span className="field-hint">
              The contract stores the exact text entered here.
            </span>
          </div>
          <div className="field">
            <label htmlFor="freelancer">Freelancer wallet *</label>
            <input
              id="freelancer"
              className="input"
              value={freelancer}
              onChange={(e) => setFreelancer(e.target.value)}
              placeholder="0x..."
              required
              aria-invalid={Boolean(freelancer && !isAddress(freelancer))}
              aria-describedby="freelancer-error freelancer-hint"
            />
            <span className="field-hint" id="freelancer-hint">
              {name
                ? `Selected from ${name}’s marketplace profile.`
                : "Choose a registered freelancer from the marketplace or enter their address."}
            </span>
            {freelancer && !isAddress(freelancer) && (
              <span className="field-error" id="freelancer-error">
                Enter a valid 42-character wallet address.
              </span>
            )}
          </div>
          <button
            className="button primary"
            disabled={!valid || createPending}
            onClick={() => setReview(true)}
          >
            Review job
          </button>
        </div>
      </div>
      <aside>
        <div className="card sidebar-card">
          <p className="eyebrow">Before you create</p>
          <ul className="feature-list">
            <li>Creation does not move funds</li>
            <li>Funding happens on the job page</li>
            <li>Public URLs are required for submission</li>
            <li>Verification may release or dispute escrow</li>
          </ul>
          <div className="notice info">
            <div>
              <strong>Bradbury testnet</strong>
              <p>
                This workflow uses testnet GEN and the source-verified deployed
                contract.
              </p>
            </div>
          </div>
        </div>
      </aside>
      {review && (
        <Modal
          titleId="review-title"
          closeDisabled={transaction.pending}
          onClose={() => setReview(false)}
        >
            <p className="eyebrow">Final review</p>
            <h2 id="review-title">Create this job?</h2>
            <div className="form-stack" style={{ marginTop: 20 }}>
              <div className="detail">
                <span>Title</span>
                <strong>{title}</strong>
              </div>
              <div className="detail">
                <span>Freelancer</span>
                <Address value={freelancer} />
              </div>
              <div className="detail">
                <span>Deadline</span>
                <strong>{deadline}</strong>
              </div>
              <div className="detail">
                <span>Stored scope</span>
                <p className="job-description">{description}</p>
              </div>
              <div
                className="form-actions"
                style={{ display: "flex", gap: 10 }}
              >
                <button
                  className="button secondary"
                  disabled={transaction.pending || createPending}
                  onClick={() => setReview(false)}
                >
                  Keep editing
                </button>
                <button
                  className="button primary"
                  disabled={transaction.pending}
                  onClick={() => void submit()}
                >
                  {transaction.pending ? (
                    <>
                      <span className="spinner" />
                      Creating job
                    </>
                  ) : (
                    "Confirm job creation"
                  )}
                </button>
              </div>
            </div>
        </Modal>
      )}
    </div>
  );
}
export default function PostJob() {
  return (
    <AppShell>
      <section className="section container">
        <PageHeader
          eyebrow="Client workspace"
          title={
            <>
              Create a <span className="gradient-text">clear engagement.</span>
            </>
          }
          description="Write one verifiable scope, assign one registered freelancer, and review the exact contract inputs before submitting."
        />
        <Suspense fallback={<div className="skeleton-card" />}>
          <Form />
        </Suspense>
      </section>
    </AppShell>
  );
}
