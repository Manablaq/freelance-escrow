import assert from "node:assert/strict";
import test from "node:test";
import { isSuccessfulDeploymentOutcome } from "../scripts/inspect-freelance-market.mjs";
import {
  JOURNAL_SCHEMA_VERSION,
  MIN_DELIVERABLE_URL_LENGTH,
  MAX_DELIVERABLE_URL_LENGTH,
  MAX_JOB_DESCRIPTION_LENGTH,
  MAX_JOB_TITLE_LENGTH,
  assertApprovalAccounting,
  assertRejectionAccounting,
  buildMarkedJobFields,
  classifyTransaction,
  executeVerifyRetry,
  latestVerificationAttempt,
  nextVerifyRetryStepName,
  prepareVerifyRetry,
  publicRequestMetadata,
  selectVerifySuccessStep,
  selectUniqueJob,
  submitStep,
  validateDeliverableUrl,
  validateJournal,
  validateJobFields,
  waitForSuccessfulExecution,
} from "../scripts/smoke-freelance-market.mjs";

const config = {
  flow: "approval", chain_id: 4221, contract_address: "0xcontract",
  client_address: "0xclient", freelancer_address: "0xfreelancer",
  escrow_wei: "1", run_id: "run-1", job_title: "[smoke:run-1] title",
  job_description: "description [smoke:run-1]", deliverable_url: "https://example.test/work",
};

function journal(overrides = {}) {
  return { schema_version: JOURNAL_SCHEMA_VERSION, status: "ACTIVE", config, steps: {}, state: {}, ...overrides };
}

const success = { statusName: "ACCEPTED", resultName: "AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" };

test("journal configuration mismatch is refused", () => {
  assert.throws(() => validateJournal(journal(), { ...config, escrow_wei: "2" }), /JOURNAL_CONFIG_MISMATCH/);
});

test("completed journal is refused", () => {
  assert.throws(() => validateJournal(journal({ status: "COMPLETED" }), config), /JOURNAL_COMPLETED/);
});

test("ambiguous intent refuses resubmission", async () => {
  let writes = 0;
  const value = journal({ steps: { fund: { status: "INTENT_RECORDED", request: { sender: "0xclient", address: "0xcontract", functionName: "fund", args: ["1"], value: "1" } } } });
  await assert.rejects(submitStep({ journal: value, stepName: "fund", client: { writeContract: async () => { writes += 1; } }, request: { address: "0xcontract", functionName: "fund", args: ["1"], value: 1n }, sender: "0xclient", save: async () => {}, wait: async () => {} }), /AMBIGUOUS_BROADCAST/);
  assert.equal(writes, 0);
});

test("recorded hash is inspected and never submitted", async () => {
  let writes = 0;
  let inspected;
  const request = { address: "0xcontract", functionName: "fund", args: ["1"], value: 1n };
  const value = journal({ steps: { fund: { status: "HASH_RECORDED", hash: "0xhash", request: publicRequestMetadata(request, "0xclient") } } });
  await submitStep({ journal: value, stepName: "fund", client: { writeContract: async () => { writes += 1; } }, request, sender: "0xclient", save: async () => {}, wait: async (hash) => { inspected = hash; } });
  assert.equal(writes, 0);
  assert.equal(inspected, "0xhash");
  assert.equal(value.steps.fund.status, "EXECUTION_CONFIRMED");
});

test("AGREE and MAJORITY_AGREE are successful only with accepted/finalized return execution", () => {
  for (const statusName of ["ACCEPTED", "FINALIZED"]) {
    for (const resultName of ["AGREE", "MAJORITY_AGREE"]) {
      assert.equal(classifyTransaction({ statusName, resultName, txExecutionResultName: "FINISHED_WITH_RETURN" }).kind, "SUCCESS");
    }
  }
  assert.equal(classifyTransaction({ statusName: "ACCEPTED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_ERROR" }).kind, "FAILURE");
  assert.equal(classifyTransaction({ statusName: "REVEALING", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }).kind, "PENDING");
});

