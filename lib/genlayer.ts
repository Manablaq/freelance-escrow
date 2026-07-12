import { CONTRACT_ADDRESS } from "./config";
import {
  TransactionStatus,
  type GenLayerTransaction,
} from "genlayer-js/types";
import {
  checkReceiptUsingStructuredReads,
  classifyReceipt,
  type ReceiptCheckResult,
} from "./receipt-classifier";

export type Profile = {
  found?: boolean | string;
  address?: string;
  role?: "client" | "freelancer" | string;
  name?: string;
  bio?: string;
  skills?: string;
  rate?: string;
  rate_type?: string;
  portfolio?: string;
  twitter?: string;
  github?: string;
  jobs_completed?: string;
  total_earned?: string;
  registered_at?: string;
};

export type Job = {
  found?: boolean | string;
  job_id?: string;
  title?: string;
  description?: string;
  client?: string;
  freelancer?: string;
  deadline?: string;
  status?: string;
  created_at?: string;
  deliverable_url?: string;
  ai_verdict?: string;
  ai_reasoning?: string;
  ai_score?: string;
  ai_evidence_summary?: string;
  escrow_balance?: string;
  client_name?: string;
  freelancer_name?: string;
  freelancer_rate?: string;
  freelancer_rate_type?: string;
  funded_at?: string;
  submitted_at?: string;
  resolved_at?: string;
};

export type Stats = {
  total_jobs?: string;
  total_paid?: string;
  total_freelancers?: string;
};

export const TX_POLL_INTERVAL_MS = 4000;
export const TX_TIMEOUT_MS = 10 * 60 * 1000;
export type WriteLifecycleCallbacks = {
  onAwaitingWallet?: () => void;
  onSubmitted?: (hash: string) => void;
  onAccepted?: (hash: string) => void;
};
const WRITE_METHODS = new Set([
  "register",
  "update_profile",
  "create_job",
  "fund_job",
  "submit_work",
  "verify_and_release",
  "client_refund",
  "cancel_job",
]);

// ── Reads via API route ───────────────────────────────────────────────────────

async function readContract<T>(
  method: string,
  args: unknown[] = [],
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch("/api/contract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, args }),
    cache: "no-store",
    signal,
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  let result = json.result;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {}
  }
  return result as T;
}

export async function getProfile(address: string, signal?: AbortSignal) {
  return readContract<Profile>("get_profile", [address], signal);
}
export async function getAllFreelancers(signal?: AbortSignal) {
  return readContract<Profile[]>("get_all_freelancers", [], signal);
}
export async function getJob(jobId: string, signal?: AbortSignal) {
  return readContract<Job>("get_job", [jobId], signal);
}
export async function getJobsByClient(address: string, signal?: AbortSignal) {
  return readContract<Job[]>("get_jobs_by_client", [address], signal);
}
export async function getJobsByFreelancer(address: string, signal?: AbortSignal) {
  return readContract<Job[]>("get_jobs_by_freelancer", [address], signal);
}
export async function getStats(signal?: AbortSignal) {
  return readContract<Stats>("get_stats", [], signal);
}

// ── Writes via genlayer-js ────────────────────────────────────────────────────

async function getClient(address: string) {
  const { createClient } = await import("genlayer-js");
  const { testnetBradbury } = await import("genlayer-js/chains");
  const client = createClient({
    chain: testnetBradbury,
    account: address as `0x${string}`,
  }) as {
    connect?: (chainName: string) => Promise<unknown>;
    writeContract: (request: {
      address: `0x${string}`;
      functionName: string;
      args: unknown[];
      value: bigint;
    }) => Promise<string>;
    waitForTransactionReceipt: (request: {
      hash: string;
      status: TransactionStatus;
      interval: number;
      retries: number;
    }) => Promise<GenLayerTransaction>;
    getTransaction: (request: { hash: string }) => Promise<GenLayerTransaction>;
  };
  try {
    await client.connect?.("testnetBradbury");
  } catch {}
  return client;
}

export async function writeContract(
  address: string,
  functionName: string,
  args: unknown[],
  value?: bigint,
  lifecycle: WriteLifecycleCallbacks = {},
) {
  if (!WRITE_METHODS.has(functionName))
    throw new Error("Unsupported contract write method.");
  const client = await getClient(address);
  lifecycle.onAwaitingWallet?.();
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value: value ?? BigInt(0),
  });
  lifecycle.onSubmitted?.(hash);
  const receiptResult = await checkTransactionReceipt(address, hash, client);
  if (receiptResult.kind === "executed") lifecycle.onAccepted?.(hash);
  return receiptResult;
}

export async function checkTransactionReceipt(
  address: string,
  hash: string,
  existingClient?: Awaited<ReturnType<typeof getClient>>,
): Promise<ReceiptCheckResult> {
  let client: Awaited<ReturnType<typeof getClient>>;
  try {
    client = existingClient ?? (await getClient(address));
  } catch {
    return classifyReceipt(hash, undefined);
  }
  return checkReceiptUsingStructuredReads(
    hash,
    (existingHash) =>
      client.waitForTransactionReceipt({
        hash: existingHash,
        status: TransactionStatus.ACCEPTED,
        interval: 4000,
        retries: 60,
      }),
    (existingHash) => client.getTransaction({ hash: existingHash }),
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function shortAddress(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatGEN(wei: string | number | bigint) {
  try {
    const n = BigInt(wei);
    const eth = Number(n) / 1e18;
    if (eth === 0) return "0 GEN";
    if (eth < 0.0001) return "< 0.0001 GEN";
    return `${eth.toFixed(4)} GEN`;
  } catch {
    return "0 GEN";
  }
}

export function timeAgo(isoStr: string) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
}

export function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function isJobId(value: string) {
  return /^[1-9][0-9]*$/.test(value.trim());
}

export function isPublicUrl(value: string) {
  if (/^\s*(deliverable_url|job_id)\s*:/i.test(value)) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function humanizeContractError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.replace(/^Error:\s*/i, "");
  const known: Array<[RegExp, string]> = [
    [/updated contract state is taking longer/i, text],
    [
      /user rejected|rejected the request|denied/i,
      "The wallet request was cancelled. No transaction was sent.",
    ],
    [
      /already registered/i,
      "This wallet already has a profile. Open Dashboard to update it.",
    ],
    [
      /only clients|register as a client|not a client/i,
      "This action requires a registered client wallet.",
    ],
    [
      /only the assigned freelancer|not a freelancer|specified address/i,
      "This action requires the assigned registered freelancer wallet.",
    ],
    [/only the client/i, "Connect the client wallet assigned to this job."],
    [
      /valid public url|malformed|invalid url/i,
      "Enter a complete public http:// or https:// deliverable URL.",
    ],
    [
      /must send gen|payable|insufficient funds|no balance/i,
      "Enter a GEN amount greater than zero and ensure the wallet has enough funds.",
    ],
    [/job .* not found|missing job/i, "Enter an existing numeric job ID."],
    [
      /status|must be open|must be funded|must be submitted|refund only/i,
      "This action is not available in the job’s current status. Refresh the job and try again.",
    ],
  ];
  return (
    known.find(([pattern]) => pattern.test(text))?.[1] ||
    text.slice(0, 260) ||
    "The transaction could not be completed."
  );
}
