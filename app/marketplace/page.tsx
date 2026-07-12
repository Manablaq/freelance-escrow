"use client";
/* eslint-disable react-hooks/exhaustive-deps -- normalized contract arrays intentionally derive from polling results */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AppShell,
  EmptyState,
  PageHeader,
  SkeletonGrid,
} from "@/components/AppShell";
import { getAllFreelancers, shortAddress, type Profile } from "@/lib/genlayer";
import { usePolling } from "@/hooks/usePolling";

const skills = (p: Profile) =>
  (p.skills || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
export default function Marketplace() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState("all");
  const [sort, setSort] = useState("name");
  const fetcher = useCallback(() => getAllFreelancers(), []);
  const { data, loading, error, refetch } = usePolling(fetcher, 10000);
  const all = Array.isArray(data) ? data : [];
  const skillOptions = useMemo(
    () => Array.from(new Set(all.flatMap(skills))).sort(),
    [all],
  );
  const shown = useMemo(
    () =>
      all
        .filter(
          (p) =>
            (!search ||
              [p.name, p.bio, p.skills]
                .join(" ")
                .toLowerCase()
                .includes(search.toLowerCase())) &&
            (skill === "all" || skills(p).includes(skill)),
        )
        .sort((a, b) =>
          sort === "rate"
            ? Number(a.rate || 0) - Number(b.rate || 0)
            : (a.name || "").localeCompare(b.name || ""),
        ),
    [all, search, skill, sort],
  );
  return (
    <AppShell>
      <section className="section container">
        <PageHeader
          eyebrow="Talent marketplace"
          title={
            <>
              Find specialists who <span className="gradient-text">ship.</span>
            </>
          }
          description="Browse freelancer profiles registered on the FreelanceMarket contract. Hire directly into a transparent escrow workflow."
        />
        <div className="toolbar">
          <div className="search-wrap">
            <span>⌕</span>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, skill, or profile details"
              aria-label="Search freelancers"
            />
          </div>
          <select
            className="input"
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            aria-label="Filter by skill"
          >
            <option value="all">All skills</option>
            {skillOptions.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            className="input"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort freelancers"
          >
            <option value="name">Name A–Z</option>
            <option value="rate">Rate: low first</option>
          </select>
        </div>
        {loading ? (
          <SkeletonGrid />
        ) : error ? (
          <EmptyState
            title="Marketplace unavailable"
            description="The accepted contract state could not be loaded. Your wallet and contract data have not been changed."
            action={
              <button
                className="button secondary"
                onClick={() => void refetch()}
              >
                Try again
              </button>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title={
              search || skill !== "all"
                ? "No matching freelancers"
                : "No freelancer profiles yet"
            }
            description={
              search || skill !== "all"
                ? "Adjust your search or skill filter to see more profiles."
                : "Freelancer profiles will appear here after on-chain registration."
            }
            action={
              !search && skill === "all" ? (
                <button
                  className="button primary"
                  onClick={() => router.push("/register")}
                >
                  Create a freelancer profile
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="card-grid">
              {shown.map((p, i) => (
                <article
                  className="card profile-card"
                  key={p.address || i}
                >
                <div className="profile-head">
                  <div className="avatar">
                    {(p.name?.[0] || "?").toUpperCase()}
                  </div>
                  <div>
                    <h2>{p.name || "Unnamed freelancer"}</h2>
                    <code>{shortAddress(p.address || "")}</code>
                  </div>
                </div>
                <p>
                  {p.bio || "No professional summary has been provided yet."}
                </p>
                <div className="skills">
                  {skills(p)
                    .slice(0, 4)
                    .map((s) => (
                      <span className="skill" key={s}>
                        {s}
                      </span>
                    ))}
                  {skills(p).length > 4 && (
                    <span className="skill">+{skills(p).length - 4}</span>
                  )}
                </div>
                <div className="profile-foot">
                  <div>
                    <strong>{p.rate || "—"} GEN</strong>
                    <span>
                      {p.rate_type ? `per ${p.rate_type}` : "Rate type not set"}
                    </span>
                  </div>
                    <button
                      className="button secondary compact"
                      onClick={() => router.push(`/freelancer/${p.address}`)}
                  >
                    View profile
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
