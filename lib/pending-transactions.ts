export const PENDING_TRANSACTIONS_STORAGE_KEY =
  "freelance-market:pending-transactions:v1";

export type PendingEntityType =
  | "profile"
  | "job"
  | "funding"
  | "submission"
  | "settlement"
  | "other";

export type PendingPhase =
  | "submitted"
  | "receipt_pending"
  | "receipt_unknown"
  | "confirming"
  | "confirmation_delayed"
  | "confirmed"
  | "failed"
  | "canceled"
  | "undetermined";

export type ConfirmationDescriptor =
  | { kind: "register"; role: string }
  | { kind: "update_profile"; expected: Record<string, string> }
  | {
      kind: "create_job";
      expected: Record<string, string>;
      knownJobIds: string[];
    }
  | { kind: "job_state"; jobId: string; statuses: string[]; balance?: string; deliverableUrl?: string };

export type PendingTransaction = {
  id: string;
  hash: string;
  walletAddress: string;
  chainId: number;
  contractAddress: string;
  method: string;
  label: string;
  entityType: PendingEntityType;
  entityKey: string;
  optimisticData: Record<string, unknown>;
  confirmation: ConfirmationDescriptor;
  createdAt: number;
  updatedAt: number;
  phase: PendingPhase;
  receiptStatus?: string;
  executionStatus?: string;
  failureMessage?: string;
  attempt: number;
  nextPollAt: number;
  acceptedAt?: number;
};

export type PendingTransactionInput = Omit<
  PendingTransaction,
  "id" | "createdAt" | "updatedAt" | "phase" | "attempt" | "nextPollAt"
>;

export const transactionNamespace = (
  chainId: number,
  contractAddress: string,
  walletAddress: string,
) => `${chainId}:${contractAddress.toLowerCase()}:${walletAddress.toLowerCase()}`;

export function makePendingTransaction(
  input: PendingTransactionInput,
  now = Date.now(),
): PendingTransaction {
  return {
    ...input,
    id: `${transactionNamespace(input.chainId, input.contractAddress, input.walletAddress)}:${input.hash.toLowerCase()}`,
    hash: input.hash.toLowerCase(),
    walletAddress: input.walletAddress.toLowerCase(),
    contractAddress: input.contractAddress.toLowerCase(),
    createdAt: now,
    updatedAt: now,
    phase: "submitted",
    attempt: 0,
    nextPollAt: now,
  };
}

export function mergeTransaction(
  transactions: PendingTransaction[],
  next: PendingTransaction,
) {
  const index = transactions.findIndex((tx) => tx.id === next.id);
  if (index < 0) return [...transactions, next];
  const copy = [...transactions];
  copy[index] = { ...copy[index], ...next, id: copy[index].id };
  return copy;
}

export function scopedTransactions(
  transactions: PendingTransaction[],
  chainId?: number,
  contractAddress?: string,
  walletAddress?: string,
) {
  if (!chainId || !contractAddress || !walletAddress) return [];
  const namespace = transactionNamespace(chainId, contractAddress, walletAddress);
  return transactions.filter((tx) => tx.id.startsWith(`${namespace}:`));
}

export const isUnfinished = (tx: PendingTransaction) =>
  ["submitted", "receipt_pending", "receipt_unknown", "confirming", "confirmation_delayed"].includes(
    tx.phase,
  );

export const pollingBackoffMs = (attempt: number) =>
  Math.min(2_000 * 1.55 ** Math.max(0, attempt), 10_000);

export const CONFIRMATION_DELAYED_MS = 2 * 60_000;
export const CONFIRMED_RETENTION_MS = 24 * 60 * 60_000;

export function mergeTransactionCollections(
  current: PendingTransaction[],
  incoming: PendingTransaction[],
) {
  const merged = new Map(current.map((tx) => [tx.id, tx]));
  for (const tx of incoming) {
    const existing = merged.get(tx.id);
    if (!existing || tx.updatedAt > existing.updatedAt) merged.set(tx.id, tx);
  }
  return [...merged.values()];
}