test("all installed terminal failure outcomes remain failures", () => {
  for (const statusName of ["UNDETERMINED", "CANCELED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"]) {
    assert.equal(classifyTransaction({ statusName }).kind, "FAILURE");
  }
  for (const resultName of ["NO_MAJORITY", "DISAGREE", "MAJORITY_DISAGREE", "TIMEOUT", "DETERMINISTIC_VIOLATION"]) {
    assert.equal(classifyTransaction({ statusName: "REVEALING", resultName }).kind, "FAILURE");
  }
  assert.equal(classifyTransaction({ statusName: "REVEALING", txExecutionResultName: "FINISHED_WITH_ERROR" }).kind, "FAILURE");
  assert.equal(classifyTransaction({ statusName: "FINALIZED", resultName: "AGREE", txExecutionResultName: "NOT_VOTED" }).kind, "FAILURE");
  assert.equal(classifyTransaction(success).kind, "SUCCESS");
});

test("read-only inspector predicate accepts both successful consensus results", () => {
  for (const statusName of ["ACCEPTED", "FINALIZED"]) {
    assert.equal(isSuccessfulDeploymentOutcome({ statusName, resultName: "AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), true);
    assert.equal(isSuccessfulDeploymentOutcome({ statusName, resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), true);
  }
  assert.equal(isSuccessfulDeploymentOutcome({ statusName: "ACCEPTED", resultName: "MAJORITY_DISAGREE", txExecutionResultName: "FINISHED_WITH_RETURN" }), false);
});

test("exact MAJORITY_AGREE receipt value is persisted in journal execution evidence", async () => {
  const request = { address: "0xcontract", functionName: "verify_and_release", args: ["2"], value: 0n };
  const value = journal({ steps: { verify_and_release: {
    status: "HASH_RECORDED", hash: "0xmajority", request: publicRequestMetadata(request, "0xclient"),
  } } });
  await submitStep({ journal: value, stepName: "verify_and_release", client: { writeContract: async () => assert.fail("must not submit") },
    request, sender: "0xclient", save: async () => {}, wait: async () => ({
      statusName: "ACCEPTED", resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN",
    }) });
  assert.equal(value.steps.verify_and_release.execution.result_name, "MAJORITY_AGREE");
});

test("transient RPC error continues polling the same hash", async () => {
  let calls = 0;
  const transaction = await waitForSuccessfulExecution({ getTransaction: async ({ hash }) => {
    assert.equal(hash, "0xknown");
    calls += 1;
    if (calls === 1) throw new Error("temporary network timeout");
    return success;
  } }, "0xknown", { attempts: 2, intervalMs: 0, sleep: async () => {}, traceFailures: false });
  assert.equal(transaction, success);
  assert.equal(calls, 2);
});

function matchingJob(id = "2") {
  return { found: true, job_id: id, title: config.job_title, description: config.job_description,
    client: config.client_address, freelancer: config.freelancer_address, status: "OPEN", escrow_balance: "0" };
}

test("job selection is concurrency-safe and requires exactly one full match", () => {
  const unrelated = { ...matchingJob("3"), title: "someone else's job" };
  assert.equal(selectUniqueJob([unrelated, matchingJob("2")], config).job_id, "2");
  assert.equal(selectUniqueJob([unrelated], config), null);
  assert.throws(() => selectUniqueJob([matchingJob("2"), matchingJob("4")], config), /JOB_DISCOVERY_MULTIPLE_MATCHES/);
});

test("deliverable URL accepts the inclusive 10 and 500 code-point boundaries", () => {
  const minimum = "http://a.b";
  const prefix = "https://example.test/";
  const atLimit = `${prefix}${"a".repeat(MAX_DELIVERABLE_URL_LENGTH - [...prefix].length)}`;
  assert.equal([...minimum].length, MIN_DELIVERABLE_URL_LENGTH);
  assert.equal(validateDeliverableUrl(minimum), minimum);
  assert.equal([...atLimit].length, 500);
  assert.equal(validateDeliverableUrl(atLimit), atLimit);
});

test("deliverable URL rejects 501 code points before side effects", () => {
  const prefix = "https://example.test/";
  const atLimit = `${prefix}${"a".repeat(MAX_DELIVERABLE_URL_LENGTH - [...prefix].length)}`;
  const overLimit = `${atLimit}a`;
  let journalCreations = 0;
  let writes = 0;
  const prepare = (url) => {
    const validated = validateDeliverableUrl(url);
    journalCreations += 1;
    writes += 1;
    return validated;
  };
  assert.throws(() => prepare(overLimit), /DELIVERABLE_URL_TOO_LONG/);
  assert.equal(journalCreations, 0);
  assert.equal(writes, 0);
});

test("short deliverable URL is rejected before journal, key, or write side effects", () => {
  let journalCreations = 0;
  let privateKeyLoads = 0;
  let writes = 0;
  const prepare = (url) => {
    const validated = validateDeliverableUrl(url);
    journalCreations += 1;
    privateKeyLoads += 1;
    writes += 1;
    return validated;
  };
  assert.throws(() => prepare("http://a"), /DELIVERABLE_URL_TOO_SHORT: 8 code points; allowed range is 10-500/);
  assert.equal(journalCreations, 0);
  assert.equal(privateKeyLoads, 0);
  assert.equal(writes, 0);
});

test("deliverable URL rejects invalid and non-http(s) values", () => {
  for (const value of ["this is not a URL", "/relative/path", "ftp://example.test/work", "file:///tmp/work", "http://:80/path"]) {
    assert.throws(() => validateDeliverableUrl(value), /DELIVERABLE_URL_INVALID/);
  }
});

test("existing journal rejects a short stored deliverable URL", () => {
  const shortUrlConfig = { ...config, deliverable_url: "http://a" };
  assert.throws(() => validateJournal(journal({ config: shortUrlConfig }), shortUrlConfig), /DELIVERABLE_URL_TOO_SHORT/);
});

test("accepted deliverable URL remains byte-for-byte unchanged through journal and submit metadata", () => {
  const exactUrl = "https://example.test/work?value=%2FCaseSensitive";
  const exactConfig = { ...config, deliverable_url: validateDeliverableUrl(exactUrl) };
  const exactJournal = journal({ config: exactConfig });
  validateJournal(exactJournal, exactConfig);
  const metadata = publicRequestMetadata({
    address: exactConfig.contract_address,
    functionName: "submit_work",
    args: ["2", exactUrl],
    value: 0n,
  }, exactConfig.freelancer_address);
  assert.equal(exactJournal.config.deliverable_url, exactUrl);
  assert.equal(metadata.args[1], exactUrl);
});

test("deliverable URL Unicode length uses code points rather than UTF-16 units", () => {
  const value = "http://a.b/🚀";
  assert.equal(value.length, [...value].length + 1);
  assert.equal(validateDeliverableUrl(value), value);
});

function markedFieldsAtLengths(titleLength, descriptionLength, fill = "a") {
  const runId = "run-1";
  const marker = `[smoke:${runId}]`;
  const baseTitle = fill.repeat(titleLength - [...marker].length - 1);
  const baseDescription = fill.repeat(descriptionLength - [...marker].length - 1);
  return { runId, baseTitle, baseDescription, marker };
}

test("final marked job title accepts 100 code points and rejects 101", () => {
  const atLimit = markedFieldsAtLengths(MAX_JOB_TITLE_LENGTH, 20);
  const accepted = buildMarkedJobFields(atLimit.runId, atLimit.baseTitle, atLimit.baseDescription);
  assert.equal([...accepted.jobTitle].length, 100);
  const overLimit = markedFieldsAtLengths(MAX_JOB_TITLE_LENGTH + 1, 20);
  assert.throws(() => buildMarkedJobFields(overLimit.runId, overLimit.baseTitle, overLimit.baseDescription), /JOB_TITLE_TOO_LONG: 101 code points/);
});

test("final marked job description accepts 1000 code points and rejects 1001", () => {
  const atLimit = markedFieldsAtLengths(20, MAX_JOB_DESCRIPTION_LENGTH);
  const accepted = buildMarkedJobFields(atLimit.runId, atLimit.baseTitle, atLimit.baseDescription);
  assert.equal([...accepted.jobDescription].length, 1000);
  const overLimit = markedFieldsAtLengths(20, MAX_JOB_DESCRIPTION_LENGTH + 1);
  assert.throws(() => buildMarkedJobFields(overLimit.runId, overLimit.baseTitle, overLimit.baseDescription), /JOB_DESCRIPTION_TOO_LONG: 1001 code points/);
});

test("base title that fits alone is rejected when its marker makes the final title too long", () => {
  const baseTitle = "a".repeat(90);
  assert.equal([...baseTitle].length <= MAX_JOB_TITLE_LENGTH, true);
  assert.throws(() => buildMarkedJobFields("run-1", baseTitle, "description long enough"), /JOB_TITLE_TOO_LONG/);
});

test("overlong description fails before journal creation or write submission", () => {
  let journalCreations = 0;
  let writes = 0;
  const prepare = (baseDescription) => {
    const fields = buildMarkedJobFields("run-1", "title", baseDescription);
    journalCreations += 1;
    writes += 1;
    return fields;
  };
  assert.throws(() => prepare("a".repeat(1001)), /JOB_DESCRIPTION_TOO_LONG/);
  assert.equal(journalCreations, 0);
  assert.equal(writes, 0);
});

test("astral Unicode characters count as one code point", () => {
  const title = "🚀".repeat(100);
  const description = "🚀".repeat(20);
  assert.equal([...title].length, 100);
  assert.doesNotThrow(() => validateJobFields(title, description));
  assert.throws(() => validateJobFields(`${title}🚀`, description), /JOB_TITLE_TOO_LONG: 101 code points/);
});

test("existing journals with out-of-range stored fields are rejected", () => {
  const longTitleConfig = { ...config, job_title: "a".repeat(101) };
  assert.throws(() => validateJournal(journal({ config: longTitleConfig }), longTitleConfig), /JOB_TITLE_TOO_LONG/);
  const longDescriptionConfig = { ...config, job_description: "a".repeat(1001) };
  assert.throws(() => validateJournal(journal({ config: longDescriptionConfig }), longDescriptionConfig), /JOB_DESCRIPTION_TOO_LONG/);
});

test("validated marked fields remain byte-for-byte unchanged in journal and create request metadata", () => {
  const fields = buildMarkedJobFields("run-1", "title", "description long enough");
  const exactConfig = { ...config, job_title: fields.jobTitle, job_description: fields.jobDescription };
  const exactJournal = journal({ config: exactConfig });
  validateJournal(exactJournal, exactConfig);
  const metadata = publicRequestMetadata({
    address: exactConfig.contract_address,
    functionName: "create_job",
    args: [fields.jobTitle, fields.jobDescription, exactConfig.freelancer_address, "2099-12-31"],
    value: 0n,
  }, exactConfig.client_address);
  assert.equal(exactJournal.config.job_title, fields.jobTitle);
  assert.equal(exactJournal.config.job_description, fields.jobDescription);
  assert.equal(metadata.args[0], exactJournal.config.job_title);
  assert.equal(metadata.args[1], exactJournal.config.job_description);
});

function evidenceJournal() {
  return journal({
    steps: { verify_and_release: {
      status: "EXECUTION_CONFIRMED",
      request: { sender: config.client_address, address: config.contract_address, functionName: "verify_and_release", args: ["2"], value: "0" },
      execution: { status_name: "ACCEPTED", result_name: "AGREE", execution_result_name: "FINISHED_WITH_RETURN" },
    } },
    state: { funded_job: { ...matchingJob("2"), status: "FUNDED", escrow_balance: "1" } },
  });
}

function accountingInput(flow = "approval") {
  const approval = flow === "approval";
  return {
    journal: evidenceJournal(), config, jobId: "2", escrowWei: 1n,
    job: { ...matchingJob("2"), deliverable_url: config.deliverable_url,
      status: approval ? "PAID" : "DISPUTED", ai_verdict: approval ? "APPROVED" : "REJECTED",
      escrow_balance: approval ? "0" : "1", resolved_at: "2026-07-11T00:00:00Z" },
    beforeStats: { total_paid: "10" }, afterStats: { total_paid: approval ? "15" : "14" },
    beforeProfile: { total_earned: "4", jobs_completed: "2" },
    afterProfile: { total_earned: approval ? "9" : "8", jobs_completed: approval ? "5" : "4" },
  };
}

test("approval permits concurrent increases but enforces minimum shared-counter deltas", () => {
  const input = accountingInput("approval");
  assert.doesNotThrow(() => assertApprovalAccounting(input));
  assert.throws(() => assertApprovalAccounting({ ...input, afterStats: { total_paid: "10" } }), /TOTAL_PAID_MINIMUM_NOT_REACHED/);
  assert.throws(() => assertApprovalAccounting({ ...input, afterProfile: { total_earned: "4", jobs_completed: "2" } }), /TOTAL_EARNED_MINIMUM_NOT_REACHED/);
});

test("rejection permits unrelated increases and rejects shared-counter decreases", () => {
  const input = accountingInput("rejection");
  assert.doesNotThrow(() => assertRejectionAccounting(input));
  assert.throws(() => assertRejectionAccounting({ ...input, afterStats: { total_paid: "9" } }), /TOTAL_PAID_DECREASED/);
  assert.throws(() => assertRejectionAccounting({ ...input, afterProfile: { total_earned: "3", jobs_completed: "2" } }), /TOTAL_EARNED_DECREASED/);
});

test("authoritative final job identity and URL are exact", () => {
  const input = accountingInput("approval");
  assert.throws(() => assertApprovalAccounting({ ...input, job: { ...input.job, freelancer: "0xother" } }), /FINAL_JOB_IDENTITY_MISMATCH/);
  assert.throws(() => assertApprovalAccounting({ ...input, job: { ...input.job, deliverable_url: "https://example.test/other" } }), /FINAL_JOB_DELIVERABLE_URL_MISMATCH/);
});

test("verification evidence requires exact request and confirmed successful execution", () => {
  const wrongRequest = accountingInput("approval");
  wrongRequest.journal.steps.verify_and_release.request.args = ["3"];
  assert.throws(() => assertApprovalAccounting(wrongRequest), /VERIFY_REQUEST_MISMATCH/);
  const missingConfirmation = accountingInput("approval");
  missingConfirmation.journal.steps.verify_and_release.status = "HASH_RECORDED";
  assert.throws(() => assertApprovalAccounting(missingConfirmation), /VERIFY_SUCCESS_POINTER_REQUIRED/);
});

test("recorded verification evidence accepts MAJORITY_AGREE and rejects MAJORITY_DISAGREE", () => {
  const majorityAgree = accountingInput("approval");
  majorityAgree.journal.steps.verify_and_release.execution.result_name = "MAJORITY_AGREE";
  assert.doesNotThrow(() => assertApprovalAccounting(majorityAgree));
  const majorityDisagree = accountingInput("approval");
  majorityDisagree.journal.steps.verify_and_release.execution.result_name = "MAJORITY_DISAGREE";
  assert.throws(() => assertApprovalAccounting(majorityDisagree), /VERIFY_SUCCESS_POINTER_REQUIRED/);
});

test("approval and rejection retain exact job escrow assertions", () => {
  const approval = accountingInput("approval");
  approval.job.escrow_balance = "1";
  assert.throws(() => assertApprovalAccounting(approval), /APPROVAL_JOB_STATE_MISMATCH/);
  const rejection = accountingInput("rejection");
  rejection.job.escrow_balance = "2";
  assert.throws(() => assertRejectionAccounting(rejection), /REJECTION_JOB_STATE_MISMATCH/);
});

test("rejection forbids a refund step", () => {
  const input = accountingInput("rejection");
  input.journal.steps.client_refund = {};
  assert.throws(() => assertRejectionAccounting(input), /REFUND_STEP_PRESENT/);
});

test("journal request metadata excludes private keys", () => {
  const secret = "0xsupersecretprivatekey";
  const metadata = publicRequestMetadata({ address: "0xcontract", functionName: "fund", args: ["1"], value: 1n, account: { privateKey: secret } }, "0xclient");
  assert.equal(JSON.stringify(metadata).includes(secret), false);
  assert.deepEqual(Object.keys(metadata).sort(), ["address", "args", "functionName", "sender", "value"]);
});

const terminalFailure = { statusName: "LEADER_TIMEOUT", resultName: "IDLE", txExecutionResultName: "NOT_VOTED" };

function retryJob(overrides = {}) {
  return { ...matchingJob("2"), status: "SUBMITTED", escrow_balance: "1",
    deliverable_url: config.deliverable_url, ai_verdict: "", ai_reasoning: "", resolved_at: "", ...overrides };
}

function retryJournal(extraSteps = {}, state = {}) {
  return journal({ steps: { verify_and_release: {
    status: "HASH_RECORDED", hash: "0xfailed", request: {
      sender: config.client_address, address: config.contract_address,
      functionName: "verify_and_release", args: ["2"], value: "0",
    }, created_at: "created", hash_recorded_at: "recorded",
  }, ...extraSteps }, state: { job_id: "2", ...state } });
}

function retryDependencies(value, overrides = {}) {
  let writes = 0;
  let keyLoads = 0;
  let freelancerKeyLoads = 0;
  const dependencies = {
    journal: value, authorizedHash: "0xfailed", escrowWei: 1n,
    getTransaction: async () => terminalFailure,
    readJob: async () => retryJob(),
    save: async () => {},
    loadClientAccount: () => { keyLoads += 1; return { address: config.client_address }; },
    loadFreelancerAccount: () => { freelancerKeyLoads += 1; throw new Error("must not load"); },
    createWriter: () => ({ writeContract: async () => { writes += 1; return "0xretry"; } }),
    wait: async () => success,
    now: () => "confirmed-at",
    ...overrides,
  };
  return { dependencies, counts: () => ({ writes, keyLoads, freelancerKeyLoads }) };
}

test("manual authorization is exact and missing or wrong hashes perform zero writes", async () => {
  for (const [authorizedHash, error] of [[undefined, /VERIFY_RETRY_REQUIRED/], ["0xwrong", /VERIFY_RETRY_HASH_MISMATCH/]]) {
    const value = retryJournal();
    const fixture = retryDependencies(value, { authorizedHash });
    await assert.rejects(executeVerifyRetry(fixture.dependencies), error);
    assert.deepEqual(fixture.counts(), { writes: 0, keyLoads: 0, freelancerKeyLoads: 0 });
  }
});

test("pending, successful, and malformed previous receipts perform zero writes", async () => {
  for (const [transaction, error] of [
    [{ statusName: "REVEALING", resultName: "IDLE", txExecutionResultName: "NOT_VOTED" }, /PREVIOUS_PENDING/],
    [success, /PREVIOUS_SUCCESSFUL/],
    [{ statusName: "LEADER_TIMEOUT", resultName: "IDLE" }, /RECEIPT_MALFORMED/],
  ]) {
    const fixture = retryDependencies(retryJournal(), { getTransaction: async () => transaction });
    await assert.rejects(executeVerifyRetry(fixture.dependencies), error);
    assert.deepEqual(fixture.counts(), { writes: 0, keyLoads: 0, freelancerKeyLoads: 0 });
  }
});

test("exact terminal failure and exact SUBMITTED job permit one durable numbered write", async () => {
  const value = retryJournal();
  const original = structuredClone(value.steps.verify_and_release);
  const saves = [];
  const fixture = retryDependencies(value, { save: async (current) => saves.push(structuredClone(current)) });
  const stepName = await executeVerifyRetry(fixture.dependencies);
  assert.equal(stepName, "verify_and_release_retry_1");
  assert.deepEqual(fixture.counts(), { writes: 1, keyLoads: 1, freelancerKeyLoads: 0 });
  assert.equal(value.steps.verify_and_release.hash, original.hash);
  assert.deepEqual(value.steps.verify_and_release.request, original.request);
  assert.equal(value.steps.verify_and_release.created_at, original.created_at);
  assert.equal(value.steps.verify_and_release.hash_recorded_at, original.hash_recorded_at);
  assert.deepEqual(value.steps.verify_and_release.execution, {
    status_name: "LEADER_TIMEOUT", result_name: "IDLE", execution_result_name: "NOT_VOTED",
  });
  assert.equal(value.steps.verify_and_release.terminal_failure_confirmed_at, "confirmed-at");
  assert.equal(value.steps.verify_and_release.status, "TERMINAL_FAILURE_CONFIRMED");
  assert.equal(value.steps.verify_and_release_retry_1.hash, "0xretry");
  assert.equal(value.state.verify_success_step, "verify_and_release_retry_1");
  assert.equal(saves.some((saved) => saved.steps.verify_and_release_retry_1?.status === "INTENT_RECORDED"), true);
});

test("retry numbering uses latest numbered attempt and never an older hash", () => {
  const value = retryJournal({
    verify_and_release_retry_2: { status: "HASH_RECORDED", hash: "0xlatest" },
    verify_and_release_retry_1: { status: "TERMINAL_FAILURE_CONFIRMED", hash: "0xolder" },
  });
  assert.equal(latestVerificationAttempt(value).step.hash, "0xlatest");
  assert.equal(nextVerifyRetryStepName(value), "verify_and_release_retry_3");
});

test("failed retry requires its own explicit hash and rerun never broadcasts automatically", async () => {
  const value = retryJournal({ verify_and_release_retry_1: { status: "HASH_RECORDED", hash: "0xretry-failed", request: {} } });
  const fixture = retryDependencies(value, { authorizedHash: undefined });
  await assert.rejects(executeVerifyRetry(fixture.dependencies), /VERIFY_RETRY_REQUIRED/);
  assert.equal(fixture.counts().writes, 0);
  const wrong = retryDependencies(value, { authorizedHash: "0xfailed" });
  await assert.rejects(executeVerifyRetry(wrong.dependencies), /VERIFY_RETRY_HASH_MISMATCH/);
  assert.equal(wrong.counts().writes, 0);
});

test("all read-only job checks precede key loading", async () => {
  const mutations = [
    ["deliverable_url", "https://example.test/changed", /URL_MISMATCH/], ["escrow_balance", "2", /ESCROW_MISMATCH/],
    ["status", "PAID", /STATUS_MISMATCH/], ["ai_verdict", "APPROVED", /VERDICT_NOT_EMPTY/],
    ["ai_reasoning", "reason", /REASONING_NOT_EMPTY/], ["resolved_at", "now", /RESOLVED_AT_NOT_EMPTY/],
    ["title", "changed", /IDENTITY_MISMATCH/], ["job_id", "3", /JOB_ID_MISMATCH/],
  ];
  for (const [field, changed, error] of mutations) {
    const fixture = retryDependencies(retryJournal(), { readJob: async () => retryJob({ [field]: changed }) });
    await assert.rejects(executeVerifyRetry(fixture.dependencies), error);
    assert.deepEqual(fixture.counts(), { writes: 0, keyLoads: 0, freelancerKeyLoads: 0 });
  }
});

test("ambiguous retry intent restart refuses resubmission", async () => {
  const value = retryJournal({ verify_and_release_retry_1: { status: "INTENT_RECORDED", request: {} } });
  const fixture = retryDependencies(value, { authorizedHash: undefined });
  await assert.rejects(executeVerifyRetry(fixture.dependencies), /AMBIGUOUS_BROADCAST/);
  assert.equal(fixture.counts().writes, 0);
});

test("retry write exception retains its new durable intent and is ambiguous", async () => {
  const value = retryJournal();
  const savedStatuses = [];
  const fixture = retryDependencies(value, {
    save: async (current) => savedStatuses.push(current.steps.verify_and_release_retry_1?.status),
    createWriter: () => ({ writeContract: async () => { throw new Error("transport disconnected"); } }),
  });
  await assert.rejects(executeVerifyRetry(fixture.dependencies), /BROADCAST_RESULT_UNKNOWN verify_and_release_retry_1/);
  assert.equal(value.steps.verify_and_release_retry_1.status, "INTENT_RECORDED");
  assert.equal(value.steps.verify_and_release_retry_1.hash, undefined);
  assert.equal(savedStatuses.includes("INTENT_RECORDED"), true);
});

test("final evidence follows a valid success pointer and rejects a failed pointer", () => {
  const input = accountingInput("approval");
  input.journal.steps.verify_and_release.status = "TERMINAL_FAILURE_CONFIRMED";
  input.journal.steps.verify_and_release.execution = { status_name: "LEADER_TIMEOUT", result_name: "IDLE", execution_result_name: "NOT_VOTED" };
  input.journal.steps.verify_and_release_retry_1 = {
    status: "EXECUTION_CONFIRMED", request: { sender: config.client_address, address: config.contract_address,
      functionName: "verify_and_release", args: ["2"], value: "0" },
    execution: { status_name: "FINALIZED", result_name: "MAJORITY_AGREE", execution_result_name: "FINISHED_WITH_RETURN" },
  };
  input.journal.state.verify_success_step = "verify_and_release_retry_1";
  assert.equal(selectVerifySuccessStep(input.journal).name, "verify_and_release_retry_1");
  assert.doesNotThrow(() => assertApprovalAccounting(input));
  input.journal.state.verify_success_step = "verify_and_release";
  assert.throws(() => assertApprovalAccounting(input), /VERIFY_SUCCESS_POINTER_INVALID/);
});

test("terminal evidence is not persisted until all read-only checks pass", async () => {
  const value = retryJournal();
  let saves = 0;
  await assert.rejects(prepareVerifyRetry({ journal: value, authorizedHash: "0xfailed", escrowWei: 1n,
    getTransaction: async () => terminalFailure, readJob: async () => retryJob({ client: "0xchanged" }),
    save: async () => { saves += 1; } }), /IDENTITY_MISMATCH/);
  assert.equal(saves, 0);
  assert.equal(value.steps.verify_and_release.status, "HASH_RECORDED");
});
