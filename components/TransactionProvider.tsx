"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAccount, useChainId } from "wagmi";
import { CONTRACT_ADDRESS, BRADBURY_CHAIN } from "@/lib/config";
import {
  checkTransactionReceiptOnce,
  getJob,
  getJobsByClient,
  getProfile,
  shortAddress,
} from "@/lib/genlayer";
import {
  PENDING_TRANSACTIONS_STORAGE_KEY,
  CONFIRMATION_DELAYED_MS,
  deserializePendingTransactions,
  isUnfinished,
  makePendingTransaction,
  mergeTransaction,
  mergeTransactionCollections,
  matchesJobConfirmation,
  matchesCreateJobConfirmation,
  matchesProfileConfirmation,
  pollingBackoffMs,
  pruneTransactions,
  scopedTransactions,
  serializePendingTransactions,
  type PendingTransaction,
  type PendingTransactionInput,
} from "@/lib/pending-transactions";

type TransactionContextValue = {
  transactions: PendingTransaction[];
  activeTransactions: PendingTransaction[];
  addSubmittedTransaction: (input: PendingTransactionInput) => PendingTransaction;
  updateTransaction: (id: string, patch: Partial<PendingTransaction>) => void;
  dismissTransaction: (id: string) => void;
  getPendingTransactions: () => PendingTransaction[];
  getPendingEntity: (entityType: string, entityKey: string) => PendingTransaction | undefined;
  retryReceiptPolling: (id: string) => void;
  hasPendingEntityKey: (entityKey: string) => boolean;
};

const TransactionContext = createContext<TransactionContextValue | null>(null);

async function confirmExpectedState(tx: PendingTransaction) {
  const descriptor = tx.confirmation;
  if (descriptor.kind === "register") {
    const profile = await getProfile(tx.walletAddress);
    return matchesProfileConfirmation(descriptor, profile);
  }
  if (descriptor.kind === "update_profile") {
    const profile = await getProfile(tx.walletAddress);
    return matchesProfileConfirmation(descriptor, profile);
  }
  if (descriptor.kind === "create_job") {
    const jobs = await getJobsByClient(tx.walletAddress);
    return matchesCreateJobConfirmation(descriptor, jobs);
  }
  const job = await getJob(descriptor.jobId);
  return matchesJobConfirmation(descriptor, job);
}

