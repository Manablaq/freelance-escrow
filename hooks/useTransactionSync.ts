"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TX_TIMEOUT_MS, type WriteLifecycleCallbacks } from "@/lib/genlayer";
import {
  shouldConfirmExpectedState,
  type ReceiptCheckResult,
} from "@/lib/receipt-classifier";
import { canApplyScopeResult } from "@/lib/transaction-scope.mjs";
import { retryExistingTransaction } from "@/lib/transaction-retry";

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
export type TransactionFailureKind =
  | "wallet_rejected"
  | "submission_failed"
  | "execution_failed";
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
  prepare?: () => Promise<void>;
  submit: (lifecycle: WriteLifecycleCallbacks) => Promise<ReceiptCheckResult>;
  checkReceipt: (hash: string) => Promise<ReceiptCheckResult>;
  confirm: (signal: AbortSignal) => Promise<boolean>;
  timeoutMs?: number;
};

const initial: TransactionState = { phase: "idle", label: "", attempt: 0 };
const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

function receiptState(
  result: Exclude<ReceiptCheckResult, { kind: "executed" }>,
  label: string,
  attempt: number,
): TransactionState {
  if (result.kind === "processing") {
    return {
      phase: "receipt_pending",
      label,
      hash: result.hash,
      attempt,
      message: "Your transaction is still being processed by GenLayer.",
    };
  }
  if (result.kind === "execution_failed") {
    return {
      phase: "execution_error",
      label,
      hash: result.hash,
      attempt,
      message:
        "GenLayer accepted the transaction record, but contract execution finished with an error. No expected state change was confirmed.",
      failureKind: "execution_failed",
    };
  }
  if (result.kind === "canceled") {
    return {
      phase: "canceled",
      label,
      hash: result.hash,
      attempt,
      message: "This transaction was canceled before successful execution.",
    };
  }
  if (result.kind === "undetermined") {
    return {
      phase: "undetermined",
      label,
      hash: result.hash,
      attempt,
      message:
        "GenLayer did not reach a resolved outcome for this transaction.",
    };
  }
  return {
    phase: "receipt_unknown",
    label,
    hash: result.hash,
    attempt,
    message:
      "Your transaction was submitted, but its current status could not be retrieved. It was not reported as failed.",
  };
}

