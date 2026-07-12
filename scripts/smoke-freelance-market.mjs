/**
 * Prepared, resumable GenLayer Bradbury smoke runner. Writes occur only when invoked.
 *
 * Required environment:
 *   CLIENT_PRIVATE_KEY=0x...
 *   FREELANCER_PRIVATE_KEY=0x...
 *   APPROVAL_DELIVERABLE_URL=https://... (approval flow)
 *   REJECTION_DELIVERABLE_URL=https://... (rejection flow)
 *
 * Optional: SMOKE_ESCROW_WEI=1, SMOKE_POLL_INTERVAL_MS=5000,
 * SMOKE_RECEIPT_ATTEMPTS=120, SMOKE_STATE_ATTEMPTS=120, and flow-prefixed
 * JOB_TITLE/JOB_DESCRIPTION variables documented in the repository task.
 *
 * Journals are .smoke-freelance-market.<flow>.json. To start a new run, first
 * inspect every recorded/ambiguous transaction, then manually rename the old journal
 * (for example, append .completed-<run-id>) and invoke the command again. To recover
 * an ambiguous broadcast, manually set that step to HASH_RECORDED and add its verified
 * hash. The runner never deletes or replaces an existing run with different configuration.
 */
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import {
  DECIDED_STATES,
  ExecutionResult,
  TransactionResult,
  TransactionStatus,
} from "genlayer-js/types";
import { SUCCESS_RESULTS } from "./genlayer-transaction-outcomes.mjs";