export function TransactionProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const chainId = useChainId();
  const [transactions, setTransactions] = useState<PendingTransaction[]>(() =>
    typeof window === "undefined"
      ? []
      : deserializePendingTransactions(
          window.localStorage.getItem(PENDING_TRANSACTIONS_STORAGE_KEY),
        ),
  );
  const [toast, setToast] = useState<{ message: string; failed?: boolean } | null>(null);
  const polling = useRef(new Set<string>());
  const activeRef = useRef<PendingTransaction[]>([]);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!mounted.current) return;
    window.localStorage.setItem(
      PENDING_TRANSACTIONS_STORAGE_KEY,
      serializePendingTransactions(transactions),
    );
  }, [transactions]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== PENDING_TRANSACTIONS_STORAGE_KEY) return;
      const incoming = deserializePendingTransactions(event.newValue);
      setTransactions((current) => mergeTransactionCollections(current, incoming));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    const id = window.setInterval(
      () => setTransactions((all) => pruneTransactions(all)),
      60 * 60_000,
    );
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const updateTransaction = useCallback(
    (id: string, patch: Partial<PendingTransaction>) =>
      setTransactions((all) =>
        all.map((tx) =>
          tx.id === id ? { ...tx, ...patch, updatedAt: Date.now() } : tx,
        ),
      ),
    [],
  );
  const dismissTransaction = useCallback(
    (id: string) => setTransactions((all) => all.filter((tx) => tx.id !== id)),
    [],
  );
  const addSubmittedTransaction = useCallback((input: PendingTransactionInput) => {
    const transaction = makePendingTransaction(input);
    setTransactions((all) => mergeTransaction(all, transaction));
    return transaction;
  }, []);
  const activeTransactions = useMemo(
    () => scopedTransactions(transactions, chainId, CONTRACT_ADDRESS, address),
    [address, chainId, transactions],
  );
  useEffect(() => {
    activeRef.current = activeTransactions;
  }, [activeTransactions]);
  const retryReceiptPolling = useCallback(
    (id: string) =>
      updateTransaction(id, { nextPollAt: Date.now(), phase: "receipt_pending" }),
    [updateTransaction],
  );

  useEffect(() => {
    if (!address || chainId !== BRADBURY_CHAIN.id) return;
    let stopped = false;
    const tick = async () => {
      const now = Date.now();
      const due = activeRef.current.filter(
        (tx) => isUnfinished(tx) && tx.nextPollAt <= now && !polling.current.has(tx.hash),
      );
      await Promise.all(
        due.map(async (tx) => {
          polling.current.add(tx.hash);
          try {
            if (["confirming", "confirmation_delayed"].includes(tx.phase)) {
              const confirmed = await confirmExpectedState(tx);
              if (stopped) return;
              if (confirmed) {
                updateTransaction(tx.id, { phase: "confirmed", failureMessage: undefined });
                setToast({ message: `${tx.label} accepted on GenLayer` });
                window.dispatchEvent(new CustomEvent("freelance-market:refresh", { detail: { hash: tx.hash, confirmed: true } }));
              } else {
                const delayed = Boolean(tx.acceptedAt && Date.now() - tx.acceptedAt >= CONFIRMATION_DELAYED_MS);
                updateTransaction(tx.id, { phase: delayed ? "confirmation_delayed" : "confirming", attempt: tx.attempt + 1, nextPollAt: Date.now() + pollingBackoffMs(tx.attempt) });
              }
              return;
            }
            const result = await checkTransactionReceiptOnce(tx.walletAddress, tx.hash);
            if (stopped) return;
            const receipt = "receipt" in result ? result.receipt : undefined;
            const common = {
              attempt: tx.attempt + 1,
              receiptStatus: receipt?.statusName?.toString(),
              executionStatus: receipt?.txExecutionResultName?.toString(),
              nextPollAt: Date.now() + pollingBackoffMs(tx.attempt),
            };
            if (result.kind === "executed") updateTransaction(tx.id, { ...common, phase: "confirming", acceptedAt: Date.now() });
            else if (result.kind === "execution_failed") {
              updateTransaction(tx.id, { ...common, phase: "failed", failureMessage: result.message });
              setToast({ message: result.message, failed: true });
            } else if (result.kind === "canceled" || result.kind === "undetermined") {
              updateTransaction(tx.id, { ...common, phase: result.kind, failureMessage: result.kind === "canceled" ? "Transaction canceled before successful execution." : "GenLayer did not reach a resolved execution outcome." });
              setToast({ message: `${tx.label}: ${result.kind}`, failed: true });
            } else updateTransaction(tx.id, { ...common, phase: result.kind === "unknown" ? "receipt_unknown" : "receipt_pending", failureMessage: result.kind === "unknown" ? result.message : undefined });
          } finally {
            polling.current.delete(tx.hash);
          }
        }),
      );
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => { stopped = true; window.clearInterval(id); };
  }, [address, chainId, updateTransaction]);

  const value = useMemo<TransactionContextValue>(() => ({
    transactions,
    activeTransactions,
    addSubmittedTransaction,
    updateTransaction,
    dismissTransaction,
    getPendingTransactions: () => activeTransactions.filter(isUnfinished),
    getPendingEntity: (entityType, entityKey) => activeTransactions.find((tx) => tx.entityType === entityType && tx.entityKey === entityKey && tx.phase !== "confirmed"),
    retryReceiptPolling,
    hasPendingEntityKey: (entityKey) => activeTransactions.some(
      (tx) => tx.entityKey === entityKey && isUnfinished(tx),
    ),
  }), [transactions, activeTransactions, addSubmittedTransaction, updateTransaction, dismissTransaction, retryReceiptPolling]);

  return (
    <TransactionContext.Provider value={value}>
      {children}
      {toast && <div className={`tx-toast ${toast.failed ? "failed" : ""}`} role="status">{toast.message}</div>}
    </TransactionContext.Provider>
  );
}

export function useTransactions() {
  const context = useContext(TransactionContext);
  if (!context) throw new Error("useTransactions must be used inside TransactionProvider");
  return context;
}

export function TransactionTray() {
  const { activeTransactions, dismissTransaction, retryReceiptPolling } = useTransactions();
  const [open, setOpen] = useState(false);
  const visible = activeTransactions.filter((tx) => tx.phase !== "confirmed");
  if (!visible.length) return null;
  return (
    <aside className="transaction-tray">
      <button className="tx-tray-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Transactions <strong>{visible.length}</strong>
      </button>
      {open && <div className="tx-tray-panel">
        {visible.map((tx) => <article className="tx-tray-item" key={tx.id}>
          <div><strong>{tx.label}</strong><span className={`pending-badge ${["failed", "canceled", "undetermined"].includes(tx.phase) ? "failed" : ""}`}>{tx.phase.replace("_", " ")}</span></div>
          <code>{shortAddress(tx.hash)}</code>
          <p>{tx.failureMessage || (tx.phase === "confirmation_delayed" ? "Execution succeeded, but the expected accepted state is taking longer than usual to appear. Polling continues." : "GenLayer consensus continues quietly in the background.")}</p>
          <div className="tx-item-actions">
            <a href={`https://explorer-bradbury.genlayer.com/transactions/${tx.hash}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>
            {tx.phase === "receipt_unknown" && <button onClick={() => retryReceiptPolling(tx.id)}>Retry check</button>}
            {!isUnfinished(tx) && <button onClick={() => dismissTransaction(tx.id)}>Dismiss</button>}
          </div>
        </article>)}
      </div>}
    </aside>
  );
}
