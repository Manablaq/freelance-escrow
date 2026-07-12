"use client";
import { useState } from "react";
import { shortAddress } from "@/lib/genlayer";
import type { TransactionState } from "@/hooks/useTransactionSync";

export function Address({
  value,
  label,
  explorer = true,
}: {
  value: string;
  label?: string;
  explorer?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <span className="address-wrap">
      {label && <span>{label}</span>}
      <code title={value}>{shortAddress(value)}</code>
      <button
        type="button"
        className="icon-button"
        onClick={copy}
        aria-label={`Copy ${label || "address"}`}
      >
        {copied ? "✓" : "Copy"}
      </button>
      {explorer && (
        <a
          className="icon-button"
          href={`https://explorer-bradbury.genlayer.com/address/${value}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View in explorer"
        >
          ↗
        </a>
      )}
    </span>
  );
}

const phaseTitle: Record<TransactionState["phase"], string> = {
  idle: "",
  preparing: "Preparing transaction",
  wallet: "Waiting for wallet confirmation",
  submitted: "Transaction submitted",
  receipt_pending: "Waiting for GenLayer accepted status",
  receipt_unknown: "Transaction receipt status unavailable",
  accepted: "Accepted by GenLayer",
  refreshing: "Synchronizing contract data",
  confirmed: "Accepted state confirmed",
  sync_timeout: "Confirmation is taking longer",
  rejected: "Wallet request cancelled",
  submission_error: "Transaction submission failed",
  execution_error: "Contract execution finished with an error",
  canceled: "Transaction canceled",
  undetermined: "Transaction outcome undetermined",
};
export function TransactionTracker({
  state,
  onRetry,
}: {
  state: TransactionState;
  onRetry?: () => void;
}) {
  if (state.phase === "idle") return null;
  const danger = ["rejected", "submission_error", "execution_error"].includes(
    state.phase,
  );
  const success = state.phase === "confirmed";
  const waiting = ["sync_timeout", "receipt_pending", "receipt_unknown"].includes(
    state.phase,
  );
  const unresolvedTerminal = ["canceled", "undetermined"].includes(state.phase);
  return (
    <div
      className={`notice ${danger ? "danger" : success ? "success" : "info"}`}
      role={danger ? "alert" : "status"}
      aria-live="polite"
    >
      {!danger && !success && !waiting && !unresolvedTerminal && (
        <span className="spinner" />
      )}
      <div>
        <strong>{phaseTitle[state.phase]}</strong>
        <p>{state.message}</p>
        {state.hash && (
          <a
            href={`https://explorer-bradbury.genlayer.com/transactions/${state.hash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View transaction in explorer ↗
          </a>
        )}
        {waiting && onRetry && (
          <button
            className="button secondary compact"
            style={{ marginTop: 10 }}
            onClick={onRetry}
          >
            Check accepted state again
          </button>
        )}
        {state.phase === "sync_timeout" && (
          <p>
            The transaction was not reported as failed. Retrying only checks
            accepted contract state and will never resubmit it.
          </p>
        )}
        {["receipt_pending", "receipt_unknown"].includes(state.phase) && (
          <p>
            The transaction hash exists and the transaction was not reported as
            failed. Retrying checks this hash only and never submits another
            transaction.
          </p>
        )}
      </div>
    </div>
  );
}
