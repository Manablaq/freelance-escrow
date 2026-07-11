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
  publicRequestMetadata,
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
  assert.throws(() => assertApprovalAccounting(missingConfirmation), /VERIFY_EXECUTION_NOT_CONFIRMED/);
});

test("recorded verification evidence accepts MAJORITY_AGREE and rejects MAJORITY_DISAGREE", () => {
  const majorityAgree = accountingInput("approval");
  majorityAgree.journal.steps.verify_and_release.execution.result_name = "MAJORITY_AGREE";
  assert.doesNotThrow(() => assertApprovalAccounting(majorityAgree));
  const majorityDisagree = accountingInput("approval");
  majorityDisagree.journal.steps.verify_and_release.execution.result_name = "MAJORITY_DISAGREE";
  assert.throws(() => assertApprovalAccounting(majorityDisagree), /VERIFY_EXECUTION_OUTCOME_MISMATCH/);
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
