"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { CONTRACT_ADDRESS } from "@/lib/config";
import type { WriteLifecycleCallbacks } from "@/lib/genlayer";
import type {
  ConfirmationDescriptor,
  PendingEntityType,
} from "@/lib/pending-transactions";
import { isUnfinished } from "@/lib/pending-transactions";
import { useTransactions } from "@/components/TransactionProvider";
import { submitUntilHash } from "@/lib/transaction-submission";

export type TransactionPhase =
  | "idle"
  | "preparing"
  | "wallet"
  | "submitted"
  | "receipt_pending"
  | "receipt_unknown"
  | "accepted"
  | "refreshing"
  | "confirmed"
  | "sync_timeout"
  | "rejected"
  | "submission_error"
  | "execution_error"
  | "canceled"
  | "undetermined";
export type TransactionFailureKind = "wallet_rejected" | "submission_failed";
export type TransactionState = {
  phase: TransactionPhase;
  label: string;
  hash?: string;
  message?: string;
  attempt: number;
  failureKind?: TransactionFailureKind;
};
export type TransactionRequest = {
  label: string;
  method: string;
  entityType: PendingEntityType;
  entityKey: string;
  optimisticData?: Record<string, unknown>;
  confirmation: ConfirmationDescriptor;
  prepare?: () => Promise<void>;
  submit: (lifecycle: WriteLifecycleCallbacks) => Promise<string>;
  onSubmitted?: (hash: string) => void;
};

const initial: TransactionState = { phase: "idle", label: "", attempt: 0 };

export function useTransactionSync(scopeKey: string) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { addSubmittedTransaction, activeTransactions, retryReceiptPolling } =
    useTransactions();
  const [state, setState] = useState<TransactionState>(initial);
  void scopeKey;
  const executing = useRef(false);
  const lastId = useRef("");

  const execute = useCallback(
    async (request: TransactionRequest) => {
      if (executing.current || !address) return { submitted: false as const };
      const conflict = activeTransactions.some(
        (tx) =>
          tx.entityKey === request.entityKey &&
          isUnfinished(tx),
      );
      if (conflict) return { submitted: false as const };
      executing.current = true;
      setState({ phase: "preparing", label: request.label, attempt: 0, message: "Preparing the contract request." });
      let hash: string | undefined;
      try {
        await request.prepare?.();
        hash = await submitUntilHash(request.submit, {
          onAwaitingWallet: () => setState({ phase: "wallet", label: request.label, attempt: 0, message: "Confirm the transaction in your wallet." }),
          onSubmitted: (submittedHash) => {
            hash = submittedHash;
            const tx = addSubmittedTransaction({
              hash: submittedHash,
              walletAddress: address,
              chainId,
              contractAddress: CONTRACT_ADDRESS,
              method: request.method,
              label: request.label,
              entityType: request.entityType,
              entityKey: request.entityKey,
              optimisticData: request.optimisticData || {},
              confirmation: request.confirmation,
            });
            lastId.current = tx.id;
            setState({ phase: "submitted", label: request.label, hash: submittedHash, attempt: 0, message: "Submitted. GenLayer consensus is continuing in the background." });
            request.onSubmitted?.(submittedHash);
          },
        });
        executing.current = false;
        return { submitted: true as const, hash };
      } catch (error) {
        executing.current = false;
        const raw = error instanceof Error ? error.message : "The transaction could not be submitted.";
        const rejected = /user rejected|rejected the request|denied/i.test(raw);
        setState({
          phase: rejected ? "rejected" : "submission_error",
          label: request.label,
          hash,
          attempt: 0,
          message: rejected ? "The wallet request was cancelled. No transaction was submitted." : raw,
          failureKind: rejected ? "wallet_rejected" : "submission_failed",
        });
        return { submitted: false as const };
      }
    },
    [activeTransactions, addSubmittedTransaction, address, chainId],
  );
  const retry = useCallback(async () => {
    if (!lastId.current) return false;
    retryReceiptPolling(lastId.current);
    return true;
  }, [retryReceiptPolling]);
  const reset = useCallback(() => setState(initial), []);
  useEffect(() => {
    if (state.phase !== "submitted") return;
    const id = window.setTimeout(() => setState(initial), 2500);
    return () => window.clearTimeout(id);
  }, [state.phase]);
  return {
    state,
    execute,
    retry,
    reset,
    pending: ["preparing", "wallet"].includes(state.phase),
  };
}
