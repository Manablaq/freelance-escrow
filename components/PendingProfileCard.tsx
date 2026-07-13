"use client";

import { useAccount } from "wagmi";
import { useTransactions } from "./TransactionProvider";
import { shortAddress } from "@/lib/genlayer";

export function PendingProfileCard({ fallback }: { fallback: React.ReactNode }) {
  const { address } = useAccount();
  const { getPendingEntity, dismissTransaction } = useTransactions();
  const transaction = address
    ? getPendingEntity("profile", address.toLowerCase())
    : undefined;
  if (!transaction) return fallback;
  const data = transaction.optimisticData;
  const failed = ["failed", "canceled", "undetermined"].includes(transaction.phase);
  return (
    <article className={`card profile-card optimistic-profile ${failed ? "failed" : ""}`}>
      <div className="profile-head">
        <div className="avatar">{String(data.name || "?")[0].toUpperCase()}</div>
        <div><h2>{String(data.name || "Pending profile")}</h2><span className={`pending-badge ${failed ? "failed" : ""}`}>{failed ? "Failed" : "Pending"}</span></div>
      </div>
      <p>{failed ? transaction.failureMessage : "Your profile was signed and submitted. GenLayer consensus is continuing in the background; this card is not finalized."}</p>
      <code>{shortAddress(transaction.hash)}</code>
      <div className="tx-item-actions">
        <a href={`https://explorer-bradbury.genlayer.com/transactions/${transaction.hash}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>
        {failed && <button onClick={() => dismissTransaction(transaction.id)}>Dismiss</button>}
      </div>
    </article>
  );
}