export const JOURNAL_SCHEMA_VERSION = 1;
export const MIN_DELIVERABLE_URL_LENGTH = 10;
export const MAX_DELIVERABLE_URL_LENGTH = 500;
export const MIN_JOB_TITLE_LENGTH = 3;
export const MAX_JOB_TITLE_LENGTH = 100;
export const MIN_JOB_DESCRIPTION_LENGTH = 20;
export const MAX_JOB_DESCRIPTION_LENGTH = 1000;
export const CONTRACT_ADDRESS = "0x75af88bfA0592CFA63c06f2F68BfD35C13dDd4EF";
export const CLIENT_ADDRESS = "0x1f87Ae197af539253978d435aD45cCf28Fb95024";
export const FREELANCER_ADDRESS = "0x5bB49021001200fE8156a81c7fcF097e535e7181";
const CHAIN_ID = testnetBradbury.id;
const SUCCESS_STATUSES = new Set([TransactionStatus.ACCEPTED, TransactionStatus.FINALIZED]);
const FAILURE_STATUSES = new Set([
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.VALIDATORS_TIMEOUT,
  TransactionStatus.LEADER_TIMEOUT,
]);
const FAILURE_RESULTS = new Set([
  TransactionResult.NO_MAJORITY,
  TransactionResult.DISAGREE,
  TransactionResult.MAJORITY_DISAGREE,
  TransactionResult.TIMEOUT,
  TransactionResult.DETERMINISTIC_VIOLATION,
]);

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function positiveBigInt(name, fallback) {
  const value = BigInt(process.env[name] ?? fallback);
  if (value <= 0n) throw new Error(`${name} must be positive`);
  return value;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sameAddress(left, right) {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

function parseView(name, value) {
  if (typeof value !== "string") throw new Error(`${name} did not return a JSON string`);
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} returned invalid JSON: ${error.message}`);
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function equalData(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

const VERIFY_STEP = "verify_and_release";
const VERIFY_RETRY_PATTERN = /^verify_and_release_retry_([1-9]\d*)$/;

export function verificationAttempts(journal) {
  const attempts = [];
  if (journal.steps?.[VERIFY_STEP]) attempts.push({ name: VERIFY_STEP, number: 0, step: journal.steps[VERIFY_STEP] });
  for (const [name, step] of Object.entries(journal.steps ?? {})) {
    const match = VERIFY_RETRY_PATTERN.exec(name);
    if (match) attempts.push({ name, number: Number(match[1]), step });
  }
  attempts.sort((left, right) => left.number - right.number);
  return attempts;
}

export function latestVerificationAttempt(journal) {
  return verificationAttempts(journal).at(-1) ?? null;
}

export function nextVerifyRetryStepName(journal) {
  const attempts = verificationAttempts(journal);
  if (!attempts.length) throw new Error("VERIFY_RETRY_NO_PREVIOUS_ATTEMPT");
  return `verify_and_release_retry_${attempts.at(-1).number + 1}`;
}

function isStrictSuccessEvidence(step) {
  return step?.status === "EXECUTION_CONFIRMED" &&
    SUCCESS_STATUSES.has(step.execution?.status_name) &&
    SUCCESS_RESULTS.has(step.execution?.result_name) &&
    step.execution?.execution_result_name === ExecutionResult.FINISHED_WITH_RETURN;
}

export function selectVerifySuccessStep(journal) {
  const pointer = journal.state?.verify_success_step;
  if (pointer !== undefined) {
    const pointed = verificationAttempts(journal).find(({ name }) => name === pointer);
    if (!pointed || !isStrictSuccessEvidence(pointed.step)) throw new Error("VERIFY_SUCCESS_POINTER_INVALID");
    return pointed;
  }
  const original = journal.steps?.[VERIFY_STEP];
  if (isStrictSuccessEvidence(original)) return { name: VERIFY_STEP, number: 0, step: original };
  throw new Error("VERIFY_SUCCESS_POINTER_REQUIRED");
}

export function assertRetryAuthorization(journal, authorizedHash) {
  const latest = latestVerificationAttempt(journal);
  if (!latest) throw new Error("VERIFY_RETRY_NO_PREVIOUS_ATTEMPT");
  if (isStrictSuccessEvidence(latest.step)) throw new Error("VERIFY_ALREADY_SUCCESSFUL");
  if (latest.step.status === "INTENT_RECORDED" && !latest.step.hash) throw new Error(`AMBIGUOUS_BROADCAST ${latest.name}`);
  if (!authorizedHash) throw new Error("VERIFY_RETRY_REQUIRED");
  if (authorizedHash !== latest.step.hash) throw new Error("VERIFY_RETRY_HASH_MISMATCH");
  return latest;
}

export function assertRetryJobPreconditions({ journal, job, config, jobId, escrowWei }) {
  if (job?.found !== true) throw new Error("VERIFY_RETRY_JOB_NOT_FOUND");
  if (String(job.job_id) !== String(jobId)) throw new Error("VERIFY_RETRY_JOB_ID_MISMATCH");
  if (!jobIdentityMatches(job, config)) throw new Error("VERIFY_RETRY_JOB_IDENTITY_MISMATCH");
  if (job.deliverable_url !== config.deliverable_url) throw new Error("VERIFY_RETRY_DELIVERABLE_URL_MISMATCH");
  if (job.status !== "SUBMITTED") throw new Error("VERIFY_RETRY_STATUS_MISMATCH");
  if (BigInt(job.escrow_balance) !== escrowWei) throw new Error("VERIFY_RETRY_ESCROW_MISMATCH");
  if (job.ai_verdict !== "") throw new Error("VERIFY_RETRY_VERDICT_NOT_EMPTY");
  if (job.ai_reasoning !== "") throw new Error("VERIFY_RETRY_REASONING_NOT_EMPTY");
  if (job.resolved_at !== "") throw new Error("VERIFY_RETRY_RESOLVED_AT_NOT_EMPTY");
  if (journal.steps.client_refund) throw new Error("VERIFY_RETRY_REFUND_STEP_PRESENT");
  if (verificationAttempts(journal).some(({ step }) => isStrictSuccessEvidence(step))) throw new Error("VERIFY_ALREADY_SUCCESSFUL");
  return job;
}

function exactReceiptTuple(transaction) {
  const fields = [transaction?.statusName, transaction?.resultName, transaction?.txExecutionResultName];
  if (fields.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("VERIFY_RETRY_RECEIPT_MALFORMED");
  }
  if (!Object.values(TransactionStatus).includes(fields[0]) ||
      !Object.values(TransactionResult).includes(fields[1]) ||
      !Object.values(ExecutionResult).includes(fields[2])) {
    throw new Error("VERIFY_RETRY_RECEIPT_MALFORMED");
  }
  return { status_name: fields[0], result_name: fields[1], execution_result_name: fields[2] };
}

export async function prepareVerifyRetry({ journal, authorizedHash, getTransaction, readJob, save, escrowWei, now = () => new Date().toISOString() }) {
  const latest = assertRetryAuthorization(journal, authorizedHash);
  const transaction = await getTransaction(latest.step.hash);
  const execution = exactReceiptTuple(transaction);
  const classification = classifyTransaction(transaction);
  if (classification.kind === "PENDING") throw new Error("VERIFY_RETRY_PREVIOUS_PENDING");
  if (classification.kind === "SUCCESS") throw new Error("VERIFY_RETRY_PREVIOUS_SUCCESSFUL");
  if (classification.kind !== "FAILURE") throw new Error("VERIFY_RETRY_PREVIOUS_NOT_TERMINAL_FAILURE");
  const jobId = journal.state?.job_id;
  if (jobId === undefined || jobId === null || jobId === "") throw new Error("VERIFY_RETRY_JOB_ID_MISSING");
  const job = await readJob(jobId);
  assertRetryJobPreconditions({ journal, job, config: journal.config, jobId, escrowWei });
  latest.step.status = "TERMINAL_FAILURE_CONFIRMED";
  latest.step.execution = execution;
  latest.step.terminal_failure_confirmed_at = now();
  await save(journal);
  return { previous: latest, job, jobId, stepName: nextVerifyRetryStepName(journal) };
}

export async function executeVerifyRetry({ journal, authorizedHash, getTransaction, readJob, save, escrowWei,
  loadClientAccount, createWriter, wait, now }) {
  const prepared = await prepareVerifyRetry({ journal, authorizedHash, getTransaction, readJob, save, escrowWei, now });
  const account = loadClientAccount();
  if (!sameAddress(account.address, journal.config.client_address)) throw new Error("CLIENT_PRIVATE_KEY does not match CLIENT_ADDRESS");
  const writer = createWriter(account);
  await submitStep({ journal, stepName: prepared.stepName, client: writer, sender: journal.config.client_address, save, wait, request: {
    address: journal.config.contract_address, functionName: "verify_and_release", args: [prepared.jobId], value: 0n,
  } });
  journal.state.verify_success_step = prepared.stepName;
  await save(journal);
  return prepared.stepName;
}

export function formatVerificationAttempts(journal) {
  return verificationAttempts(journal).map(({ name, step }) => ({
    step_name: name,
    hash: step.hash ?? null,
    journal_status: step.status,
    status_name: step.execution?.status_name ?? null,
    result_name: step.execution?.result_name ?? null,
    execution_result_name: step.execution?.execution_result_name ?? null,
  }));
}

export function validateDeliverableUrl(deliverableUrl) {
  if (typeof deliverableUrl !== "string") {
    throw new Error("DELIVERABLE_URL_INVALID: expected a string containing an absolute http(s) URL");
  }
  const length = [...deliverableUrl].length;
  if (length < MIN_DELIVERABLE_URL_LENGTH) {
    throw new Error(`DELIVERABLE_URL_TOO_SHORT: ${length} code points; allowed range is ${MIN_DELIVERABLE_URL_LENGTH}-${MAX_DELIVERABLE_URL_LENGTH}`);
  }
  if (length > MAX_DELIVERABLE_URL_LENGTH) {
    throw new Error(`DELIVERABLE_URL_TOO_LONG: ${length} code points; allowed range is ${MIN_DELIVERABLE_URL_LENGTH}-${MAX_DELIVERABLE_URL_LENGTH}`);
  }
  let parsed;
  try {
    parsed = new URL(deliverableUrl);
  } catch {
    throw new Error("DELIVERABLE_URL_INVALID: expected an absolute http(s) URL");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new Error("DELIVERABLE_URL_INVALID: expected an absolute http(s) URL with a nonempty hostname");
  }
  return deliverableUrl;
}

export function validateJobFields(jobTitle, jobDescription) {
  if (typeof jobTitle !== "string") throw new Error("JOB_TITLE_INVALID: expected a string");
  if (typeof jobDescription !== "string") throw new Error("JOB_DESCRIPTION_INVALID: expected a string");
  const titleLength = [...jobTitle].length;
  const descriptionLength = [...jobDescription].length;
  if (titleLength < MIN_JOB_TITLE_LENGTH) {
    throw new Error(`JOB_TITLE_TOO_SHORT: ${titleLength} code points; allowed range is ${MIN_JOB_TITLE_LENGTH}-${MAX_JOB_TITLE_LENGTH}`);
  }
  if (titleLength > MAX_JOB_TITLE_LENGTH) {
    throw new Error(`JOB_TITLE_TOO_LONG: ${titleLength} code points; allowed range is ${MIN_JOB_TITLE_LENGTH}-${MAX_JOB_TITLE_LENGTH}`);
  }
  if (descriptionLength < MIN_JOB_DESCRIPTION_LENGTH) {
    throw new Error(`JOB_DESCRIPTION_TOO_SHORT: ${descriptionLength} code points; allowed range is ${MIN_JOB_DESCRIPTION_LENGTH}-${MAX_JOB_DESCRIPTION_LENGTH}`);
  }
  if (descriptionLength > MAX_JOB_DESCRIPTION_LENGTH) {
    throw new Error(`JOB_DESCRIPTION_TOO_LONG: ${descriptionLength} code points; allowed range is ${MIN_JOB_DESCRIPTION_LENGTH}-${MAX_JOB_DESCRIPTION_LENGTH}`);
  }
  return { jobTitle, jobDescription };
}

export function buildMarkedJobFields(runId, baseTitle, baseDescription) {
  if (typeof runId !== "string" || !runId) throw new Error("JOB_TITLE_INVALID: smoke run ID is missing");
  if (typeof baseTitle !== "string") throw new Error("JOB_TITLE_INVALID: expected a string");
  if (typeof baseDescription !== "string") throw new Error("JOB_DESCRIPTION_INVALID: expected a string");
  const marker = `[smoke:${runId}]`;
  return validateJobFields(`${marker} ${baseTitle}`, `${baseDescription} ${marker}`);
}

export function publicRequestMetadata(request, sender) {
  return {
    sender,
    address: request.address,
    functionName: request.functionName,
    args: request.args ?? [],
    value: String(request.value ?? 0n),
  };
}

export function validateJournal(journal, expectedConfig) {
  if (journal.schema_version !== JOURNAL_SCHEMA_VERSION) {
    throw new Error(`JOURNAL_SCHEMA_MISMATCH: expected ${JOURNAL_SCHEMA_VERSION}, found ${journal.schema_version}`);
  }
  validateJobFields(journal.config?.job_title, journal.config?.job_description);
  validateDeliverableUrl(journal.config?.deliverable_url);
  if (journal.status === "COMPLETED") {
    throw new Error(`JOURNAL_COMPLETED: run ${journal.config?.run_id} is already complete; manually archive it to start a new run`);
  }
  if (!equalData(journal.config, expectedConfig)) {
    throw new Error("JOURNAL_CONFIG_MISMATCH: stored immutable configuration differs from the current configuration");
  }
  if (!journal.steps || typeof journal.steps !== "object") throw new Error("JOURNAL_INVALID: steps object is missing");
  return journal;
}

async function atomicSave(path, journal) {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}

async function loadOrCreateJournal(path, input) {
  let journal;
  try {
    journal = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const runId = randomUUID();
    const { jobTitle, jobDescription } = buildMarkedJobFields(runId, input.baseTitle, input.baseDescription);
    const config = {
      flow: input.flow,
      chain_id: CHAIN_ID,
      contract_address: CONTRACT_ADDRESS,
      client_address: CLIENT_ADDRESS,
      freelancer_address: FREELANCER_ADDRESS,
      escrow_wei: String(input.escrowWei),
      run_id: runId,
      job_title: jobTitle,
      job_description: jobDescription,
      deliverable_url: input.deliverableUrl,
    };
    journal = {
      schema_version: JOURNAL_SCHEMA_VERSION,
      status: "ACTIVE",
      config,
      created_at: new Date().toISOString(),
      steps: {},
      state: {},
    };
    await atomicSave(path, journal);
    return journal;
  }
  const runId = journal.config?.run_id;
  validateJobFields(journal.config?.job_title, journal.config?.job_description);
  const { jobTitle, jobDescription } = buildMarkedJobFields(runId, input.baseTitle, input.baseDescription);
  const expected = {
    flow: input.flow,
    chain_id: CHAIN_ID,
    contract_address: CONTRACT_ADDRESS,
    client_address: CLIENT_ADDRESS,
    freelancer_address: FREELANCER_ADDRESS,
    escrow_wei: String(input.escrowWei),
    run_id: runId,
    job_title: jobTitle,
    job_description: jobDescription,
    deliverable_url: input.deliverableUrl,
  };
  return validateJournal(journal, expected);
}

export function classifyTransaction(transaction) {
  const { statusName, resultName, txExecutionResultName } = transaction;
  if (
    SUCCESS_STATUSES.has(statusName) &&
    SUCCESS_RESULTS.has(resultName) &&
    txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN
  ) return { kind: "SUCCESS" };
  if (txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    return { kind: "FAILURE", reason: "FINISHED_WITH_ERROR" };
  }
  if (FAILURE_STATUSES.has(statusName)) return { kind: "FAILURE", reason: statusName };
  if (FAILURE_RESULTS.has(resultName)) return { kind: "FAILURE", reason: resultName };
  if (DECIDED_STATES.includes(statusName)) {
    return { kind: "FAILURE", reason: `unexpected decided outcome ${statusName}/${resultName}/${txExecutionResultName}` };
  }
  return { kind: "PENDING" };
}

async function traceFailure(client, hash, transaction, reason) {
  let traceDetail = "";
  try {
    const trace = await client.debugTraceTransaction({ hash });
    const codeName = trace.result_code === 1 ? "USER_ERROR" : trace.result_code === 2 ? "VM_ERROR" : `RESULT_CODE_${trace.result_code}`;
    traceDetail = `; trace=${codeName}; stderr=${trace.stderr || "(empty)"}`;
  } catch (error) {
    traceDetail = `; trace unavailable: ${error.message}`;
  }
  throw new Error(`TRANSACTION_FAILED ${hash}: ${reason}; status=${transaction.statusName}; result=${transaction.resultName}; execution=${transaction.txExecutionResultName}${traceDetail}`);
}

export async function waitForSuccessfulExecution(client, hash, options = {}) {
  const attempts = options.attempts ?? 120;
  const intervalMs = options.intervalMs ?? 5_000;
  const sleeper = options.sleep ?? sleep;
  let lastRpcError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const transaction = await client.getTransaction({ hash });
      const classification = classifyTransaction(transaction);
      if (classification.kind === "SUCCESS") return transaction;
      if (classification.kind === "FAILURE") {
        if (options.traceFailures === false) throw new Error(`TRANSACTION_FAILED ${hash}: ${classification.reason}`);
        await traceFailure(client, hash, transaction, classification.reason);
      }
    } catch (error) {
      if (String(error.message).startsWith("TRANSACTION_FAILED")) throw error;
      lastRpcError = error;
    }
    if (attempt < attempts) await sleeper(intervalMs);
  }
  throw new Error(`TRANSACTION_POLL_TIMEOUT ${hash}${lastRpcError ? `; last RPC error: ${lastRpcError.message}` : ""}`);
}

export async function submitStep({ journal, stepName, client, request, sender, save, wait }) {
  let step = journal.steps[stepName];
  const metadata = publicRequestMetadata(request, sender);
  if (step && !equalData(step.request, metadata)) throw new Error(`STEP_REQUEST_MISMATCH ${stepName}`);
  if (step?.status === "INTENT_RECORDED" && !step.hash) {
    throw new Error(
      `AMBIGUOUS_BROADCAST ${stepName}: the prior process may have broadcast the transaction. ` +
      "Inspect the sender's recent transactions or explorer manually; recover and insert the hash, " +
      "or deliberately start a new journal only after confirming no transaction exists.",
    );
  }
  if (!step) {
    step = { status: "INTENT_RECORDED", request: metadata, created_at: new Date().toISOString() };
    journal.steps[stepName] = step;
    await save(journal);
    let hash;
    try {
      hash = await client.writeContract(request);
    } catch (error) {
      throw new Error(`BROADCAST_RESULT_UNKNOWN ${stepName}: intent remains recorded; ${error.message}`);
    }
    step.status = "HASH_RECORDED";
    step.hash = hash;
    step.hash_recorded_at = new Date().toISOString();
    await save(journal);
  }
  if (step.status === "PRE_EXISTING") return null;
  if (!step.hash) throw new Error(`JOURNAL_INVALID ${stepName}: ${step.status} has no hash`);
  if (step.status !== "EXECUTION_CONFIRMED") {
    const transaction = await wait(step.hash);
    step.status = "EXECUTION_CONFIRMED";
    step.execution = {
      status_name: transaction?.statusName,
      result_name: transaction?.resultName,
      execution_result_name: transaction?.txExecutionResultName,
    };
    step.execution_confirmed_at = new Date().toISOString();
    await save(journal);
  }
  return step.hash;
}

async function pollState(read, predicate, description, attempts, intervalMs) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch (error) {
      if (String(error.message).startsWith("JOB_DISCOVERY_MULTIPLE_MATCHES")) throw error;
      lastError = error;
    }
    if (attempt < attempts) await sleep(intervalMs);
  }
  throw new Error(`STATE_POLL_TIMEOUT: ${description}${lastError ? `; last error: ${lastError.message}` : ""}`);
}

export function jobMatches(job, config) {
  return jobIdentityMatches(job, config) &&
    job.status === "OPEN" && BigInt(job.escrow_balance) === 0n;
}

function jobIdentityMatches(job, config) {
  const marker = `[smoke:${config.run_id}]`;
  return job.found === true &&
    job.title === config.job_title && job.description === config.job_description &&
    job.title.includes(marker) && job.description.includes(marker) &&
    sameAddress(job.client, config.client_address) &&
    sameAddress(job.freelancer, config.freelancer_address);
}

export function selectUniqueJob(candidates, config) {
  const matches = candidates.filter((job) => jobMatches(job, config));
  if (matches.length > 1) throw new Error(`JOB_DISCOVERY_MULTIPLE_MATCHES: ${matches.map((job) => job.job_id).join(",")}`);
  return matches[0] ?? null;
}

function assertVerificationEvidence({ journal, job, config, jobId, escrowWei }) {
  if (String(job.job_id) !== String(jobId) || !jobIdentityMatches(job, config)) throw new Error("FINAL_JOB_IDENTITY_MISMATCH");
  if (job.deliverable_url !== config.deliverable_url) throw new Error("FINAL_JOB_DELIVERABLE_URL_MISMATCH");
  if (typeof job.resolved_at !== "string" || !job.resolved_at.trim()) throw new Error("FINAL_JOB_RESOLVED_AT_MISSING");
  const fundedJob = journal.state.funded_job;
  if (!fundedJob || String(fundedJob.job_id) !== String(jobId) || !jobIdentityMatches(fundedJob, config) ||
      fundedJob.status !== "FUNDED" || BigInt(fundedJob.escrow_balance) !== escrowWei) {
    throw new Error("FUNDED_JOB_EVIDENCE_MISMATCH");
  }
  const { step } = selectVerifySuccessStep(journal);
  const expectedRequest = {
    sender: config.client_address,
    address: config.contract_address,
    functionName: "verify_and_release",
    args: [String(jobId)],
    value: "0",
  };
  if (step?.status !== "EXECUTION_CONFIRMED") throw new Error("VERIFY_EXECUTION_NOT_CONFIRMED");
  if (!equalData(step.request, expectedRequest)) throw new Error("VERIFY_REQUEST_MISMATCH");
  if (!SUCCESS_STATUSES.has(step.execution?.status_name) ||
      !SUCCESS_RESULTS.has(step.execution?.result_name) ||
      step.execution?.execution_result_name !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error("VERIFY_EXECUTION_OUTCOME_MISMATCH");
  }
}

function sharedCounterDeltas({ beforeStats, afterStats, beforeProfile, afterProfile }) {
  return {
    total_paid: BigInt(afterStats.total_paid) - BigInt(beforeStats.total_paid),
    total_earned: BigInt(afterProfile.total_earned) - BigInt(beforeProfile.total_earned),
    jobs_completed: BigInt(afterProfile.jobs_completed) - BigInt(beforeProfile.jobs_completed),
  };
}

export function assertApprovalAccounting(input) {
  const { job, escrowWei } = input;
  assertVerificationEvidence(input);
  if (job.status !== "PAID" || job.ai_verdict !== "APPROVED" || BigInt(job.escrow_balance) !== 0n) throw new Error("APPROVAL_JOB_STATE_MISMATCH");
  const deltas = sharedCounterDeltas(input);
  if (deltas.total_paid < escrowWei) throw new Error("APPROVAL_TOTAL_PAID_MINIMUM_NOT_REACHED");
  if (deltas.total_earned < escrowWei) throw new Error("APPROVAL_TOTAL_EARNED_MINIMUM_NOT_REACHED");
  if (deltas.jobs_completed < 1n) throw new Error("APPROVAL_JOBS_COMPLETED_MINIMUM_NOT_REACHED");
  return deltas;
}

export function assertRejectionAccounting(input) {
  const { journal, job, escrowWei } = input;
  assertVerificationEvidence(input);
  if (journal.steps.client_refund) throw new Error("REJECTION_REFUND_STEP_PRESENT");
  if (job.status !== "DISPUTED" || job.ai_verdict !== "REJECTED" || BigInt(job.escrow_balance) !== escrowWei) throw new Error("REJECTION_JOB_STATE_MISMATCH");
  const deltas = sharedCounterDeltas(input);
  if (deltas.total_paid < 0n) throw new Error("REJECTION_TOTAL_PAID_DECREASED");
  if (deltas.total_earned < 0n) throw new Error("REJECTION_TOTAL_EARNED_DECREASED");
  if (deltas.jobs_completed < 0n) throw new Error("REJECTION_JOBS_COMPLETED_DECREASED");
  return deltas;
}

async function run() {
  const flow = process.argv[2];
  if (!new Set(["approval", "rejection"]).has(flow)) throw new Error("Usage: node scripts/smoke-freelance-market.mjs <approval|rejection>");
  const escrowWei = positiveBigInt("SMOKE_ESCROW_WEI", 1n);
  const prefix = flow.toUpperCase();
  const baseTitle = process.env[`${prefix}_JOB_TITLE`] ?? (flow === "approval" ? "Document GenLayer escrow verification" : "Summarize GenLayer escrow requirements");
  const baseDescription = process.env[`${prefix}_JOB_DESCRIPTION`] ?? (flow === "approval"
    ? "Provide a public page that clearly and specifically documents this GenLayer freelance escrow verification workflow and its approval behavior."
    : "Provide a public page that clearly and specifically summarizes this GenLayer freelance escrow contract and its semantic verification requirements.");
  const deliverableUrl = validateDeliverableUrl(required(`${prefix}_DELIVERABLE_URL`));
  const journalPath = `.smoke-freelance-market.${flow}.json`;
  const journal = await loadOrCreateJournal(journalPath, { flow, escrowWei, baseTitle, baseDescription, deliverableUrl });
  const save = (value) => atomicSave(journalPath, value);
  const attempts = positiveInteger("SMOKE_STATE_ATTEMPTS", 120);
  const receiptAttempts = positiveInteger("SMOKE_RECEIPT_ATTEMPTS", 120);
  const intervalMs = positiveInteger("SMOKE_POLL_INTERVAL_MS", 5_000);
  const readClient = createClient({ chain: testnetBradbury });
  const read = async (functionName, args = []) => parseView(functionName, await readClient.readContract({ address: CONTRACT_ADDRESS, functionName, args }));
  const wait = (hash) => waitForSuccessfulExecution(readClient, hash, { attempts: receiptAttempts, intervalMs });

  if (verificationAttempts(journal).length) {
    try {
      const latest = latestVerificationAttempt(journal);
      if (isStrictSuccessEvidence(latest.step)) {
        journal.state.verify_success_step ??= latest.name;
        await save(journal);
      } else {
        await executeVerifyRetry({
          journal,
          authorizedHash: process.env.SMOKE_RETRY_VERIFY_FROM_HASH,
          getTransaction: (hash) => readClient.getTransaction({ hash }),
          readJob: (jobId) => read("get_job", [jobId]),
          save,
          escrowWei,
          loadClientAccount: () => createAccount(required("CLIENT_PRIVATE_KEY")),
          createWriter: (account) => createClient({ chain: testnetBradbury, account }),
          wait,
        });
      }
    } finally {
      console.log("Verification attempts:");
      console.log(JSON.stringify(formatVerificationAttempts(journal), null, 2));
    }
    await finishRun({ flow, journal, save, read, pollAttempts: attempts, intervalMs, escrowWei });
    return;
  }

  const clientAccount = createAccount(required("CLIENT_PRIVATE_KEY"));
  const freelancerAccount = createAccount(required("FREELANCER_PRIVATE_KEY"));
  if (!sameAddress(clientAccount.address, CLIENT_ADDRESS)) throw new Error("CLIENT_PRIVATE_KEY does not match CLIENT_ADDRESS");
  if (!sameAddress(freelancerAccount.address, FREELANCER_ADDRESS)) throw new Error("FREELANCER_PRIVATE_KEY does not match FREELANCER_ADDRESS");
  const client = createClient({ chain: testnetBradbury, account: clientAccount });
  const freelancer = createClient({ chain: testnetBradbury, account: freelancerAccount });

  async function ensureRegistered(role, address, writer) {
    const stepName = `register_${role}`;
    const existingStep = journal.steps[stepName];
    if (existingStep && existingStep.status !== "PRE_EXISTING") {
      await submitStep({ journal, stepName, client: writer, request: {
        address: CONTRACT_ADDRESS, functionName: "register",
        args: [role, `Smoke ${role}`, "Bradbury escrow smoke-test account", "testing", "0", "fixed", "", "", ""], value: 0n,
      }, sender: address, save, wait });
    } else if (!existingStep) {
      const profile = await read("get_profile", [address]);
      if (profile.found) {
        if (profile.role !== role) throw new Error(`${address} has role ${profile.role}, expected ${role}`);
        journal.steps[stepName] = { status: "PRE_EXISTING", address, role, recorded_at: new Date().toISOString() };
        await save(journal);
      } else {
        await submitStep({ journal, stepName, client: writer, request: {
          address: CONTRACT_ADDRESS, functionName: "register",
          args: [role, `Smoke ${role}`, "Bradbury escrow smoke-test account", "testing", "0", "fixed", "", "", ""], value: 0n,
        }, sender: address, save, wait });
      }
    }
    await pollState(() => read("get_profile", [address]), (profile) => profile.found === true && profile.role === role, `${role} registration visible`, attempts, intervalMs);
  }

  await ensureRegistered("client", CLIENT_ADDRESS, client);
  await ensureRegistered("freelancer", FREELANCER_ADDRESS, freelancer);
  const config = journal.config;
  const beforeStats = journal.state.before_stats ?? await read("get_stats");
  const beforeProfile = journal.state.before_freelancer_profile ?? await read("get_profile", [FREELANCER_ADDRESS]);
  if (!beforeProfile.found || beforeProfile.role !== "freelancer") throw new Error("Freelancer baseline profile is invalid");
  journal.state.before_stats ??= beforeStats;
  journal.state.before_freelancer_profile ??= beforeProfile;
  journal.state.before_job_count ??= beforeStats.total_jobs;
  await save(journal);

  await submitStep({ journal, stepName: "create_job", client, sender: CLIENT_ADDRESS, save, wait, request: {
    address: CONTRACT_ADDRESS, functionName: "create_job",
    args: [config.job_title, config.job_description, FREELANCER_ADDRESS, "2099-12-31"], value: 0n,
  } });

  if (!journal.state.job_id) {
    const discovered = await pollState(async () => {
      const current = await read("get_stats");
      const candidates = [];
      for (let id = BigInt(journal.state.before_job_count) + 1n; id <= BigInt(current.total_jobs); id += 1n) candidates.push(await read("get_job", [String(id)]));
      return selectUniqueJob(candidates, config);
    }, Boolean, "unique OPEN smoke job", attempts, intervalMs);
    journal.state.job_id = discovered.job_id;
    await save(journal);
  }
  const jobId = journal.state.job_id;
  await pollState(() => read("get_job", [jobId]), (job) => jobIdentityMatches(job, config), "persisted job identity revalidation", attempts, intervalMs);
  if (!journal.steps.fund_job) {
    await pollState(() => read("get_job", [jobId]), (job) => jobMatches(job, config), "OPEN with zero escrow", attempts, intervalMs);
  }

  await submitStep({ journal, stepName: "fund_job", client, sender: CLIENT_ADDRESS, save, wait, request: {
    address: CONTRACT_ADDRESS, functionName: "fund_job", args: [jobId], value: escrowWei,
  } });
  if (!journal.steps.submit_work) {
    const fundedJob = await pollState(() => read("get_job", [jobId]), (job) => jobIdentityMatches(job, config) && job.status === "FUNDED" && BigInt(job.escrow_balance) === escrowWei, "FUNDED with exact escrow", attempts, intervalMs);
    journal.state.funded_job = fundedJob;
    await save(journal);
  } else if (!journal.state.funded_job) {
    throw new Error("FUNDED_JOB_EVIDENCE_MISSING: cannot attribute the escrow transition");
  }

  await submitStep({ journal, stepName: "submit_work", client: freelancer, sender: FREELANCER_ADDRESS, save, wait, request: {
    address: CONTRACT_ADDRESS, functionName: "submit_work", args: [jobId, config.deliverable_url], value: 0n,
  } });
  if (!journal.steps.verify_and_release) {
    await pollState(() => read("get_job", [jobId]), (job) => job.status === "SUBMITTED" && job.deliverable_url === config.deliverable_url && BigInt(job.escrow_balance) === escrowWei, "SUBMITTED with exact URL and escrow", attempts, intervalMs);
  }

  if (journal.steps.client_refund) throw new Error("REFUND_FORBIDDEN: client_refund step exists");
  await submitStep({ journal, stepName: "verify_and_release", client, sender: CLIENT_ADDRESS, save, wait, request: {
    address: CONTRACT_ADDRESS, functionName: "verify_and_release", args: [jobId], value: 0n,
  } });
  journal.state.verify_success_step = "verify_and_release";
  await save(journal);
  await finishRun({ flow, journal, save, read, pollAttempts: attempts, intervalMs, escrowWei });
}

async function finishRun({ flow, journal, save, read, pollAttempts, intervalMs, escrowWei }) {
  const config = journal.config;
  const jobId = journal.state.job_id;
  const finalJob = await pollState(() => read("get_job", [jobId]), (job) => flow === "approval"
    ? job.status === "PAID" && job.ai_verdict === "APPROVED" && BigInt(job.escrow_balance) === 0n
    : job.status === "DISPUTED" && job.ai_verdict === "REJECTED" && BigInt(job.escrow_balance) === escrowWei,
  `final ${flow} state`, pollAttempts, intervalMs);
  const beforeStats = journal.state.before_stats;
  const beforeProfile = journal.state.before_freelancer_profile;
  const afterStats = await read("get_stats");
  const afterProfile = await read("get_profile", [FREELANCER_ADDRESS]);
  const accounting = { journal, job: finalJob, config, jobId, beforeStats, afterStats, beforeProfile, afterProfile, escrowWei };
  const observedDeltas = flow === "approval" ? assertApprovalAccounting(accounting) : assertRejectionAccounting(accounting);
  console.log("Secondary shared-counter deltas (non-attributable public-deployment activity):", JSON.stringify(Object.fromEntries(Object.entries(observedDeltas).map(([key, value]) => [key, value.toString()]))));
  journal.status = "COMPLETED";
  journal.completed_at = new Date().toISOString();
  journal.state.final_job = finalJob;
  journal.state.after_stats = afterStats;
  journal.state.after_freelancer_profile = afterProfile;
  await save(journal);
  console.log(`Smoke ${flow} run ${config.run_id} completed. Transaction hashes:`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(journal.steps).filter(([, step]) => step.hash).map(([name, step]) => [name, step.hash])), null, 2));
  console.log("Verification attempts:");
  console.log(JSON.stringify(formatVerificationAttempts(journal), null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) run().catch((error) => {
  console.error(`Smoke flow stopped: ${error.message}`);
  process.exitCode = 1;
});
