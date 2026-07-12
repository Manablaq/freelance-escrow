"use client";

import { useEffect, useRef, useState } from "react";
import { TransactionTracker } from "./Web3UI";
import type { TransactionState } from "@/hooks/useTransactionSync";

type ProgressEvent = {
  state: TransactionState;
  retry: () => Promise<boolean>;
};

export function GlobalTransactionProgress() {
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onProgress = (event: Event) => {
      const next = (event as CustomEvent<ProgressEvent>).detail;
      window.clearTimeout(closeTimer.current);
      setProgress(next);
      if (next.state.phase === "confirmed") {
        closeTimer.current = window.setTimeout(() => setProgress(null), 4500);
      }
    };
    const clearProgress = () => setProgress(null);
    window.addEventListener("freelance-market:transaction", onProgress);
    window.addEventListener(
      "freelance-market:transaction-clear",
      clearProgress,
    );
    return () => {
      window.removeEventListener("freelance-market:transaction", onProgress);
      window.removeEventListener(
        "freelance-market:transaction-clear",
        clearProgress,
      );
      window.clearTimeout(closeTimer.current);
    };
  }, []);

  if (!progress || progress.state.phase === "idle") return null;

  return (
    <aside className="tx-dock" aria-label="Transaction progress">
      <TransactionTracker
        state={progress.state}
        onRetry={() => void progress.retry()}
      />
    </aside>
  );
}