export function useTransactionSync(scopeKey: string) {
  const [state, setState] = useState<TransactionState>(initial);
  const controller = useRef<AbortController | null>(null);
  const executing = useRef(false);
  const lastRequest = useRef<TransactionRequest | null>(null);
  const lastRequestVersion = useRef(-1);
  const mounted = useRef(true);
  const scope = useRef({ key: scopeKey, version: 0 });
  useLayoutEffect(() => {
    if (scope.current.key !== scopeKey) {
      scope.current = { key: scopeKey, version: scope.current.version + 1 };
    }
  }, [scopeKey]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      window.dispatchEvent(new Event("freelance-market:transaction-clear"));
    };
  }, []);
  useEffect(() => {
    controller.current?.abort();
    lastRequest.current = null;
    lastRequestVersion.current = -1;
    executing.current = false;
    window.dispatchEvent(new Event("freelance-market:transaction-clear"));
    const resetId = window.setTimeout(() => setState(initial), 0);
    return () => window.clearTimeout(resetId);
  }, [scopeKey]);

  const confirmAccepted = useCallback(
    async (request: TransactionRequest, hash: string | undefined) => {
      controller.current?.abort();
      const aborter = new AbortController();
      controller.current = aborter;
      const started = Date.now();
      const startedVersion = scope.current.version;
      let attempt = 0;
      while (Date.now() - started < (request.timeoutMs ?? TX_TIMEOUT_MS)) {
        if (
          !canApplyScopeResult(
            startedVersion,
            scope.current.version,
            aborter.signal,
          )
        )
          throw new DOMException("Aborted", "AbortError");
        attempt += 1;
        if (mounted.current)
          setState({
            phase: "refreshing",
            label: request.label,
            hash,
            attempt,
            message: "Refreshing accepted contract state.",
          });
        try {
          if (aborter.signal.aborted)
            throw new DOMException("Aborted", "AbortError");
          const matches = await request.confirm(aborter.signal);
          if (
            !canApplyScopeResult(
              startedVersion,
              scope.current.version,
              aborter.signal,
            )
          )
            throw new DOMException("Aborted", "AbortError");
          if (matches) {
            window.dispatchEvent(
              new CustomEvent("freelance-market:refresh", {
                detail: { hash, confirmed: true },
              }),
            );
            if (
              mounted.current &&
              canApplyScopeResult(
                startedVersion,
                scope.current.version,
                aborter.signal,
              )
            )
              setState({
                phase: "confirmed",
                label: request.label,
                hash,
                attempt,
                message:
                  "The expected accepted-state transition is now visible.",
              });
            return true;
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError")
            throw error;
        }
        await delay(Math.min(1500 + attempt * 500, 6000), aborter.signal);
      }
      if (mounted.current)
        setState({
          phase: "sync_timeout",
          label: request.label,
          hash,
          attempt,
          message:
            "The transaction was accepted, but the updated contract state is taking longer than expected to appear.",
        });
      return false;
    },
    [],
  );

  const execute = useCallback(
    async (request: TransactionRequest) => {
      if (
        executing.current ||
        [
          "preparing",
          "wallet",
          "submitted",
          "receipt_pending",
          "receipt_unknown",
          "accepted",
          "refreshing",
        ].includes(state.phase)
      )
        return false;
      executing.current = true;
      lastRequest.current = request;
      lastRequestVersion.current = scope.current.version;
      controller.current?.abort();
      setState({
        phase: "preparing",
        label: request.label,
        attempt: 0,
        message: "Preparing the contract request.",
      });
      let hash: string | undefined;
      try {
        await request.prepare?.();
        const receiptResult = await request.submit({
          onAwaitingWallet: () =>
            mounted.current &&
            setState({
              phase: "wallet",
              label: request.label,
              attempt: 0,
              message: "Confirm the transaction in your wallet.",
            }),
          onSubmitted: (h) => {
            hash = h;
            if (mounted.current)
              setState({
                phase: "submitted",
                label: request.label,
                hash: h,
                attempt: 0,
                message:
                  "Transaction submitted. Waiting for GenLayer accepted state.",
              });
          },
          onAccepted: (h) =>
            mounted.current &&
            setState({
              phase: "accepted",
              label: request.label,
              hash: h,
              attempt: 0,
              message:
                "Transaction accepted. Verifying the expected contract change.",
            }),
        });
        hash = receiptResult.hash;
        if (!shouldConfirmExpectedState(receiptResult)) {
          if (mounted.current)
            setState(receiptState(receiptResult, request.label, 0));
          executing.current = false;
          return false;
        }
        const confirmed = await confirmAccepted(request, hash);
        executing.current = false;
        return confirmed;
      } catch (error) {
        executing.current = false;
        if (error instanceof DOMException && error.name === "AbortError")
          return false;
        const rawMessage =
          error instanceof Error
            ? error.message
            : "The transaction could not be completed.";
        const rejected = /user rejected|rejected the request|denied/i.test(rawMessage);
        const phase: TransactionPhase = rejected
          ? "rejected"
          : "submission_error";
        const failureKind: TransactionFailureKind = rejected
          ? "wallet_rejected"
          : "submission_failed";
        const message = rejected
          ? "The wallet request was cancelled. No transaction was submitted."
          : rawMessage;
        if (mounted.current)
          setState({
            phase,
            label: request.label,
            hash,
            attempt: 0,
            message,
            failureKind,
          });
        return false;
      }
    },
    [confirmAccepted, state.phase],
  );

  const retry = useCallback(async () => {
    const request = lastRequest.current;
    const hash = state.hash;
    if (
      !request ||
      !hash ||
      lastRequestVersion.current !== scope.current.version
    )
      return false;
    if (["receipt_pending", "receipt_unknown"].includes(state.phase)) {
      setState({
        phase: "receipt_pending",
        label: request.label,
        hash,
        attempt: state.attempt + 1,
        message: "Checking the existing transaction hash for ACCEPTED state.",
      });
      const retryResult = await retryExistingTransaction({
        hash,
        request,
        scopeIsCurrent: () =>
          lastRequestVersion.current === scope.current.version,
        onExecuted: async () => {
          setState({
            phase: "accepted",
            label: request.label,
            hash,
            attempt: state.attempt + 1,
            message:
              "Transaction accepted. Verifying the expected contract change.",
          });
          return confirmAccepted(request, hash);
        },
      });
      if (retryResult.kind === "invalid_scope") return false;
      if (!shouldConfirmExpectedState(retryResult.receipt)) {
        setState(
          receiptState(
            retryResult.receipt,
            request.label,
            state.attempt + 1,
          ),
        );
        return false;
      }
      return retryResult.confirmed;
    }
    return confirmAccepted(request, hash);
  }, [confirmAccepted, state]);
  const reset = useCallback(() => setState(initial), []);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("freelance-market:transaction", {
        detail: { state, retry },
      }),
    );
  }, [retry, state]);
  return {
    state,
    execute,
    retry,
    reset,
    pending: [
      "preparing",
      "wallet",
      "submitted",
      "receipt_pending",
      "receipt_unknown",
      "accepted",
      "refreshing",
    ].includes(state.phase),
  };
}