export function pruneTransactions(transactions: PendingTransaction[], now = Date.now()) {
  return transactions.filter(
    (tx) => tx.phase !== "confirmed" || now - tx.updatedAt < CONFIRMED_RETENTION_MS,
  );
}

export function matchesProfileConfirmation(
  descriptor: Extract<ConfirmationDescriptor, { kind: "register" | "update_profile" }>,
  profile: Record<string, unknown>,
) {
  if (descriptor.kind === "register") {
    return Boolean(profile.found) && profile.role === descriptor.role;
  }
  return Object.entries(descriptor.expected).every(
    ([key, value]) => profile[key] === value,
  );
}

export function matchesJobConfirmation(
  descriptor: Extract<ConfirmationDescriptor, { kind: "create_job" | "job_state" }>,
  job: Record<string, unknown>,
) {
  if (descriptor.kind === "create_job") {
    if (!job.found || descriptor.knownJobIds.includes(String(job.job_id || ""))) return false;
    return Object.entries(descriptor.expected).every(([key, value]) => {
      const actual = String(job[key] ?? "");
      return ["client", "freelancer"].includes(key)
        ? actual.toLowerCase() === value.toLowerCase()
        : actual === value;
    });
  }
  return (
    String(job.job_id || "") === descriptor.jobId &&
    descriptor.statuses.includes(String(job.status || "")) &&
    (descriptor.balance === undefined || String(job.escrow_balance ?? "") === descriptor.balance) &&
    (descriptor.deliverableUrl === undefined || job.deliverable_url === descriptor.deliverableUrl)
  );
}

export function matchesCreateJobConfirmation(
  descriptor: Extract<ConfirmationDescriptor, { kind: "create_job" }>,
  jobs: Record<string, unknown>[],
) {
  return jobs.filter((job) => matchesJobConfirmation(descriptor, job)).length === 1;
}

export function deserializePendingTransactions(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { version?: number; transactions?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.transactions)) return [];
    const phases = new Set<PendingPhase>([
      "submitted", "receipt_pending", "receipt_unknown", "confirming",
      "confirmation_delayed", "confirmed", "failed", "canceled", "undetermined",
    ]);
    return parsed.transactions.filter(
      (tx): tx is PendingTransaction =>
        Boolean(tx) &&
        typeof tx === "object" &&
        typeof (tx as PendingTransaction).hash === "string" &&
        typeof (tx as PendingTransaction).walletAddress === "string" &&
        typeof (tx as PendingTransaction).chainId === "number" &&
        typeof (tx as PendingTransaction).contractAddress === "string" &&
        typeof (tx as PendingTransaction).id === "string" &&
        typeof (tx as PendingTransaction).method === "string" &&
        typeof (tx as PendingTransaction).label === "string" &&
        typeof (tx as PendingTransaction).entityType === "string" &&
        typeof (tx as PendingTransaction).entityKey === "string" &&
        typeof (tx as PendingTransaction).optimisticData === "object" &&
        typeof (tx as PendingTransaction).confirmation === "object" &&
        (tx as PendingTransaction).confirmation !== null &&
        typeof (tx as PendingTransaction).createdAt === "number" &&
        typeof (tx as PendingTransaction).updatedAt === "number" &&
        typeof (tx as PendingTransaction).attempt === "number" &&
        typeof (tx as PendingTransaction).nextPollAt === "number" &&
        phases.has((tx as PendingTransaction).phase) &&
        (tx as PendingTransaction).id === transactionNamespace(
          (tx as PendingTransaction).chainId,
          (tx as PendingTransaction).contractAddress,
          (tx as PendingTransaction).walletAddress,
        ) + `:${(tx as PendingTransaction).hash.toLowerCase()}`,
    );
  } catch {
    return [];
  }
}

export const serializePendingTransactions = (transactions: PendingTransaction[]) =>
  JSON.stringify({ version: 1, transactions });
