"use client";
import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { AppShell, PageHeader } from "@/components/AppShell";
import {
  getProfile,
  isPublicUrl,
  checkTransactionReceipt,
  writeContract,
} from "@/lib/genlayer";
import { useTransactionSync } from "@/hooks/useTransactionSync";

type Role = "client" | "freelancer";
const initial = {
  name: "",
  bio: "",
  skills: "",
  rate: "",
  rate_type: "fixed",
  portfolio: "",
  twitter: "",
  github: "",
};
export default function Register() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [role, setRole] = useState<Role | null>(null);
  const [form, setForm] = useState(initial);
  const transaction = useTransactionSync(address || "disconnected");
  const set = (k: keyof typeof form, v: string) =>
    setForm((x) => ({ ...x, [k]: v }));
  const validName = form.name.trim().length >= 2;
  const validRate = form.rate !== "" && Number(form.rate) >= 0;
  const valid =
    !!role &&
    validName &&
    (role === "client" || (form.skills.trim().length > 0 && validRate)) &&
    (!form.portfolio || isPublicUrl(form.portfolio));
  async function submit() {
    if (!address || !role || !valid) return;
    await transaction.execute({
      label: "Register profile",
      checkReceipt: (hash) => checkTransactionReceipt(address, hash),
      submit: (lifecycle) =>
        writeContract(
          address,
          "register",
          [
            role,
            form.name.trim(),
            form.bio.trim(),
            form.skills.trim(),
            form.rate,
            form.rate_type,
            form.portfolio.trim(),
            form.twitter.trim(),
            form.github.trim(),
          ],
          undefined,
          lifecycle,
        ),
      confirm: async (signal) => {
        const profile = await getProfile(address, signal);
        return Boolean(profile?.found) && profile.role === role;
      },
    });
  }
  return (
    <AppShell>
      <section className="section container">
        <PageHeader
          eyebrow="On-chain onboarding"
          title={
            <>
              Create your{" "}
              <span className="gradient-text">market identity.</span>
            </>
          }
          description="Choose one role for this wallet. Your profile fields are written to the FreelanceMarket contract exactly as shown."
        />
        {!isConnected ? (
          <div className="empty-card">
            <span className="empty-icon">◇</span>
            <h2>Connect a wallet to continue</h2>
            <p>
              Use a wallet configured for GenLayer Bradbury (chain ID 4221).
              Registration requires a wallet confirmation.
            </p>
            <button className="button primary" onClick={openConnectModal}>
              Connect wallet
            </button>
          </div>
        ) : transaction.state.phase === "confirmed" ? (
          <div className="empty-card">
            <span className="empty-icon">✓</span>
            <h2>Profile accepted on-chain</h2>
            <p>
              Your {role} profile is ready. Accepted-state reads may take a
              moment to appear throughout the app.
            </p>
            <Link
              className="button primary"
              href={role === "client" ? "/marketplace" : "/dashboard"}
            >
              {role === "client" ? "Find a freelancer" : "Open dashboard"}
            </Link>
          </div>
        ) : (
          <div className="split-grid">
            <div>
              <p className="eyebrow">1 · Choose a role</p>
              <div className="form-stack">
                {[
                  {
                    r: "client" as Role,
                    title: "Client",
                    desc: "Create jobs, fund escrow, request verification, and use available refund or cancellation paths.",
                  },
                  {
                    r: "freelancer" as Role,
                    title: "Freelancer",
                    desc: "Publish skills and rates, receive assigned work, submit evidence, and track settlement.",
                  },
                ].map((x) => (
                  <button
                    key={x.r}
                    className={`card value-card role-card ${role === x.r ? "selected" : ""}`}
                    style={{
                      textAlign: "left",
                      cursor: "pointer",
                      borderColor: role === x.r ? "var(--violet)" : undefined,
                    }}
                    onClick={() => setRole(x.r)}
                  >
                    <p className="eyebrow">
                      {x.r === "client" ? "Hire talent" : "Offer services"}
                    </p>
                    <h3>{x.title}</h3>
                    <p>{x.desc}</p>
                  </button>
                ))}
              </div>
              <div className="notice info">
                <div>
                  <strong>One role per wallet.</strong>
                  <p>
                    The current contract registers a wallet as either client or
                    freelancer; the frontend cannot switch or combine roles.
                  </p>
                </div>
              </div>
            </div>
            <div className="card profile-panel">
              <p className="eyebrow">2 · Profile details</p>
              <div className="form-stack">
                <div className="field">
                  <label htmlFor="name">Display name *</label>
                  <input
                    id="name"
                    className="input"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="e.g. Ada Studio"
                    maxLength={80}
                    required
                  />
                  <span className="field-hint">
                    At least 2 characters · {form.name.length}/80
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="bio">Professional summary</label>
                  <textarea
                    id="bio"
                    className="input"
                    value={form.bio}
                    onChange={(e) => set("bio", e.target.value)}
                    placeholder={
                      role === "client"
                        ? "What kind of work do you commission?"
                        : "What do you do best, and what outcomes do you deliver?"
                    }
                    maxLength={600}
                  />
                  <span className="field-hint">{form.bio.length}/600</span>
                </div>
                {role === "freelancer" && (
                  <>
                    <div className="field">
                      <label htmlFor="skills">Skills *</label>
                      <input
                        id="skills"
                        className="input"
                        value={form.skills}
                        onChange={(e) => set("skills", e.target.value)}
                        placeholder="Product design, React, Solidity"
                        required
                      />
                      <span className="field-hint">
                        Comma-separated skills become marketplace filters.
                      </span>
                    </div>
                    <div className="form-grid">
                      <div className="field">
                        <label htmlFor="rate">Rate in GEN *</label>
                        <input
                          id="rate"
                          type="number"
                          min="0"
                          className="input"
                          value={form.rate}
                          onChange={(e) => set("rate", e.target.value)}
                          placeholder="10"
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="rateType">Rate type</label>
                        <select
                          id="rateType"
                          className="input"
                          value={form.rate_type}
                          onChange={(e) => set("rate_type", e.target.value)}
                        >
                          <option value="fixed">Fixed</option>
                          <option value="hourly">Hourly</option>
                        </select>
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor="portfolio">Portfolio URL</label>
                      <input
                        id="portfolio"
                        className="input"
                        value={form.portfolio}
                        onChange={(e) => set("portfolio", e.target.value)}
                        placeholder="https://portfolio.example"
                        aria-invalid={Boolean(
                          form.portfolio && !isPublicUrl(form.portfolio),
                        )}
                        aria-describedby="portfolio-error"
                      />
                      {form.portfolio && !isPublicUrl(form.portfolio) && (
                        <span className="field-error" id="portfolio-error">
                          Enter a complete http:// or https:// URL.
                        </span>
                      )}
                    </div>
                    <div className="form-grid">
                      <div className="field">
                        <label htmlFor="twitter">X / Twitter handle</label>
                        <input
                          id="twitter"
                          className="input"
                          value={form.twitter}
                          onChange={(e) => set("twitter", e.target.value)}
                          placeholder="@handle"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="github">GitHub username</label>
                        <input
                          id="github"
                          className="input"
                          value={form.github}
                          onChange={(e) => set("github", e.target.value)}
                          placeholder="username"
                        />
                      </div>
                    </div>
                  </>
                )}
                <button
                  className="button primary"
                  disabled={!valid || transaction.pending}
                  onClick={() => void submit()}
                >
                  {transaction.pending ? (
                    <>
                      <span className="spinner" />
                      Registering profile
                    </>
                  ) : (
                    "Create on-chain profile"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}
