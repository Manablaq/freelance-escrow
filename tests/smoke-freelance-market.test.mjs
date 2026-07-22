import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync,
  symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { abi as genlayerAbi, createClient as createPinnedSdkClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { decodeFunctionData, decodeFunctionResult, encodeFunctionResult, keccak256, padHex, toHex, toRlp } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { isSuccessfulDeploymentOutcome } from "../scripts/inspect-freelance-market.mjs";
import {
  JOURNAL_SCHEMA_VERSION,
  BRADBURY_CHAIN_ID,
  BRADBURY_CONTRACT_ADDRESS,
  BRADBURY_CLIENT_ADDRESS,
  BRADBURY_FREELANCER_ADDRESS,
  EXACT_ESCROW_WEI,
  EXTERNAL_ERROR_MARKER,
  LIVE_OPT_IN,
  MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS,
  MIN_DELIVERABLE_URL_LENGTH,
  MAX_DELIVERABLE_URL_LENGTH,
  MAX_JOB_DESCRIPTION_LENGTH,
  MAX_JOB_TITLE_LENGTH,
  acquireJournalLock,
  assertApprovalAccounting,
  assertUnicodeScalarString,
  assertFinalizedExecution,
  assertLiveOptIn,
  assertPreVerificationSnapshots,
  assertRejectionAccounting,
  assertRegistrationProfile,
  buildMarkedJobFields,
  classifyTransaction,
  createBradburyReadClient,
  createBradburyRpcClient,
  createBradburyWriterClient,
  decodeBradburyEqBlocksOutputs,
  executeVerifyRetry,
  extractUniqueGenLayerTransactionId,
  formatVerificationAttempts,
  finishRun,
  isCanonicalPositiveJobId,
  latestVerificationAttempt,
  loadSmokeRuntimeConfig,
  nextVerifyRetryStepName,
  prepareVerifyRetry,
  persistValidatedJournal,
  persistJournalToDisk,
  projectAccountingStats,
  projectContractViewResult,
  projectFreelancerProfile,
  projectJobEvidence,
  projectPinnedTransactionResponse,
  projectTransactionState,
  publicRequestMetadata,
  publicRuntimeMetadata,
  recordPreVerificationSnapshots,
  safeProcessError,
  selectVerifySuccessStep,
  selectUniqueJob,
  submitStep,
  uniqueJournalTemporaryPath,
  validateDeliverableUrl,
  validateJournal,
  validateJournalForPersistence,
  validateStoredCompletedJournal,
  validateEvaluatorEvidence,
  validateJsonRpcResponse,
  validateJobFields,
  verifyConfiguredAccounts,
  verifyConfiguredAccount,
  waitForFinalizedExecution,
  waitForSuccessfulExecution,
} from "../scripts/smoke-freelance-market.mjs";

const EXPECTED_CHAIN_ID = 4221;
const EXPECTED_CONTRACT_ADDRESS = "0x066131dffbE72e27AB40446620792d45a9a6054a";
const EXPECTED_CLIENT_ADDRESS = "0x5bB49021001200fE8156a81c7fcF097e535e7181";
const EXPECTED_FREELANCER_ADDRESS = "0x1f87Ae197af539253978d435aD45cCf28Fb95024";
const EXPECTED_ESCROW_WEI = 1_000_000_000_000_000_000n;
const VERIFY_HASH = `0x${"a".repeat(64)}`;
const OTHER_HASH = `0x${"b".repeat(64)}`;
const FAILED_HASH = `0x${"c".repeat(64)}`;
const RETRY_HASH = `0x${"d".repeat(64)}`;
const KNOWN_HASH = `0x${"e".repeat(64)}`;
const MAJORITY_HASH = `0x${"f".repeat(64)}`;
const NOW = "2026-07-20T12:00:00.000Z";
const CREATED_AT = "2026-07-20T11:58:00.000Z";
const HASH_RECORDED_AT = "2026-07-20T11:59:00.000Z";
const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
const TEST_PRIVATE_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const TEST_SIGNER = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const CONSENSUS_ADDRESS = "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D";
const NEW_TRANSACTION_TOPIC = "0xdab9102861c7483a187584d6371d88316f005af507982ccf95c110879f3ed5a5";
const CREATED_TRANSACTION_TOPIC = "0x8620e7f03a280a3d2aa84bd41ba19524c2d7f1dbfa9d79cb81877b0f8c963f9b";
const EXPECTED_ADD_TRANSACTION_CALLDATA = "0xe71d51960000000000000000000000007e5f4552091a69125d5dfcb7b8c2659029395bdf000000000000000000000000066131dffbe72e27ab40446620792d45a9a6054a0000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000006a5e1bd00000000000000000000000000000000000000000000000000000000000000027e6a41604617267730d0c32066d6574686f6494017665726966795f616e645f72656c656173650000000000000000000000000000000000000000000000000000";
const EXPECTED_SIGNED_RAW_TRANSACTION = "0xf9018c01843b9aca0083030d40940112bf6e83497965a5fdd6dad1e447a6e004271d80b90124e71d51960000000000000000000000007e5f4552091a69125d5dfcb7b8c2659029395bdf000000000000000000000000066131dffbe72e27ab40446620792d45a9a6054a0000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000006a5e1bd00000000000000000000000000000000000000000000000000000000000000027e6a41604617267730d0c32066d6574686f6494017665726966795f616e645f72656c65617365000000000000000000000000000000000000000000000000000082211ea0bdf4e745110d9af32982424bf719e79498b4ee32c8477966f68dc0d5df7c5332a01a830a1a96afbea82b4eac5e98b8c3a89f445c127a7e65b6538dae88b158425f";
const EXPECTED_LOCAL_EVM_HASH = "0xd3891c9bfc4c5de835b471148836d9477ec797d00ddfbe48dc9ac9391c30a5e9";
const PINNED_TRANSACTION_CALLDATA = "0xe6a41604617267730d0c32066d6574686f6494017665726966795f616e645f72656c6561736500";
const PINNED_UNIX_TIMESTAMP = 1_784_548_800;

const config = {
  flow: "approval", chain_id: 4221, contract_address: EXPECTED_CONTRACT_ADDRESS,
  client_address: EXPECTED_CLIENT_ADDRESS, freelancer_address: EXPECTED_FREELANCER_ADDRESS,
  escrow_wei: String(EXPECTED_ESCROW_WEI), run_id: RUN_ID, job_title: `[smoke:${RUN_ID}] title`,
  job_description: `description [smoke:${RUN_ID}]`, deliverable_url: "https://example.test/work",
};

const BRADBURY_FIXTURE_DIRECTORY = fileURLToPath(new URL("./fixtures/bradbury-supported-runtime/", import.meta.url));
let authenticatedBradburyFixtures;
const APPROVAL_TRANSACTION_ID = "0xed2e2b341793ec3a1fd48fa096e6ada5c8ed4b83b6ec9fc4d446a20c4c946eb6";
const REJECTION_TRANSACTION_ID = "0x3113ee6d3bfbb4c911ed2c9b72b090ab081cf8edfcd068be8bcb90a53f0880fa";
const HISTORICAL_ETH_CALL_DESTINATION = "0x85D7bf947A512Fc640C75327A780c90847267697";
const FIXTURE_TRUST_ANCHORS = Object.freeze({
  "approval-getTransactionData-request.json": Object.freeze({ sha256: "5b4d6cf4c33938c3350825306b971d07e1b94c26a6d3756177bf87c514c41800", transactionId: APPROVAL_TRANSACTION_ID, kind: "request", method: "getTransactionData", selector: "4a49d992", id: 1, timestamp: 1_784_547_603 }),
  "approval-getTransactionData-response.json": Object.freeze({ sha256: "7d3db5237dffb19a399a48333959cbeb8c8da47fa0972ba2f96f234062608c12", transactionId: APPROVAL_TRANSACTION_ID, kind: "response", method: "getTransactionData", id: 1, outputLength: 580 }),
  "approval-getTransactionAllData-request.json": Object.freeze({ sha256: "f97fe405927ff960c51895867cc85eb7ea790224c4e98aec135c48342b4f0ca4", transactionId: APPROVAL_TRANSACTION_ID, kind: "request", method: "getTransactionAllData", selector: "3b01d02b", id: 2 }),
  "approval-getTransactionAllData-response.json": Object.freeze({ sha256: "af66321c1964fb7cc612d1723e1f2d98836f46ca31e67308c27c2be0f48c9632", transactionId: APPROVAL_TRANSACTION_ID, kind: "response", method: "getTransactionAllData", id: 2, outputLength: 580 }),
  "rejection-getTransactionData-request.json": Object.freeze({ sha256: "e2266e2b870240d7d96dc67cfb67073b4dbeba7fe3b47bc04eecd77033fd774e", transactionId: REJECTION_TRANSACTION_ID, kind: "request", method: "getTransactionData", selector: "4a49d992", id: 3, timestamp: 1_784_547_604 }),
  "rejection-getTransactionData-response.json": Object.freeze({ sha256: "4e2a12bfc77916ab05def3b41e3129bf52c8eef5b8774158b6ee7e4d8e9615a2", transactionId: REJECTION_TRANSACTION_ID, kind: "response", method: "getTransactionData", id: 3, outputLength: 313 }),
  "rejection-getTransactionAllData-request.json": Object.freeze({ sha256: "d80f8d95f919afe34f20ddb868be3409f1fc80136559eb864798a7373d25a61c", transactionId: REJECTION_TRANSACTION_ID, kind: "request", method: "getTransactionAllData", selector: "3b01d02b", id: 4 }),
  "rejection-getTransactionAllData-response.json": Object.freeze({ sha256: "4bd57cb9732767c83916834335bb1bf3e303ebd8622b862770888ffbda656fe5", transactionId: REJECTION_TRANSACTION_ID, kind: "response", method: "getTransactionAllData", id: 4, outputLength: 313 }),
});
const HISTORICAL_EXPECTATIONS = Object.freeze({
  [APPROVAL_TRANSACTION_ID]: Object.freeze({ approved: true, score: 95, length: 580,
    digest: "12c8bffd0d788908f2ab04dbbce5e1fac3955590247925bbb50f3b696c46819e" }),
  [REJECTION_TRANSACTION_ID]: Object.freeze({ approved: false, score: 0, length: 313,
    digest: "4b942ab906ddb4309599ab192962bed72a223f4e124daf305655f29c51287487" }),
});

function exactPlainJson(raw, keys) {
  const parsed = JSON.parse(Buffer.from(raw).toString("utf8"));
  assert.equal(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), true);
  assert.deepEqual(Object.keys(parsed).sort(), [...keys].sort());
  return parsed;
}

function assertClosedPlainDataObject(value, keys) {
  assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort());
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.equal(descriptor !== undefined && Object.hasOwn(descriptor, "value") &&
      !Object.hasOwn(descriptor, "get") && !Object.hasOwn(descriptor, "set"), true, key);
  }
  return value;
}

function assertClosedPlainDataArray(value, length) {
  assert.equal(Array.isArray(value), true);
  assert.equal(Object.getPrototypeOf(value), Array.prototype);
  assert.equal(value.length, length);
  const expectedKeys = [...Array(length).keys()].map(String).concat("length").sort();
  assert.deepEqual(Reflect.ownKeys(value).sort(), expectedKeys);
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.equal(descriptor !== undefined && Object.hasOwn(descriptor, "value") &&
      !Object.hasOwn(descriptor, "get") && !Object.hasOwn(descriptor, "set"), true, key);
  }
  return value;
}

function validateBradburyManifest(manifest) {
  assertClosedPlainDataObject(manifest,
    ["schema_version", "network", "chain_id", "genlayer_js_version", "fixtures"]);
  assert.deepEqual({ schema_version: manifest.schema_version, network: manifest.network, chain_id: manifest.chain_id,
    genlayer_js_version: manifest.genlayer_js_version },
  { schema_version: 1, network: "Genlayer Bradbury Testnet", chain_id: 4221, genlayer_js_version: "1.1.8" });
  assertClosedPlainDataArray(manifest.fixtures, Object.keys(FIXTURE_TRUST_ANCHORS).length);
  const fixtureKeys = ["historical_transaction_id", "rpc_method", "sdk_contract_method", "source_filename",
    "kind", "sha256", "eq_blocks_outputs_byte_length"];
  const seen = new Set();
  for (const entry of manifest.fixtures) {
    assertClosedPlainDataObject(entry, fixtureKeys);
    assert.equal(typeof entry.source_filename, "string");
    assert.equal(Object.hasOwn(FIXTURE_TRUST_ANCHORS, entry.source_filename), true);
    assert.equal(seen.has(entry.source_filename), false);
    seen.add(entry.source_filename);
    const anchor = FIXTURE_TRUST_ANCHORS[entry.source_filename];
    assert.deepEqual(entry, { historical_transaction_id: anchor.transactionId, rpc_method: "eth_call",
      sdk_contract_method: anchor.method === "getTransactionData" ? "getTransactionData(bytes32,uint256)" :
        "getTransactionAllData(bytes32)", source_filename: entry.source_filename, kind: anchor.kind, sha256: anchor.sha256,
      eq_blocks_outputs_byte_length: anchor.kind === "response" ? anchor.outputLength : null });
  }
  assert.deepEqual([...seen].sort(), Object.keys(FIXTURE_TRUST_ANCHORS).sort());
  return manifest;
}

function authenticateRawRequest(raw, anchor) {
  const request = exactPlainJson(raw, ["jsonrpc", "id", "method", "params"]);
  assert.equal(request.jsonrpc, "2.0");
  assert.equal(request.id, anchor.id);
  assert.equal(request.method, "eth_call");
  assert.equal(Array.isArray(request.params) && request.params.length === 2, true);
  assert.equal(request.params[1], "latest");
  assert.deepEqual(Object.keys(request.params[0]).sort(), ["data", "to"]);
  assert.equal(request.params[0].to, HISTORICAL_ETH_CALL_DESTINATION);
  const expectedData = `0x${anchor.selector}${anchor.transactionId.slice(2)}`;
  if (anchor.method === "getTransactionData") {
    assert.equal(request.params[0].data.length, expectedData.length + 64);
    assert.equal(request.params[0].data.slice(0, expectedData.length), expectedData);
    const timestampHex = request.params[0].data.slice(expectedData.length);
    assert.match(timestampHex, /^[0-9a-f]{64}$/);
    assert.equal(Number(BigInt(`0x${timestampHex}`)), anchor.timestamp);
    assert.equal(anchor.timestamp >= 1_784_505_600 && anchor.timestamp < 1_784_592_000, true);
  } else {
    assert.equal(request.params[0].data, expectedData);
  }
  return { request, transactionId: anchor.transactionId };
}

function authenticateRawResponse(raw, anchor, matchingRequest) {
  const response = exactPlainJson(raw, ["jsonrpc", "result", "id"]);
  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, matchingRequest.request.id);
  assert.equal(anchor.id, matchingRequest.request.id);
  assert.equal(Object.hasOwn(response, "result") !== Object.hasOwn(response, "error"), true);
  assert.match(response.result, /^0x(?:[0-9a-f]{2})+$/);
  const contract = testnetBradbury.consensusDataContract;
  if (anchor.method === "getTransactionData") {
    const transactionData = decodeFunctionResult({ abi: contract.abi, functionName: "getTransactionData", data: response.result });
    assert.equal(transactionData.txId.toLowerCase(), matchingRequest.transactionId);
    assert.equal(Number(transactionData.currentTimestamp), FIXTURE_TRUST_ANCHORS[
      anchor.transactionId === APPROVAL_TRANSACTION_ID ? "approval-getTransactionData-request.json" :
        "rejection-getTransactionData-request.json"].timestamp);
    return { transactionData };
  }
  const decoded = decodeFunctionResult({ abi: contract.abi, functionName: "getTransactionAllData", data: response.result });
  assert.equal(Array.isArray(decoded) && decoded.length === 2, true);
  const [transactionAllData, roundsData] = decoded;
  assert.equal(transactionAllData.id.toLowerCase(), matchingRequest.transactionId);
  assert.equal(Array.isArray(roundsData), true);
  return { transactionAllData, roundsData };
}

function loadAuthenticatedBradburyFixtures({ rawOverrides = new Map(), manifestOverride } = {}) {
  if (authenticatedBradburyFixtures && rawOverrides.size === 0 && manifestOverride === undefined) return authenticatedBradburyFixtures;
  const files = new Map();
  for (const [filename, anchor] of Object.entries(FIXTURE_TRUST_ANCHORS)) {
    const raw = rawOverrides.get(filename) ?? readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, filename));
    assert.equal(createHash("sha256").update(raw).digest("hex"), anchor.sha256, filename);
    files.set(filename, raw);
  }
  const manifest = validateBradburyManifest(manifestOverride ??
    JSON.parse(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, "manifest.json"), "utf8")));
  const transactions = new Map();
  for (const transactionId of [APPROVAL_TRANSACTION_ID, REJECTION_TRANSACTION_ID]) {
    const anchors = Object.entries(FIXTURE_TRUST_ANCHORS).filter(([, anchor]) => anchor.transactionId === transactionId);
    const by = (method, kind) => anchors.find(([, anchor]) => anchor.method === method && anchor.kind === kind);
    const [currentRequestName, currentRequestAnchor] = by("getTransactionData", "request");
    const [allRequestName, allRequestAnchor] = by("getTransactionAllData", "request");
    const currentRequest = authenticateRawRequest(files.get(currentRequestName), currentRequestAnchor);
    const allRequest = authenticateRawRequest(files.get(allRequestName), allRequestAnchor);
    assert.equal(currentRequest.transactionId, allRequest.transactionId);
    const [currentResponseName, currentResponseAnchor] = by("getTransactionData", "response");
    const [allResponseName, allResponseAnchor] = by("getTransactionAllData", "response");
    const current = authenticateRawResponse(files.get(currentResponseName), currentResponseAnchor, currentRequest);
    const all = authenticateRawResponse(files.get(allResponseName), allResponseAnchor, allRequest);
    assert.equal(current.transactionData.eqBlocksOutputs, all.transactionAllData.eqBlocksOutputs);
    transactions.set(transactionId, { transactionId, ...current, ...all });
  }
  const authenticated = { manifest, files, transactions };
  if (rawOverrides.size === 0 && manifestOverride === undefined) authenticatedBradburyFixtures = authenticated;
  return authenticated;
}

function historicalTransaction(transactionId) {
  assert.equal(Object.hasOwn(HISTORICAL_EXPECTATIONS, transactionId), true);
  return loadAuthenticatedBradburyFixtures().transactions.get(transactionId);
}

function encodeUleb128(value) {
  const bytes = [];
  let remaining = BigInt(value);
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return bytes;
}

function encodedEqOutput(value, { status = 0, extraItems = [], duplicate = false } = {}) {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  const jsonBytes = new TextEncoder().encode(json);
  const calldata = Uint8Array.from([...encodeUleb128((BigInt(jsonBytes.length) << 3n) | 4n), ...jsonBytes]);
  const envelope = toHex(Uint8Array.from([status, ...calldata]));
  return toRlp([envelope, ...(duplicate ? [envelope] : []), ...extraItems, "0x706164646564"]);
}

function rpcResult(id, result) {
  return { ok: true, text: async () => JSON.stringify({ jsonrpc: "2.0", id, result }) };
}

function encodedContractJson(value) {
  return Buffer.from(genlayerAbi.calldata.encode(JSON.stringify(value))).toString("hex");
}

function syntheticBradburyGenCallResult(data) {
  return {
    data,
    eqOutputs: [],
    events: [],
    logs: [
      { file: "runtime.rs", level: "INFO", message: "started", target: "genvm", ts: "1784558796000",
        version: "1.0.0" },
      { file: "executor.rs", genvm_id: "abc123", level: "INFO", message: "ready", target: "executor",
        ts: "1784558796001" },
      { file: "metrics.rs", level: "INFO", message: "metrics", metrics: {
        gvm: {
          host: { time: 1 }, llm_module: { calls: 0, time: 0 },
          supervisor: { compilation_time: 1, compiled_modules: 1, precompile_hits: 0 },
          web_module: { calls: 0, time: 0 },
        },
        llm: null,
        web: null,
      }, target: "genvm", ts: "1784558796002" },
      { file: "executor.rs", level: "INFO", message: "completed", target: "executor", ts: "1784558796003" },
    ],
    messages: [],
    nondetDisagreementCallNo: null,
    status: { code: 0, message: "success" },
    stderr: "",
    stdout: "",
    syncedBlock: "0x1234",
  };
}

test("historical Bradbury raw fixtures authenticate before decoding", () => {
  const { manifest, files } = loadAuthenticatedBradburyFixtures();
  assert.equal(manifest.fixtures.length, 8);
  assert.equal(files.size, 8);
  assert.deepEqual([...new Set(manifest.fixtures.filter(({ kind }) => kind === "response")
    .map(({ eq_blocks_outputs_byte_length }) => eq_blocks_outputs_byte_length))].sort((a, b) => a - b), [313, 580]);
});

test("descriptive manifest rejects unknown or missing top-level keys and wrong fixed identity fields", () => {
  const readManifest = () => JSON.parse(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, "manifest.json"), "utf8"));
  for (const mutate of [
    (value) => { value.unknown = true; },
    (value) => { delete value.network; },
    (value) => { value.network = "Genlayer Testnet"; },
    (value) => { value.chain_id = 1; },
    (value) => { value.schema_version = 2; },
    (value) => { value.genlayer_js_version = "1.1.9"; },
  ]) {
    const manifest = readManifest();
    mutate(manifest);
    assert.throws(() => loadAuthenticatedBradburyFixtures({ manifestOverride: manifest }));
  }
});

test("descriptive manifest rejects extra, missing, duplicate, and open nested fixture mappings", () => {
  const readManifest = () => JSON.parse(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, "manifest.json"), "utf8"));
  for (const mutate of [
    (value) => { value.fixtures.push(structuredClone(value.fixtures[0])); },
    (value) => { value.fixtures.pop(); },
    (value) => { value.fixtures[7] = structuredClone(value.fixtures[0]); },
    (value) => { value.fixtures[0].unknown = true; },
  ]) {
    const manifest = readManifest();
    mutate(manifest);
    assert.throws(() => loadAuthenticatedBradburyFixtures({ manifestOverride: manifest }));
  }
});

test("descriptive manifest is a closed plain-data object with no custom prototypes or accessors", () => {
  const readManifest = () => JSON.parse(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, "manifest.json"), "utf8"));
  const customPrototype = readManifest();
  Object.setPrototypeOf(customPrototype, { inherited: true });
  assert.throws(() => loadAuthenticatedBradburyFixtures({ manifestOverride: customPrototype }));

  let accessorEvaluations = 0;
  const accessor = readManifest();
  Object.defineProperty(accessor, "network", { enumerable: true, get() {
    accessorEvaluations += 1;
    return "Genlayer Bradbury Testnet";
  } });
  assert.throws(() => loadAuthenticatedBradburyFixtures({ manifestOverride: accessor }));
  assert.equal(accessorEvaluations, 0);
});

test("evidence documentation limits parser and SIGKILL claims to the exact implemented checks", () => {
  const evidence = readFileSync(fileURLToPath(
    new URL("../docs/BRADBURY_SUPPORTED_RUNTIME_EVIDENCE_2026-07-20.md", import.meta.url)), "utf8");
  assert.match(evidence, /does not use a regular expression, substring search, brace scanning/);
  assert.match(evidence, /selected only through the closed RLP → GenVM → calldata structural path/);
  assert.match(evidence, /duplicate-key check is not used to discover or choose the output/);
  assert.equal(evidence.includes("It performs no byte substring search, regular expression search"), false);
  for (const claim of [
    "after durable transaction-record creation",
    "after prior journal/sidecar backup creation",
    "after sidecar canonical rename",
    "after journal canonical rename",
    "after `PREPARED_AFTER_RENAME` is sent",
    "after `COMMIT_ACKNOWLEDGED` is durably written and fsynced but before final helper success",
    "Genuine parent `SIGKILL` tests exercise two exact windows",
    "Both next-invocation cases run recovery again to prove idempotence",
  ]) assert.equal(evidence.includes(claim), true, claim);
});

test("fixture authentication rejects coordinated metadata edits, filename and label swaps, and transaction swaps", () => {
  const approvalRequestName = "approval-getTransactionData-request.json";
  const rejectionRequestName = "rejection-getTransactionData-request.json";
  const approvalRaw = readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, approvalRequestName));
  const rejectionRaw = readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, rejectionRequestName));
  const coordinatedRaw = Buffer.concat([approvalRaw, Buffer.from(" ")]);
  const coordinatedManifest = JSON.parse(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, "manifest.json"), "utf8"));
  coordinatedManifest.fixtures.find(({ source_filename }) => source_filename === approvalRequestName).sha256 =
    createHash("sha256").update(coordinatedRaw).digest("hex");
  assert.throws(() => loadAuthenticatedBradburyFixtures({ rawOverrides: new Map([[approvalRequestName, coordinatedRaw]]),
    manifestOverride: coordinatedManifest }));
  assert.throws(() => loadAuthenticatedBradburyFixtures({ rawOverrides: new Map([
    [approvalRequestName, rejectionRaw], [rejectionRequestName, approvalRaw],
  ]) }));

  const swappedLabels = JSON.parse(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, "manifest.json"), "utf8"));
  for (const entry of swappedLabels.fixtures) {
    entry.source_filename = entry.source_filename.startsWith("approval-")
      ? entry.source_filename.replace("approval-", "rejection-")
      : entry.source_filename.replace("rejection-", "approval-");
  }
  assert.throws(() => loadAuthenticatedBradburyFixtures({ manifestOverride: swappedLabels }));

  const swappedTransaction = JSON.parse(approvalRaw.toString("utf8"));
  swappedTransaction.params[0].data = swappedTransaction.params[0].data.replace(
    APPROVAL_TRANSACTION_ID.slice(2), REJECTION_TRANSACTION_ID.slice(2));
  assert.throws(() => authenticateRawRequest(Buffer.from(JSON.stringify(swappedTransaction)),
    FIXTURE_TRUST_ANCHORS[approvalRequestName]));
});

test("request and response authentication rejects IDs, methods, selectors, timestamps, and wrong pairings", () => {
  const requestName = "approval-getTransactionData-request.json";
  const responseName = "approval-getTransactionData-response.json";
  const requestAnchor = FIXTURE_TRUST_ANCHORS[requestName];
  const responseAnchor = FIXTURE_TRUST_ANCHORS[responseName];
  const requestObject = JSON.parse(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, requestName), "utf8"));
  for (const mutate of [
    (value) => { value.method = "eth_getTransactionByHash"; },
    (value) => { value.params[0].data = `0x00000000${value.params[0].data.slice(10)}`; },
    (value) => { value.params[0].data = value.params[0].data.slice(0, -64); },
    (value) => { value.params = [value.params[0]]; },
  ]) {
    const changed = structuredClone(requestObject);
    mutate(changed);
    assert.throws(() => authenticateRawRequest(Buffer.from(JSON.stringify(changed)), requestAnchor));
  }
  const authenticatedRequest = authenticateRawRequest(Buffer.from(JSON.stringify(requestObject)), requestAnchor);
  const responseObject = JSON.parse(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, responseName), "utf8"));
  responseObject.id = 99;
  assert.throws(() => authenticateRawResponse(Buffer.from(JSON.stringify(responseObject)), responseAnchor, authenticatedRequest));
  const resultAndError = JSON.parse(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, responseName), "utf8"));
  resultAndError.error = { code: -1, message: "forbidden competing branch" };
  assert.throws(() => authenticateRawResponse(Buffer.from(JSON.stringify(resultAndError)), responseAnchor, authenticatedRequest));

  const rejectionRequestName = "rejection-getTransactionData-request.json";
  const rejectionRequest = authenticateRawRequest(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, rejectionRequestName)),
    FIXTURE_TRUST_ANCHORS[rejectionRequestName]);
  const matchingIdWrongResponse = JSON.parse(readFileSync(join(BRADBURY_FIXTURE_DIRECTORY, responseName), "utf8"));
  matchingIdWrongResponse.id = rejectionRequest.request.id;
  assert.throws(() => authenticateRawResponse(Buffer.from(JSON.stringify(matchingIdWrongResponse)),
    { ...responseAnchor, id: rejectionRequest.request.id }, rejectionRequest));
});

test("real approval and rejection responses decode the exact historical comparative results", () => {
  const approval = historicalTransaction(APPROVAL_TRANSACTION_ID);
  const rejection = historicalTransaction(REJECTION_TRANSACTION_ID);
  const approvalEvidence = decodeBradburyEqBlocksOutputs(approval.transactionData.eqBlocksOutputs, approval.transactionId);
  const rejectionEvidence = decodeBradburyEqBlocksOutputs(rejection.transactionData.eqBlocksOutputs, rejection.transactionId);
  assert.equal(validateEvaluatorEvidence(approvalEvidence, approval.transactionId), approvalEvidence);
  assert.equal(validateEvaluatorEvidence(rejectionEvidence, rejection.transactionId), rejectionEvidence);
  assert.deepEqual({ approved: approvalEvidence.approved, score: approvalEvidence.score,
    bytes: approvalEvidence.eq_blocks_outputs_byte_length, digest: approvalEvidence.eq_blocks_outputs_sha256 },
  { approved: true, score: 95, bytes: 580, digest: "12c8bffd0d788908f2ab04dbbce5e1fac3955590247925bbb50f3b696c46819e" });
  assert.deepEqual({ approved: rejectionEvidence.approved, score: rejectionEvidence.score,
    bytes: rejectionEvidence.eq_blocks_outputs_byte_length, digest: rejectionEvidence.eq_blocks_outputs_sha256 },
  { approved: false, score: 0, bytes: 313, digest: "4b942ab906ddb4309599ab192962bed72a223f4e124daf305655f29c51287487" });
  assert.equal(approvalEvidence.reason.sha256, "3a0d8c90da22f477104b7a1b2e2a036bdcb9bbf1b42ac797d6796c17b1e01108");
  assert.equal(rejectionEvidence.evidence_summary.sha256, "849504364d612e4e8fac8d2f491e5a54bf560451ebd46e37b0ff1b06ee59f04f");
});

test("historical dual transaction-data methods bind identical evaluator outputs and identities", () => {
  for (const transactionId of [APPROVAL_TRANSACTION_ID, REJECTION_TRANSACTION_ID]) {
    const fixture = historicalTransaction(transactionId);
    assert.equal(fixture.transactionData.eqBlocksOutputs, fixture.transactionAllData.eqBlocksOutputs);
    const projected = projectPinnedTransactionResponse({ ...fixture, requestedHash: fixture.transactionId,
      requestedTimestamp: Number(fixture.transactionData.currentTimestamp) });
    assert.equal(projected.hash.toLowerCase(), fixture.transactionId.toLowerCase());
    assert.equal(projected.txId.toLowerCase(), fixture.transactionId.toLowerCase());
    assert.equal(projected.evaluatorEvidence.transaction_id, fixture.transactionId);
    assert.equal(projected.evaluatorEvidence.approved, HISTORICAL_EXPECTATIONS[transactionId].approved);
  }
});

test("historical evaluator binding rejects wrong transaction IDs and cross-source output mismatch", () => {
  const fixture = historicalTransaction(APPROVAL_TRANSACTION_ID);
  assert.throws(() => projectPinnedTransactionResponse({ ...fixture, requestedHash: OTHER_HASH,
    requestedTimestamp: Number(fixture.transactionData.currentTimestamp) }), /TRANSACTION_RESPONSE_IDENTITY_MISMATCH/);
  const mismatchedAll = structuredClone(fixture.transactionAllData);
  mismatchedAll.eqBlocksOutputs = historicalTransaction(REJECTION_TRANSACTION_ID).transactionAllData.eqBlocksOutputs;
  assert.throws(() => projectPinnedTransactionResponse({ ...fixture, transactionAllData: mismatchedAll,
    requestedHash: fixture.transactionId, requestedTimestamp: Number(fixture.transactionData.currentTimestamp) }),
  /TRANSACTION_RESPONSE_IDENTITY_MISMATCH/);
});

test("closed comparative decoder rejects empty, null, truncated, malformed, trailing, and ambiguous structures", () => {
  const fixture = historicalTransaction(APPROVAL_TRANSACTION_ID);
  const valid = fixture.transactionData.eqBlocksOutputs;
  const schema = { approved: true, score: 95, reason: "bounded", evidence_summary: "bounded" };
  for (const malformed of ["0x", null, valid.slice(0, -2), `${valid}00`, "0xc0", encodedEqOutput(schema, { status: 1 }),
    encodedEqOutput(schema, { duplicate: true }), encodedEqOutput(schema, { extraItems: ["0x01"] })]) {
    assert.throws(() => decodeBradburyEqBlocksOutputs(malformed, fixture.transactionId));
  }
});

test("closed comparative decoder rejects invalid JSON, UTF-8, and evaluator schemas", () => {
  const transactionId = APPROVAL_TRANSACTION_ID;
  const valid = { approved: true, score: 95, reason: "bounded", evidence_summary: "bounded" };
  const invalidValues = ["{invalid", { score: 95, reason: "bounded", evidence_summary: "bounded" },
    { ...valid, approved: 1 }, { ...valid, score: -1 }, { ...valid, unexpected: true },
    { ...valid, reason: "" }, { ...valid, evidence_summary: "" }];
  for (const value of invalidValues) assert.throws(() => decodeBradburyEqBlocksOutputs(encodedEqOutput(value), transactionId));
  const invalidUtf8 = toRlp([toHex(Uint8Array.from([0, 12, 0xff])), "0x706164646564"]);
  assert.throws(() => decodeBradburyEqBlocksOutputs(invalidUtf8, transactionId), /UTF8_INVALID/);
});

test("validator-controlled strings require Unicode scalar values before UTF-8 hashing", () => {
  for (const invalid of ["\ud800", "\udc00", "\ud800\ud801", "\udc00\ud800", "x\ud800", "\udc00x"]) {
    assert.throws(() => assertUnicodeScalarString(invalid), /UNICODE_SCALAR_INVALID/);
  }
  for (const valid of ["", "ordinary ASCII", "café", "\ud83d\ude80", "\ud83d\ude80\ud83c\udf0d"]) {
    assert.equal(assertUnicodeScalarString(valid), valid);
  }
  const base = `"approved":true,"score":95,"evidence_summary":"bounded"`;
  for (const escaped of ["\\ud800", "\\udc00", "\\ud800\\ud801", "\\udc00\\ud800"]) {
    const source = `{${base},"reason":"${escaped}"}`;
    assert.throws(() => decodeBradburyEqBlocksOutputs(encodedEqOutput(source), APPROVAL_TRANSACTION_ID),
      /EVALUATOR_REASON_INVALID/);
  }
  const validPair = `{${base},"reason":"\\ud83d\\ude80\\ud83c\\udf0d"}`;
  assert.equal(decodeBradburyEqBlocksOutputs(encodedEqOutput(validPair), APPROVAL_TRANSACTION_ID).reason.byte_length, 8);
});

test("hand-authored RLP, GenVM, and calldata adversarial vectors fail closed", () => {
  const vectors = {
    rlp_nonminimal_short_string: "0xc9810086706164646564",
    rlp_nonminimal_long_string_length: "0xcab8010086706164646564",
    rlp_nonminimal_short_list: "0xf809810086706164646564",
    rlp_nonminimal_long_list_length: "0xf809810086706164646564",
    rlp_leading_zero_length_of_length: "0xf90009810086706164646564",
    rlp_declared_shorter_than_payload: "0xc8810086706164646564",
    rlp_declared_longer_than_payload: "0xca810086706164646564",
    rlp_nested_result_list: "0xc8c086706164646564",
    rlp_string_instead_of_outer_list: "0x89810086706164646564",
    rlp_additional_third_item: "0xc9010186706164646564",
    rlp_missing_padded_item: "0xc100",
    rlp_wrong_padded_marker: "0xc80086706164646565",
    rlp_trailing_byte: "0xc8008670616464656400",
    genvm_wrong_return_tag: "0xcc8401147b7d86706164646564",
    genvm_unsupported_envelope_tag: "0xcc8402147b7d86706164646564",
    genvm_missing_tag: "0xcb83147b7d86706164646564",
    genvm_additional_envelope_byte: "0xcd8500147b7d0086706164646564",
    genvm_zero_length_payload: "0xca82000486706164646564",
    calldata_noncanonical_uleb128: "0xcb8300840086706164646564",
    calldata_overlong_uleb128: "0xcc840084800086706164646564",
    calldata_unterminated_uleb128: "0xca82008486706164646564",
    calldata_declared_length_smaller: "0xcc84000c7b7d86706164646564",
    calldata_declared_length_larger: "0xcc84001c7b7d86706164646564",
    calldata_extra_byte: "0xcd8500147b7d0086706164646564",
    calldata_wrong_tag: "0xcc8400107b7d86706164646564",
    calldata_empty_json: "0xca82000486706164646564",
    text_invalid_utf8: "0xcb83000cff86706164646564",
  };
  for (const [meaning, vector] of Object.entries(vectors)) {
    assert.throws(() => decodeBradburyEqBlocksOutputs(vector, APPROVAL_TRANSACTION_ID), meaning);
  }
});

test("hand-authored evaluator JSON and selector ambiguity vectors fail closed", () => {
  const sources = [
    "{}{}",
    "{\"approved\":true,\"score\":95,\"reason\":\"x\",\"evidence_summary\":\"x\"} trailing",
    "[]",
    "null",
    "{\"approved\":true,\"approved\":false,\"score\":95,\"reason\":\"x\",\"evidence_summary\":\"x\"}",
    "{\"approved\":true,\"score\":95,\"reason\":\"x\",\"evidence_summary\":\"x\",\"unexpected\":1}",
    "{\"approved\":truth,\"score\":95,\"reason\":\"x\",\"evidence_summary\":\"x\"}",
    "{\"approved\":true,\"score\":95.5,\"reason\":\"x\",\"evidence_summary\":\"x\"}",
    "{\"approved\":true,\"score\":101,\"reason\":\"x\",\"evidence_summary\":\"x\"}",
    "{\"approved\":true,\"score\":95,\"reason\":\"\\ud800\",\"evidence_summary\":\"x\"}",
  ];
  for (const source of sources) {
    assert.throws(() => decodeBradburyEqBlocksOutputs(encodedEqOutput(source), APPROVAL_TRANSACTION_ID));
  }
  const valid = { approved: true, score: 95, reason: "bounded", evidence_summary: "bounded" };
  assert.throws(() => decodeBradburyEqBlocksOutputs("0xc786706164646564", APPROVAL_TRANSACTION_ID));
  assert.throws(() => decodeBradburyEqBlocksOutputs(encodedEqOutput(valid, { duplicate: true }), APPROVAL_TRANSACTION_ID));
  assert.throws(() => decodeBradburyEqBlocksOutputs(encodedEqOutput(valid, { extraItems: ["0x01"] }), APPROVAL_TRANSACTION_ID));
  assert.throws(() => decodeBradburyEqBlocksOutputs(toRlp(["0x00", encodedEqOutput(valid)]), APPROVAL_TRANSACTION_ID));
});

test("historical approval and rejection byte mutations assert exact structural offsets and truncation boundaries", () => {
  for (const transactionId of [APPROVAL_TRANSACTION_ID, REJECTION_TRANSACTION_ID]) {
    const bytes = Buffer.from(historicalTransaction(transactionId).transactionData.eqBlocksOutputs.slice(2), "hex");
    assert.equal(bytes[0], 0xf9, "outer list uses a two-byte long-list length");
    assert.equal(bytes[3], 0xb9, "result item uses a two-byte long-string length");
    assert.equal(bytes[6], 0x00, "selected result starts with the successful GenVM return tag");
    assert.equal(bytes.at(-7), 0x86, "the padded marker is a canonical six-byte RLP string");
    assert.equal(bytes.at(-6), 0x70, "the final six payload bytes spell padded");
    assert.equal(bytes.subarray(bytes.length - 6).toString("ascii"), "padded");
    for (const boundary of [0, 1, 2, 3, 4, 5, 6, 7, 8, bytes.length - 7, bytes.length - 1]) {
      assert.throws(() => decodeBradburyEqBlocksOutputs(`0x${bytes.subarray(0, boundary).toString("hex")}`, transactionId),
        `${transactionId}: truncation boundary ${boundary}`);
    }
    for (const [offset, expected, replacement, meaning] of [
      [0, 0xf9, 0xf8, "outer long-list prefix"],
      [3, 0xb9, 0xc0, "nested list substituted for result string"],
      [6, 0x00, 0x01, "wrong GenVM return tag"],
      [bytes.length - 6, 0x70, 0x71, "wrong padded marker"],
    ]) {
      assert.equal(bytes[offset], expected, `${meaning} source byte`);
      const changed = Buffer.from(bytes);
      changed[offset] = replacement;
      assert.throws(() => decodeBradburyEqBlocksOutputs(`0x${changed.toString("hex")}`, transactionId), meaning);
    }
  }
});

test("validator prose and resolved timestamps never enter projected evidence or safe errors", () => {
  const secret = "DISTINCTIVE_VALIDATOR_PROSE_SECRET";
  const rawJob = { ...matchingJob("2"), ai_reasoning: secret, resolved_at: secret };
  const projectedJob = projectJobEvidence(rawJob, config);
  assert.equal(JSON.stringify(projectedJob).includes(secret), false);
  assert.equal(projectedJob.ai_reasoning.present, true);
  const malformed = encodedEqOutput(`{${secret}`);
  let error;
  try {
    decodeBradburyEqBlocksOutputs(malformed, VERIFY_HASH);
    assert.fail("malformed evaluator output must fail");
  } catch (caught) {
    error = caught;
  }
  assert.equal(error.message.includes(secret), false);
  assert.equal(safeProcessError(error).includes(secret), false);
});

function newTransactionLog(txId = VERIFY_HASH, overrides = {}) {
  return {
    address: CONSENSUS_ADDRESS,
    data: "0x",
    topics: [NEW_TRANSACTION_TOPIC, txId, padHex(EXPECTED_CONTRACT_ADDRESS, { size: 32 }), padHex(TEST_SIGNER, { size: 32 })],
    transactionHash: EXPECTED_LOCAL_EVM_HASH,
    blockHash: OTHER_HASH,
    blockNumber: "0x1",
    logIndex: "0x0",
    removed: false,
    transactionIndex: "0x0",
    ...overrides,
  };
}

function createdTransactionLog(txId = VERIFY_HASH, overrides = {}) {
  return {
    address: CONSENSUS_ADDRESS,
    data: toHex(1n, { size: 32 }),
    topics: [CREATED_TRANSACTION_TOPIC, txId],
    transactionHash: EXPECTED_LOCAL_EVM_HASH,
    blockHash: OTHER_HASH,
    blockNumber: "0x1",
    logIndex: "0x0",
    removed: false,
    transactionIndex: "0x0",
    ...overrides,
  };
}

function successfulEvmReceipt(logs = [newTransactionLog()], overrides = {}) {
  return {
    blockHash: OTHER_HASH,
    blockNumber: "0x1",
    contractAddress: null,
    cumulativeGasUsed: "0x30d40",
    effectiveGasPrice: "0x3b9aca00",
    from: TEST_SIGNER,
    gasUsed: "0x30d40",
    logs,
    logsBloom: `0x${"00".repeat(256)}`,
    status: "0x1",
    to: CONSENSUS_ADDRESS,
    transactionHash: EXPECTED_LOCAL_EVM_HASH,
    transactionIndex: "0x0",
    type: "0x0",
    ...overrides,
  };
}

function protocolWriter({ account = privateKeyToAccount(TEST_PRIVATE_KEY), receipt = successfulEvmReceipt(),
  sendHash = EXPECTED_LOCAL_EVM_HASH, onMethod = () => {} } = {}) {
  let sends = 0;
  const client = createBradburyRpcClient({ account, now: () => Date.parse(NOW), receiptAttempts: 1, intervalMs: 0,
    fetchFn: async (_url, request) => {
      const payload = JSON.parse(request.body);
      onMethod(payload);
      if (payload.method === "eth_getTransactionCount") return rpcResult(payload.id, "0x1");
      if (payload.method === "eth_estimateGas") return rpcResult(payload.id, "0x30d40");
      if (payload.method === "eth_gasPrice") return rpcResult(payload.id, "0x3b9aca00");
      if (payload.method === "eth_sendRawTransaction") { sends += 1; return rpcResult(payload.id, sendHash); }
      if (payload.method === "eth_getTransactionReceipt") return rpcResult(payload.id, receipt);
      assert.fail(`unexpected method ${payload.method}`);
    } });
  return { client, sends: () => sends };
}

const OBSERVED_VALIDATOR_ACTIVATOR = "0x59dc5e6fd7428c5ee6fc24ae2b99e5860a9c9499";
const creationEventContext = { evmHash: EXPECTED_LOCAL_EVM_HASH, consensusAddress: CONSENSUS_ADDRESS,
  expectedRecipient: EXPECTED_CONTRACT_ADDRESS };

function pinnedRoundData() {
  return { round: 1n, leaderIndex: 0n, votesCommitted: 1n, votesRevealed: 1n, appealBond: 0n,
    rotationsLeft: 2n, result: 6, roundValidators: [EXPECTED_CLIENT_ADDRESS], validatorVotes: [1],
    validatorVotesHash: [VERIFY_HASH], validatorResultHash: [VERIFY_HASH] };
}

function pinnedTransactionFixtures(timestamp = PINNED_UNIX_TIMESTAMP) {
  const range = { activationBlock: 1n, processingBlock: 2n, proposalBlock: 3n };
  const round = pinnedRoundData();
  const transactionData = {
    currentTimestamp: BigInt(timestamp), sender: EXPECTED_CLIENT_ADDRESS, recipient: EXPECTED_CONTRACT_ADDRESS,
    initialRotations: 3n, txSlot: 4n, createdTimestamp: BigInt(timestamp - 100),
    lastVoteTimestamp: BigInt(timestamp - 50), randomSeed: VERIFY_HASH, result: 6,
    txExecutionHash: OTHER_HASH, txCalldata: PINNED_TRANSACTION_CALLDATA, eqBlocksOutputs: "0x", messages: [],
    queueType: 0, queuePosition: 0n, activator: "0x0000000000000000000000000000000000000000",
    lastLeader: EXPECTED_CLIENT_ADDRESS, status: 7, txId: VERIFY_HASH, readStateBlockRange: range,
    numOfRounds: 1n, lastRound: round, consumedValidators: [EXPECTED_CLIENT_ADDRESS],
  };
  const transactionAllData = {
    // These deliberately differ from transactionData: pinned 1.1.8 takes status/result
    // from getTransactionData and only txExecutionResult from getTransactionAllData.
    result: 7, txExecutionResult: 1, previousStatus: 4, status: 5, txOrigin: EXPECTED_CLIENT_ADDRESS,
    sender: EXPECTED_CLIENT_ADDRESS, recipient: EXPECTED_CONTRACT_ADDRESS,
    activator: "0x0000000000000000000000000000000000000000", txSlot: 4n, initialRotations: 3n,
    numOfInitialValidators: 5n, epoch: 1n, id: VERIFY_HASH, randomSeed: VERIFY_HASH,
    txExecutionHash: OTHER_HASH, resultHash: OTHER_HASH, txCalldata: PINNED_TRANSACTION_CALLDATA,
    eqBlocksOutputs: "0x", readStateBlockRanges: [range], validUntil: BigInt(timestamp + 3_600), value: 0n,
    lockedStorageUnitPrice: 0n, storageFeeUsed: 0n,
  };
  return { transactionData, transactionAllData, roundsData: [round] };
}

function encodedPinnedTransactionResults(timestamp = PINNED_UNIX_TIMESTAMP) {
  const fixtures = pinnedTransactionFixtures(timestamp);
  const contract = testnetBradbury.consensusDataContract;
  return { ...fixtures,
    currentResult: encodeFunctionResult({ abi: contract.abi, functionName: "getTransactionData",
      result: fixtures.transactionData }),
    allResult: encodeFunctionResult({ abi: contract.abi, functionName: "getTransactionAllData",
      result: [fixtures.transactionAllData, fixtures.roundsData] }),
  };
}

function journal(overrides = {}) {
  return { schema_version: JOURNAL_SCHEMA_VERSION, status: "ACTIVE", config, created_at: CREATED_AT, steps: {}, state: {}, ...overrides };
}

const success = { hash: VERIFY_HASH, status: 5, statusName: "ACCEPTED", resultName: "AGREE",
  txExecutionResultName: "FINISHED_WITH_RETURN" };

function liveEnvironment(overrides = {}) {
  return {
    SMOKE_LIVE_BRADBURY: LIVE_OPT_IN,
    SMOKE_BRADBURY_CHAIN_ID: String(EXPECTED_CHAIN_ID),
    SMOKE_BRADBURY_CONTRACT_ADDRESS: EXPECTED_CONTRACT_ADDRESS,
    SMOKE_BRADBURY_CLIENT_ADDRESS: EXPECTED_CLIENT_ADDRESS,
    SMOKE_BRADBURY_FREELANCER_ADDRESS: EXPECTED_FREELANCER_ADDRESS,
    SMOKE_BRADBURY_CLIENT_PRIVATE_KEY: "fake-client-private-key",
    SMOKE_BRADBURY_FREELANCER_PRIVATE_KEY: "fake-freelancer-private-key",
    SMOKE_APPROVAL_DELIVERABLE_URL: "https://example.test/approval",
    ...overrides,
  };
}

test("Bradbury implementation constants equal independent literal fixtures", () => {
  assert.equal(BRADBURY_CHAIN_ID, EXPECTED_CHAIN_ID);
  assert.equal(BRADBURY_CONTRACT_ADDRESS, EXPECTED_CONTRACT_ADDRESS);
  assert.equal(BRADBURY_CLIENT_ADDRESS, EXPECTED_CLIENT_ADDRESS);
  assert.equal(BRADBURY_FREELANCER_ADDRESS, EXPECTED_FREELANCER_ADDRESS);
  assert.equal(EXACT_ESCROW_WEI, EXPECTED_ESCROW_WEI);
});

test("live Bradbury runner requires the exact explicit opt-in", () => {
  assert.throws(() => assertLiveOptIn({}), /LIVE_SMOKE_OPT_IN_REQUIRED/);
  assert.throws(() => assertLiveOptIn({ SMOKE_LIVE_BRADBURY: "true" }), /LIVE_SMOKE_OPT_IN_REQUIRED/);
  assert.doesNotThrow(() => assertLiveOptIn({ SMOKE_LIVE_BRADBURY: LIVE_OPT_IN }));
});

test("runtime configuration defaults to and permits only exactly 1 GEN", () => {
  assert.equal(loadSmokeRuntimeConfig("approval", liveEnvironment()).escrowWei, EXPECTED_ESCROW_WEI);
  assert.equal(loadSmokeRuntimeConfig("approval", liveEnvironment({ SMOKE_ESCROW_WEI: String(EXPECTED_ESCROW_WEI) })).escrowWei, EXPECTED_ESCROW_WEI);
  for (const value of ["1", String(EXPECTED_ESCROW_WEI - 1n), String(EXPECTED_ESCROW_WEI + 1n)]) {
    assert.throws(() => loadSmokeRuntimeConfig("approval", liveEnvironment({ SMOKE_ESCROW_WEI: value })), /must be exactly 1000000000000000000/);
  }
});

test("wrong Bradbury contract, account, or chain configuration is refused", () => {
  for (const [override, error] of [
    [{ SMOKE_BRADBURY_CHAIN_ID: "1" }, /CHAIN_ID must be exactly 4221/],
    [{ SMOKE_BRADBURY_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001" }, /UNSUPPORTED_BRADBURY_CONTRACT/],
    [{ SMOKE_BRADBURY_CLIENT_ADDRESS: EXPECTED_FREELANCER_ADDRESS }, /UNSUPPORTED_BRADBURY_CLIENT/],
    [{ SMOKE_BRADBURY_FREELANCER_ADDRESS: EXPECTED_CLIENT_ADDRESS }, /UNSUPPORTED_BRADBURY_FREELANCER/],
  ]) assert.throws(() => loadSmokeRuntimeConfig("approval", liveEnvironment(override)), error);
});

test("configured private keys must derive to the explicit client and freelancer", () => {
  const runtime = loadSmokeRuntimeConfig("approval", liveEnvironment());
  const derive = (key) => ({ address: key.includes("client") ? EXPECTED_CLIENT_ADDRESS : EXPECTED_FREELANCER_ADDRESS });
  assert.doesNotThrow(() => verifyConfiguredAccounts(runtime, derive));
  assert.throws(() => verifyConfiguredAccounts(runtime, () => ({ address: "0x0000000000000000000000000000000000000001" })), /ACCOUNT_ADDRESS_MISMATCH/);
});

test("public journal metadata contains no private keys", () => {
  const runtime = loadSmokeRuntimeConfig("approval", liveEnvironment());
  const metadata = publicRuntimeMetadata(runtime);
  assert.equal(JSON.stringify(metadata).includes(runtime.clientPrivateKey), false);
  assert.equal(JSON.stringify(metadata).includes(runtime.freelancerPrivateKey), false);
  assert.equal(Object.keys(metadata).some((key) => key.toLowerCase().includes("private")), false);
});

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
  const value = journal({ steps: { fund: { status: "HASH_RECORDED", hash: KNOWN_HASH, request: publicRequestMetadata(request, "0xclient") } } });
  await submitStep({ journal: value, stepName: "fund", client: { writeContract: async () => { writes += 1; } }, request, sender: "0xclient", save: async () => {}, wait: async (hash) => { inspected = hash; } });
  assert.equal(writes, 0);
  assert.equal(inspected, KNOWN_HASH);
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
    status: "HASH_RECORDED", hash: MAJORITY_HASH, request: publicRequestMetadata(request, "0xclient"),
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
    assert.equal(hash, KNOWN_HASH);
    calls += 1;
    if (calls === 1) throw new Error("temporary network timeout");
    return { ...success, hash: KNOWN_HASH };
  } }, KNOWN_HASH, { attempts: 2, intervalMs: 0, sleep: async () => {}, traceFailures: false });
  assert.deepEqual(transaction, { ...success, hash: KNOWN_HASH });
  assert.equal(calls, 2);
});

function matchingJob(id = "2") {
  return { found: true, job_id: id, title: config.job_title, description: config.job_description,
    client: config.client_address, freelancer: config.freelancer_address, status: "OPEN", escrow_balance: "0",
    deliverable_url: "", ai_verdict: "", ai_reasoning: { present: false, byte_length: 0, sha256: null } };
}

function evaluatorEvidence(approved = true, transactionId = VERIFY_HASH) {
  const historicalId = approved ? APPROVAL_TRANSACTION_ID : REJECTION_TRANSACTION_ID;
  return decodeBradburyEqBlocksOutputs(historicalTransaction(historicalId).transactionData.eqBlocksOutputs, transactionId);
}

test("job selection is concurrency-safe and requires exactly one full match", () => {
  const unrelated = { ...matchingJob("3"), title: "someone else's job" };
  assert.equal(selectUniqueJob([unrelated, matchingJob("2")], config).job_id, "2");
  assert.equal(selectUniqueJob([unrelated], config), null);
  assert.throws(() => selectUniqueJob([matchingJob("2"), matchingJob("4")], config), /JOB_DISCOVERY_MULTIPLE_MATCHES/);
});

test("job IDs accept only canonical positive decimal strings and remain closed-projected", () => {
  const valid = ["1", "2", (2n ** 256n - 1n).toString()];
  const invalid = [1, 0, "0", "-1", "+1", "01", "1.0", "1e3", " 1", "1 ", "", null, {}];
  for (const jobId of valid) {
    assert.equal(isCanonicalPositiveJobId(jobId), true);
    const projected = projectJobEvidence(matchingJob(jobId), config);
    assert.equal(projected.job_id, jobId);
    assert.throws(() => projectJobEvidence({ ...matchingJob(jobId), unknown_rpc_field: "rejected" }, config), /JOB_EVIDENCE_INVALID/);
  }
  for (const jobId of invalid) {
    assert.equal(isCanonicalPositiveJobId(jobId), false);
    assert.throws(() => projectJobEvidence(matchingJob(jobId), config), /JOB_EVIDENCE_INVALID/);
    assert.throws(() => publicRequestMetadata({ address: config.contract_address, functionName: "fund_job",
      args: [jobId], value: EXPECTED_ESCROW_WEI }, config.client_address), /REQUEST_JOB_ID_INVALID/);
  }
});

test("loaded journal job ID and transaction arguments are bound to the same canonical value", () => {
  const value = retryJournal();
  assert.doesNotThrow(() => validateJournal(value, config));
  assert.deepEqual(value.steps.verify_and_release.request.args, [value.state.job_id]);
  for (const jobId of [1, "0", "01", "-1", "DISTINCTIVE_STORED_JOB_ID_SECRET"]) {
    const hostile = structuredClone(value);
    hostile.state.job_id = jobId;
    assert.throws(() => validateJournal(hostile, config), /JOURNAL_JOB_ID_INVALID/);
  }
  for (const functionName of ["fund_job", "submit_work", "verify_and_release"]) {
    const args = functionName === "submit_work" ? ["2", config.deliverable_url] : ["2"];
    assert.deepEqual(publicRequestMetadata({ address: config.contract_address, functionName, args, value: 0n },
      config.client_address).args[0], "2");
  }
});

test("hostile potentially matching job IDs fail before persistence, key loading, writer creation, or writes", () => {
  const secret = "DISTINCTIVE_HOSTILE_JOB_ID_SECRET";
  let saves = 0;
  let keyLoads = 0;
  let writerCreations = 0;
  let writes = 0;
  const discoverAndContinue = (candidates) => {
    const discovered = selectUniqueJob(candidates, config);
    saves += 1;
    keyLoads += 1;
    writerCreations += 1;
    writes += 1;
    return discovered;
  };
  for (const candidates of [[matchingJob(secret)], [matchingJob("2"), matchingJob(secret)]]) {
    let error;
    try {
      discoverAndContinue(candidates);
      assert.fail("hostile candidate must fail closed");
    } catch (caught) {
      error = caught;
    }
    assert.match(error.message, /JOB_EVIDENCE_INVALID/);
    assert.equal(error.message.includes(secret), false);
    assert.equal(safeProcessError(error).includes(secret), false);
  }
  assert.deepEqual({ saves, keyLoads, writerCreations, writes }, { saves: 0, keyLoads: 0, writerCreations: 0, writes: 0 });
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
      status: "EXECUTION_CONFIRMED", hash: VERIFY_HASH,
      request: { sender: config.client_address, address: config.contract_address, functionName: "verify_and_release", args: ["2"], value: "0" },
      execution: { status_name: "ACCEPTED", result_name: "AGREE", execution_result_name: "FINISHED_WITH_RETURN" },
    } },
    state: {
      job_id: "2",
      funded_job: { ...matchingJob("2"), status: "FUNDED", escrow_balance: String(EXPECTED_ESCROW_WEI) },
      before_verification_context: { run_id: config.run_id, job_id: "2", contract_address: config.contract_address,
        client_address: config.client_address, freelancer_address: config.freelancer_address,
        deliverable_url: config.deliverable_url, escrow_wei: String(EXPECTED_ESCROW_WEI) },
      before_verification_job: { ...matchingJob("2"), status: "SUBMITTED", escrow_balance: String(EXPECTED_ESCROW_WEI),
        deliverable_url: config.deliverable_url, ai_verdict: "" },
      before_verification_stats: { total_paid: "10" },
      before_verification_freelancer_profile: { found: true, address: config.freelancer_address, role: "freelancer",
        total_earned: "4", jobs_completed: "2" },
      before_verification_freelancer_balance: "100",
      before_verification_snapshot_started_at: NOW,
    },
  });
}

function accountingInput(flow = "approval") {
  const approval = flow === "approval";
  const evaluator = evaluatorEvidence(approval);
  return {
    journal: evidenceJournal(), config: { ...config, flow }, jobId: "2", escrowWei: EXPECTED_ESCROW_WEI,
    job: { ...matchingJob("2"), deliverable_url: config.deliverable_url,
      status: approval ? "PAID" : "DISPUTED", ai_verdict: approval ? "APPROVED" : "REJECTED",
      escrow_balance: approval ? "0" : String(EXPECTED_ESCROW_WEI),
      ai_reasoning: evaluator.reason },
    beforeStats: { total_paid: "999999" }, afterStats: { total_paid: approval ? String(EXPECTED_ESCROW_WEI + 10n) : "10" },
    beforeProfile: { total_earned: "999999", jobs_completed: "999999" },
    afterProfile: { found: true, address: config.freelancer_address, role: "freelancer",
      total_earned: approval ? String(EXPECTED_ESCROW_WEI + 4n) : "4", jobs_completed: approval ? "3" : "2" },
    beforeFreelancerBalance: "999999",
    afterFreelancerBalance: approval ? String(EXPECTED_ESCROW_WEI + 100n) : "100",
    evaluatorEvidence: evaluator,
    verificationFinalization: { hash: VERIFY_HASH, status: 7, statusName: "FINALIZED", resultName: "AGREE",
      txExecutionResultName: "FINISHED_WITH_RETURN", evaluatorEvidence: evaluator },
  };
}

function confirmedStep({ functionName, sender, args, value = "0", hash = VERIFY_HASH }) {
  return {
    status: "EXECUTION_CONFIRMED",
    hash,
    request: { sender, address: config.contract_address, functionName, args, value },
    created_at: CREATED_AT,
    hash_recorded_at: HASH_RECORDED_AT,
    execution: { status_name: "ACCEPTED", result_name: "AGREE", execution_result_name: "FINISHED_WITH_RETURN" },
    execution_confirmed_at: NOW,
  };
}

function completedJournal(flow = "approval") {
  const input = accountingInput(flow);
  const value = input.journal;
  value.config = { ...config, flow };
  value.status = "COMPLETED";
  value.completed_at = NOW;
  value.steps = {
    register_client: { status: "PRE_EXISTING", address: config.client_address, role: "client", recorded_at: CREATED_AT },
    register_freelancer: { status: "PRE_EXISTING", address: config.freelancer_address, role: "freelancer", recorded_at: CREATED_AT },
    create_job: confirmedStep({ functionName: "create_job", sender: config.client_address,
      args: [config.job_title, config.job_description, config.freelancer_address, "2099-12-31"], hash: OTHER_HASH }),
    fund_job: confirmedStep({ functionName: "fund_job", sender: config.client_address, args: ["2"],
      value: String(EXPECTED_ESCROW_WEI), hash: KNOWN_HASH }),
    submit_work: confirmedStep({ functionName: "submit_work", sender: config.freelancer_address,
      args: ["2", config.deliverable_url], hash: MAJORITY_HASH }),
    verify_and_release: confirmedStep({ functionName: "verify_and_release", sender: config.client_address,
      args: ["2"], hash: VERIFY_HASH }),
  };
  Object.assign(value.state, {
    verify_success_step: "verify_and_release",
    final_job: input.job,
    after_stats: input.afterStats,
    after_freelancer_profile: input.afterProfile,
    evaluator_evidence: input.evaluatorEvidence,
    verify_finalization: {
      transaction_hash: VERIFY_HASH,
      status_code: 7,
      status_name: "FINALIZED",
      result_name: "AGREE",
      execution_result_name: "FINISHED_WITH_RETURN",
      eq_blocks_outputs_sha256: input.evaluatorEvidence.eq_blocks_outputs_sha256,
      eq_blocks_outputs_byte_length: input.evaluatorEvidence.eq_blocks_outputs_byte_length,
      structural_selector: input.evaluatorEvidence.structural_selector,
      selected_output_index: input.evaluatorEvidence.selected_output_index,
      selected_output_identity: input.evaluatorEvidence.selected_output_identity,
    },
    after_finalization_freelancer_balance: String(input.afterFreelancerBalance),
  });
  Object.assign(value.state.evaluator_evidence, {
    sidecar_basename: `journal.json.evaluator-${input.evaluatorEvidence.eq_blocks_outputs_sha256}.bin`,
    sidecar_sha256: input.evaluatorEvidence.eq_blocks_outputs_sha256,
    sidecar_byte_length: input.evaluatorEvidence.eq_blocks_outputs_byte_length,
  });
  return value;
}

function completedRawHex(flow = "approval") {
  const historicalId = flow === "approval" ? APPROVAL_TRANSACTION_ID : REJECTION_TRANSACTION_ID;
  return historicalTransaction(historicalId).transactionData.eqBlocksOutputs.toLowerCase();
}

test("approval requires exact 1 GEN accounting and finalized balance delta", () => {
  const input = accountingInput("approval");
  assert.doesNotThrow(() => assertApprovalAccounting(input));
  assert.throws(() => assertApprovalAccounting({ ...input, afterStats: { total_paid: String(EXPECTED_ESCROW_WEI + 11n) } }), /TOTAL_PAID_DELTA_MISMATCH/);
  assert.throws(() => assertApprovalAccounting({ ...input, afterProfile: { ...input.afterProfile, jobs_completed: "4" } }), /JOBS_COMPLETED_DELTA_MISMATCH/);
  assert.throws(() => assertApprovalAccounting({ ...input, afterFreelancerBalance: String(EXPECTED_ESCROW_WEI + 99n) }), /FINALIZED_BALANCE_DELTA_MISMATCH/);
});

test("rejection requires unchanged accounting and zero finalized balance delta", () => {
  const input = accountingInput("rejection");
  assert.doesNotThrow(() => assertRejectionAccounting(input));
  assert.throws(() => assertRejectionAccounting({ ...input, afterStats: { total_paid: "11" } }), /TOTAL_PAID_DELTA_MISMATCH/);
  assert.throws(() => assertRejectionAccounting({ ...input, afterProfile: { ...input.afterProfile, total_earned: "5" } }), /TOTAL_EARNED_DELTA_MISMATCH/);
  assert.throws(() => assertRejectionAccounting({ ...input, afterFreelancerBalance: "101" }), /FINALIZED_BALANCE_DELTA_MISMATCH/);
});

test("ACCEPTED execution alone cannot satisfy the final EOA balance assertion", async () => {
  const input = accountingInput("approval");
  input.verificationFinalization = { hash: VERIFY_HASH, status: 5, ...success };
  assert.throws(() => assertApprovalAccounting(input), /NOT_FINALIZED_STATUS_7/);
  assert.throws(() => assertFinalizedExecution({ hash: VERIFY_HASH, ...success }, VERIFY_HASH), /NOT_FINALIZED_STATUS_7/);

  let calls = 0;
  const finalized = await waitForFinalizedExecution({ getTransaction: async () => {
    calls += 1;
    return calls === 1 ? { hash: VERIFY_HASH, status: 5, ...success } : {
      hash: VERIFY_HASH, status: 7, statusName: "FINALIZED", resultName: "AGREE", txExecutionResultName: "FINISHED_WITH_RETURN",
      evaluatorEvidence: evaluatorEvidence(true),
    };
  } }, VERIFY_HASH, { attempts: 2, intervalMs: 0, sleep: async () => {}, traceFailures: false });
  assert.equal(finalized.statusName, "FINALIZED");
  assert.equal(calls, 2);
});

function finalizedReceipt(identity = {}) {
  return { ...identity, status: 7, statusName: "FINALIZED", resultName: "AGREE",
    txExecutionResultName: "FINISHED_WITH_RETURN", evaluatorEvidence: evaluatorEvidence(true) };
}

test("finalized receipt identity accepts matching hash, txId, or both case-insensitively", () => {
  assert.doesNotThrow(() => assertFinalizedExecution(finalizedReceipt({ hash: VERIFY_HASH }), VERIFY_HASH.toUpperCase().replace("0X", "0x")));
  assert.doesNotThrow(() => assertFinalizedExecution(finalizedReceipt({ txId: VERIFY_HASH }), VERIFY_HASH));
  assert.doesNotThrow(() => assertFinalizedExecution(finalizedReceipt({ hash: VERIFY_HASH, txId: VERIFY_HASH }), VERIFY_HASH));
});

test("finalized receipt identity fails closed when missing, malformed, mismatched, or conflicting", () => {
  assert.throws(() => assertFinalizedExecution(finalizedReceipt(), VERIFY_HASH), /IDENTITY_MISSING/);
  assert.throws(() => assertFinalizedExecution(finalizedReceipt({ hash: OTHER_HASH }), VERIFY_HASH), /IDENTITY_MISMATCH/);
  assert.throws(() => assertFinalizedExecution(finalizedReceipt({ txId: OTHER_HASH }), VERIFY_HASH), /IDENTITY_MISMATCH/);
  assert.throws(() => assertFinalizedExecution(finalizedReceipt({ hash: VERIFY_HASH, txId: OTHER_HASH }), VERIFY_HASH), /IDENTITY_MISMATCH/);
  assert.throws(() => assertFinalizedExecution(finalizedReceipt({ hash: "not-a-hash" }), VERIFY_HASH), /IDENTITY_INVALID/);
});

test("an ACCEPTED receipt with the requested hash cannot satisfy finalization", () => {
  assert.throws(() => assertFinalizedExecution({ hash: VERIFY_HASH, status: 5, ...success }, VERIFY_HASH), /NOT_FINALIZED_STATUS_7/);
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
  approval.job.escrow_balance = String(EXPECTED_ESCROW_WEI);
  assert.throws(() => assertApprovalAccounting(approval), /APPROVAL_JOB_STATE_MISMATCH/);
  const rejection = accountingInput("rejection");
  rejection.job.escrow_balance = String(EXPECTED_ESCROW_WEI + 1n);
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

async function capturedFailure(operation) {
  try {
    await operation();
    assert.fail("operation must fail");
  } catch (error) {
    return error;
  }
}

function capturedThrow(operation) {
  try {
    operation();
    assert.fail("operation must throw");
  } catch (error) {
    return error;
  }
}

test("external key, writer, receipt, finalization, and trace errors are secret-safe everywhere", async () => {
  const secret = "DISTINCTIVE_FAKE_SECRET_DO_NOT_LEAK";
  const runtime = loadSmokeRuntimeConfig("approval", liveEnvironment({
    SMOKE_BRADBURY_CLIENT_PRIVATE_KEY: secret,
    SMOKE_BRADBURY_FREELANCER_PRIVATE_KEY: secret,
  }));
  const writeJournal = journal();
  const failures = [];
  failures.push(await capturedFailure(() => verifyConfiguredAccount(runtime, "client", () => {
    throw new Error(`bad ${secret}`);
  })));
  failures.push(await capturedFailure(() => submitStep({ journal: writeJournal, stepName: "fund", save: async () => {},
    client: { writeContract: async () => { throw new Error(`writer ${secret}`); } }, wait: async () => {},
    request: { address: config.contract_address, functionName: "fund_job", args: ["2"], value: 1n }, sender: config.client_address })));
  failures.push(await capturedFailure(() => waitForSuccessfulExecution({ getTransaction: async () => { throw new Error(`receipt ${secret}`); } },
    VERIFY_HASH, { attempts: 1, intervalMs: 0, sleep: async () => {}, traceFailures: false })));
  failures.push(await capturedFailure(() => waitForFinalizedExecution({ getTransaction: async () => { throw new Error(`finalization ${secret}`); } },
    VERIFY_HASH, { attempts: 1, intervalMs: 0, sleep: async () => {}, traceFailures: false })));
  failures.push(await capturedFailure(() => waitForSuccessfulExecution({
    getTransaction: async () => ({ hash: VERIFY_HASH, status: 13, statusName: "LEADER_TIMEOUT", resultName: "IDLE",
      txExecutionResultName: "NOT_VOTED" }),
    debugTraceTransaction: async () => { throw new Error(`trace ${secret}`); },
  }, VERIFY_HASH, { attempts: 1, intervalMs: 0, sleep: async () => {} })));

  const consoleOutput = [];
  const originalConsoleError = console.error;
  try {
    console.error = (...args) => consoleOutput.push(args.join(" "));
    for (const failure of failures) console.error(`Smoke flow stopped: ${safeProcessError(failure)}`);
  } finally {
    console.error = originalConsoleError;
  }
  const exposed = JSON.stringify({ messages: failures.map((error) => error.message), consoleOutput,
    journal: writeJournal, publicMetadata: publicRuntimeMetadata(runtime) });
  assert.equal(exposed.includes(secret), false);
  assert.equal(exposed.includes(EXTERNAL_ERROR_MARKER), true);
});

test("safeProcessError recognizes only exact privately registered error instances", () => {
  const secret = "DISTINCTIVE_FORGED_SAFE_ERROR_SECRET";
  const genuine = capturedFailure(() => Promise.reject(assertFinalizedExecution({}, VERIFY_HASH)));
  return genuine.then((safe) => {
    assert.match(safeProcessError(safe), /TRANSACTION_RESPONSE_INVALID/);
    const forgedOwn = new Error(secret);
    forgedOwn.isSafeSmokeError = true;
    const inherited = Object.create({ isSafeSmokeError: true, message: secret });
    const copied = Object.assign(new Error(secret), safe);
    const forgedSymbol = new Error(secret);
    forgedSymbol[Symbol("safeSmokeError")] = true;
    for (const value of [forgedOwn, inherited, copied, forgedSymbol, { isSafeSmokeError: true, message: secret },
      secret, new Error(`dependency ${secret}`)]) {
      const output = safeProcessError(value);
      assert.match(output, /^SMOKE_FLOW_FAILED operation=top_level detail=\[external error redacted\]$/);
      assert.equal(output.includes(secret), false);
    }
  });
});

test("closed profile, stats, and job projections reject distinctive extra fields", () => {
  const secret = "DISTINCTIVE_RPC_EXTRA_SECRET";
  const malformed = [
    { operation: () => projectFreelancerProfile({ found: true, address: config.freelancer_address, role: "freelancer",
      jobs_completed: "2", total_earned: "4", extra: secret }, config.freelancer_address) },
    { operation: () => projectAccountingStats({ total_paid: "10", arbitrary_rpc_field: secret }) },
    { operation: () => projectJobEvidence({ ...retryJob(), arbitrary_rpc_field: secret }, config) },
    { found: true, address: config.freelancer_address, role: "freelancer", jobs_completed: secret, total_earned: "4" },
    { found: true, address: config.freelancer_address, role: secret, jobs_completed: "2", total_earned: "4" },
  ];
  for (const value of malformed) {
    const error = capturedThrow(value.operation ?? (() => projectFreelancerProfile(value, config.freelancer_address)));
    assert.equal(error.message.includes(secret), false);
  }
});

test("loaded journal steps and retry summaries reject hostile stored fields without exposing them", () => {
  const secret = "DISTINCTIVE_HOSTILE_JOURNAL_SECRET";
  const base = retryJournal();
  assert.doesNotThrow(() => validateJournal(base, config));
  assert.equal(JSON.stringify(formatVerificationAttempts(base)).includes(secret), false);
  const mutations = [
    (value) => { value.status = secret; },
    (value) => { value.steps.verify_and_release.hash = secret; },
    (value) => { value.steps.verify_and_release.request.functionName = secret; },
    (value) => { value.steps.verify_and_release.execution = {
      status_name: secret, result_name: "IDLE", execution_result_name: "NOT_VOTED" }; },
  ];
  for (const mutate of mutations) {
    const hostile = structuredClone(base);
    mutate(hostile);
    const error = capturedThrow(() => validateJournal(hostile, config));
    assert.equal(error.message.includes(secret), false);
    assert.equal(safeProcessError(error).includes(secret), false);
    const summaryError = capturedThrow(() => formatVerificationAttempts(hostile));
    assert.equal(summaryError.message.includes(secret), false);
    assert.equal(safeProcessError(summaryError).includes(secret), false);
  }
});

test("awaited operations never mutate console descriptors or external replacements", async () => {
  const before = Object.fromEntries(["error", "warn", "log"].map((name) => [name, Object.getOwnPropertyDescriptor(console, name)]));
  const gate = deferred();
  const pending = waitForSuccessfulExecution({ getTransaction: () => gate.promise }, VERIFY_HASH,
    { attempts: 1, intervalMs: 0, sleep: async () => {}, traceFailures: false });
  await Promise.resolve();
  for (const name of Object.keys(before)) assert.deepEqual(Object.getOwnPropertyDescriptor(console, name), before[name]);

  const originalLog = Object.getOwnPropertyDescriptor(console, "log");
  const originalWarn = Object.getOwnPropertyDescriptor(console, "warn");
  const visible = [];
  const replacement = (...args) => visible.push(args.join(" "));
  const warningReplacement = (...args) => visible.push(`warn:${args.join(" ")}`);
  Object.defineProperty(console, "log", { configurable: true, enumerable: true, writable: true, value: replacement });
  console.warn = warningReplacement;
  const externalDescriptor = Object.getOwnPropertyDescriptor(console, "log");
  const warningDescriptor = Object.getOwnPropertyDescriptor(console, "warn");
  console.log("UNRELATED_OUTPUT_VISIBLE");
  console.warn("UNRELATED_WARNING_VISIBLE");
  assert.deepEqual(Object.getOwnPropertyDescriptor(console, "log"), externalDescriptor);
  assert.deepEqual(Object.getOwnPropertyDescriptor(console, "warn"), warningDescriptor);
  gate.resolve({ ...success });
  await pending;
  assert.deepEqual(Object.getOwnPropertyDescriptor(console, "log"), externalDescriptor);
  assert.deepEqual(Object.getOwnPropertyDescriptor(console, "warn"), warningDescriptor);
  assert.deepEqual(visible, ["UNRELATED_OUTPUT_VISIBLE", "warn:UNRELATED_WARNING_VISIBLE"]);
  Object.defineProperty(console, "log", originalLog);
  Object.defineProperty(console, "warn", originalWarn);
});

test("never-settling and detached dependency promises retain no runner suppression state", async () => {
  const before = Object.fromEntries(["error", "warn", "log"].map((name) => [name, Object.getOwnPropertyDescriptor(console, name)]));
  void waitForSuccessfulExecution({ getTransaction: () => new Promise(() => {}) }, VERIFY_HASH,
    { attempts: 1, intervalMs: 0, sleep: async () => {}, traceFailures: false });
  await Promise.resolve();
  for (const name of Object.keys(before)) assert.deepEqual(Object.getOwnPropertyDescriptor(console, name), before[name]);

  const detached = Promise.withResolvers();
  const original = console.log;
  const visible = [];
  console.log = (...args) => visible.push(args.join(" "));
  try {
    await waitForSuccessfulExecution({ getTransaction: async () => {
      setTimeout(() => { console.log("DETACHED_OUTPUT_VISIBLE"); detached.resolve(); }, 0);
      return success;
    } }, VERIFY_HASH, { attempts: 1, intervalMs: 0, sleep: async () => {}, traceFailures: false });
    await detached.promise;
    console.log("LATER_UNRELATED_OUTPUT_VISIBLE");
  } finally {
    console.log = original;
  }
  assert.deepEqual(visible, ["DETACHED_OUTPUT_VISIBLE", "LATER_UNRELATED_OUTPUT_VISIBLE"]);
});

test("synchronous constructors preserve console descriptors and sanitize failures and thenables", () => {
  const secret = "DISTINCTIVE_CONSTRUCTOR_SECRET";
  const before = Object.fromEntries(["error", "warn", "log"].map((name) => [name, Object.getOwnPropertyDescriptor(console, name)]));
  const read = createBradburyReadClient(() => ({ kind: "read" }));
  const writer = createBradburyWriterClient({ address: config.client_address }, ({ account }) => ({ account }));
  assert.deepEqual(read, { kind: "read" });
  assert.equal(writer.account.address, config.client_address);
  const constructorError = capturedThrow(() => createBradburyReadClient(() => { throw new Error(secret); }));
  assert.equal(constructorError.message.includes(secret), false);
  assert.throws(() => createBradburyReadClient(() => new Promise(() => {})), /MUST_BE_SYNCHRONOUS/);
  for (const name of Object.keys(before)) assert.deepEqual(Object.getOwnPropertyDescriptor(console, name), before[name]);
});

test("JSON-RPC envelopes are closed and all raw failures are fixed and secret-safe", async () => {
  const secret = "DISTINCTIVE_RPC_ENVELOPE_SECRET";
  const malformed = [
    { jsonrpc: "2.0", id: 1, result: "0x1", [secret]: true },
    { jsonrpc: "2.0", id: 2, result: "0x1" },
    { jsonrpc: "2.0", id: 1, result: "0x1", error: { code: -1, message: secret } },
    { jsonrpc: "2.0", id: 1 },
    { jsonrpc: "2.0", id: 1, error: { code: -1, message: secret, data: { value: secret }, extra: secret } },
    Object.assign(Object.create({ inherited: secret }), { jsonrpc: "2.0", id: 1, result: "0x1" }),
  ];
  for (const envelope of malformed) {
    const error = capturedThrow(() => validateJsonRpcResponse(envelope, 1, "eth_getBalance"));
    assert.equal(error.message.includes(secret), false);
  }

  const successful = createBradburyRpcClient({ fetchFn: async (_url, request) => {
    const { id } = JSON.parse(request.body);
    return { ok: true, text: async () => JSON.stringify({ jsonrpc: "2.0", id, result: "0x1" }) };
  } });
  assert.equal(await successful.getBalance({ address: config.freelancer_address }), 1n);
  await assert.rejects(successful.rpc("eth_getBalance", [config.freelancer_address, "pending"]), /REQUEST_INVALID/);

  const responses = [
    () => { throw new Error(secret); },
    async () => ({ ok: true, text: async () => `{"${secret}":` }),
    async (_url, request) => {
      const { id } = JSON.parse(request.body);
      return { ok: true, text: async () => JSON.stringify({ jsonrpc: "2.0", id,
        error: { code: -32000, message: secret, data: { trace: secret } } }) };
    },
  ];
  for (const fetchFn of responses) {
    const client = createBradburyRpcClient({ fetchFn });
    const error = await capturedFailure(() => client.rpc("eth_getBalance", [config.freelancer_address, "latest"]));
    assert.equal(error.message.includes(secret), false);
  }
});

test("supported gen_call forms accept the Bradbury full wrapper and decode only its validated data", async () => {
  const stats = { total_jobs: "2", total_paid: "10", total_freelancers: "1" };
  const encoded = encodedContractJson(stats);
  const full = syntheticBradburyGenCallResult(encoded);
  assert.equal(validateJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: full }, 1, "gen_call"), full);

  for (const direct of [encoded, `0x${encoded}`]) {
    assert.equal(validateJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: direct }, 1, "gen_call"), direct);
  }
  for (const data of [encoded, `0x${encoded}`]) {
    const minimal = { data, status: { code: 0, message: "success" } };
    assert.equal(validateJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: minimal }, 1, "gen_call"), minimal);
  }

  const client = createBradburyRpcClient({ projectionConfig: config, fetchFn: async (_url, request) => {
    const { id, method } = JSON.parse(request.body);
    assert.equal(method, "gen_call");
    return rpcResult(id, full);
  } });
  assert.deepEqual(await client.readContract({ address: config.contract_address, functionName: "get_stats", args: [] }),
    { total_jobs: "2", total_paid: "10" });
});

test("gen_call full wrapper and every nested collection fail closed with the fixed safe category", () => {
  const encoded = encodedContractJson({ total_jobs: "2", total_paid: "10", total_freelancers: "1" });
  const valid = syntheticBradburyGenCallResult(encoded);
  const cases = [
    (value) => { delete value.stdout; },
    (value) => { value.extra = true; },
    (value) => { value.data = "0x1"; },
    (value) => { value.status = { code: "0", message: "success" }; },
    (value) => { value.status = { code: 0, message: "success", extra: true }; },
    (value) => { value.syncedBlock = "0x01"; },
    (value) => { value.logs = [{}]; },
    (value) => { value.logs[2].metrics.gvm.host.extra = 1; },
    (value) => { value.events = ["unsupported"]; },
    (value) => { value.messages = [{ messageType: 0, recipient: EXPECTED_CONTRACT_ADDRESS, value: "0", data: "0x",
      onAcceptance: false, saltNonce: 0 }]; },
    (value) => { value.eqOutputs = ["AA=="]; },
    (value) => { value.nondetDisagreementCallNo = 0; },
  ];
  for (const mutate of cases) {
    const malformed = structuredClone(valid);
    mutate(malformed);
    assert.equal(capturedThrow(() => validateJsonRpcResponse(
      { jsonrpc: "2.0", id: 1, result: malformed }, 1, "gen_call")).message,
    "RPC_CONTRACT_VIEW_RESULT_INVALID");
  }
  for (const malformed of ["", "0x", "0x1", "xyz"]) {
    assert.equal(capturedThrow(() => validateJsonRpcResponse(
      { jsonrpc: "2.0", id: 1, result: malformed }, 1, "gen_call")).message,
    "RPC_CONTRACT_VIEW_RESULT_INVALID");
  }

  const unsupportedLogCombinations = [
    ["version", "genvm_id"],
    ["version", "metrics"],
    ["genvm_id", "metrics"],
    ["version", "genvm_id", "metrics"],
  ];
  for (const fields of unsupportedLogCombinations) {
    const malformed = structuredClone(valid);
    const sourceByField = {
      version: valid.logs[0].version,
      genvm_id: valid.logs[1].genvm_id,
      metrics: valid.logs[2].metrics,
    };
    malformed.logs[3] = { ...malformed.logs[3],
      ...Object.fromEntries(fields.map((field) => [field, structuredClone(sourceByField[field])])) };
    assert.equal(capturedThrow(() => validateJsonRpcResponse(
      { jsonrpc: "2.0", id: 1, result: malformed }, 1, "gen_call")).message,
    "RPC_CONTRACT_VIEW_RESULT_INVALID");
  }
});



test("gen_call full wrapper rejects non-JSON object tricks, sparse arrays, and oversized fields", () => {
  const encoded = encodedContractJson({ total_jobs: "2", total_paid: "10", total_freelancers: "1" });
  const validate = (result) => capturedThrow(() => validateJsonRpcResponse(
    { jsonrpc: "2.0", id: 1, result }, 1, "gen_call")).message;

  const hiddenExtra = syntheticBradburyGenCallResult(encoded);
  Object.defineProperty(hiddenExtra, "hidden", { value: true, enumerable: false });
  assert.equal(validate(hiddenExtra), "RPC_CONTRACT_VIEW_RESULT_INVALID");

  const sparse = syntheticBradburyGenCallResult(encoded);
  sparse.logs = new Array(1);
  assert.equal(validate(sparse), "RPC_CONTRACT_VIEW_RESULT_INVALID");

  const customArrayPrototype = syntheticBradburyGenCallResult(encoded);
  Object.setPrototypeOf(customArrayPrototype.logs, Object.create(Array.prototype));
  assert.equal(validate(customArrayPrototype), "RPC_CONTRACT_VIEW_RESULT_INVALID");

  let accessorEvaluations = 0;
  const accessor = syntheticBradburyGenCallResult(encoded);
  Object.defineProperty(accessor.status, "code", { enumerable: true, get() {
    accessorEvaluations += 1;
    return 0;
  } });
  assert.equal(validate(accessor), "RPC_CONTRACT_VIEW_RESULT_INVALID");
  assert.equal(accessorEvaluations, 0);

  const oversizedData = syntheticBradburyGenCallResult("00".repeat((1024 * 1024) + 1));
  assert.equal(validate(oversizedData), "RPC_CONTRACT_VIEW_RESULT_INVALID");

  const oversizedOutput = syntheticBradburyGenCallResult(encoded);
  oversizedOutput.stdout = "x".repeat((1024 * 1024) + 1);
  assert.equal(validate(oversizedOutput), "RPC_CONTRACT_VIEW_RESULT_INVALID");

  const oversizedLogs = syntheticBradburyGenCallResult(encoded);
  oversizedLogs.logs = Array.from({ length: 1025 }, () => structuredClone(oversizedLogs.logs[0]));
  assert.equal(validate(oversizedLogs), "RPC_CONTRACT_VIEW_RESULT_INVALID");

  const unsafeMetric = syntheticBradburyGenCallResult(encoded);
  unsafeMetric.logs[2].metrics.gvm.host.time = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(validate(unsafeMetric), "RPC_CONTRACT_VIEW_RESULT_INVALID");
});

test("invalid gen_call payloads never expose data, output, logs, messages, or auxiliary payloads", () => {
  const secret = "DISTINCTIVE_GEN_CALL_PAYLOAD_SECRET";
  const encodedSecret = Buffer.from(secret).toString("hex");
  const malformed = syntheticBradburyGenCallResult(encodedSecret);
  malformed.stdout = secret;
  malformed.stderr = secret;
  malformed.logs[0].message = secret;
  malformed.messages = [{ payload: secret }];
  malformed.eqOutputs = [Buffer.from(secret).toString("base64")];
  const error = capturedThrow(() => validateJsonRpcResponse(
    { jsonrpc: "2.0", id: 1, result: malformed }, 1, "gen_call"));
  assert.equal(error.message, "RPC_CONTRACT_VIEW_RESULT_INVALID");
  assert.equal(error.message.includes(secret), false);
  assert.equal(safeProcessError(error).includes(secret), false);
});

test("contract-view projections still reject malformed profile, stats, and job results", () => {
  const malformed = [
    ["get_profile", { found: false, address: "malformed" }, { args: [config.freelancer_address], config }],
    ["get_stats", { total_jobs: "-1", total_paid: "10", total_freelancers: "1" }, { args: [], config }],
    ["get_job", { found: false, job_id: "0" }, { args: ["2"], config }],
  ];
  for (const [method, value, options] of malformed) {
    assert.throws(() => projectContractViewResult(method, value, options), /(?:PROFILE|STATS|JOB)_RESPONSE_INVALID/);
  }
});

test("adapter decoding, trace, signing, and broadcast failures never expose injected secrets", async () => {
  const secret = "DISTINCTIVE_RPC_RLP_TRACE_SECRET";
  const encodedSecret = `0x${Buffer.from(secret).toString("hex")}`;
  const malformedDecoder = createBradburyRpcClient({ projectionConfig: config, fetchFn: async (_url, request) => {
    const { id } = JSON.parse(request.body);
    return { ok: true, text: async () => JSON.stringify({ jsonrpc: "2.0", id, result: encodedSecret }) };
  } });
  for (const operation of [
    () => malformedDecoder.getTransaction({ hash: VERIFY_HASH }),
    () => malformedDecoder.readContract({ address: config.contract_address, functionName: "get_stats", args: [] }),
  ]) {
    const error = await capturedFailure(operation);
    assert.equal(error.message.includes(secret), false);
  }

  const rpcValues = { eth_getTransactionCount: "0x1", eth_estimateGas: "0x5208", eth_gasPrice: "0x1" };
  const signingClient = createBradburyRpcClient({ account: { address: config.client_address,
    signTransaction: async () => { throw new Error(secret); } }, fetchFn: async (_url, request) => {
    const { id, method } = JSON.parse(request.body);
    return { ok: true, text: async () => JSON.stringify({ jsonrpc: "2.0", id, result: rpcValues[method] }) };
  } });
  const signingError = await capturedFailure(() => signingClient.writeContract({ address: config.contract_address,
    functionName: "verify_and_release", args: ["2"], value: 0n }));
  assert.match(signingError.message, /WRITE_TRANSACTION_SIGNING_FAILED/);
  assert.equal(signingError.message.includes(secret), false);

  const broadcastClient = createBradburyRpcClient({ account: { address: config.client_address,
    signTransaction: async () => "0x01" }, fetchFn: async (_url, request) => {
    const { id, method } = JSON.parse(request.body);
    if (method === "eth_sendRawTransaction") return { ok: true, text: async () => JSON.stringify({ jsonrpc: "2.0", id,
      error: { code: -32000, message: secret, data: { raw: secret } } }) };
    return { ok: true, text: async () => JSON.stringify({ jsonrpc: "2.0", id, result: rpcValues[method] }) };
  } });
  const broadcastError = await capturedFailure(() => broadcastClient.writeContract({ address: config.contract_address,
    functionName: "verify_and_release", args: ["2"], value: 0n }));
  assert.equal(broadcastError.message.includes(secret), false);
});

test("method results, transactions, and contract projections reject unknown secret-bearing fields", () => {
  const secret = "DISTINCTIVE_CLOSED_RESULT_SECRET";
  const transaction = { ...success, [secret]: secret };
  assert.equal(capturedThrow(() => projectTransactionState(transaction, VERIFY_HASH)).message.includes(secret), false);
  assert.equal(capturedThrow(() => validateJsonRpcResponse({ jsonrpc: "2.0", id: 1,
    result: { result_code: 1, [secret]: secret } }, 1, "gen_dbg_traceTransaction")).message.includes(secret), false);

  const fullProfile = {
    address: config.freelancer_address, role: "freelancer", name: "", bio: "", skills: "", rate: "0",
    rate_type: "fixed", portfolio: "", twitter: "", github: "", registered_at: NOW,
    jobs_completed: "2", total_earned: "4", found: true,
  };
  const fullJob = {
    ...matchingJob("2"), client_name: "", freelancer_name: "", freelancer_rate: "0",
    freelancer_rate_type: "fixed", deadline: "", created_at: NOW, funded_at: "", submitted_at: "",
  };
  const fullStats = { total_jobs: "2", total_paid: "10", total_freelancers: "1" };
  for (const [method, value, options] of [
    ["get_profile", { ...fullProfile, [secret]: secret }, { args: [config.freelancer_address], config }],
    ["get_job", { ...fullJob, [secret]: secret }, { args: ["2"], config }],
    ["get_stats", { ...fullStats, [secret]: secret }, { args: [], config }],
    ["get_profile", { ...fullProfile, role: secret }, { args: [config.freelancer_address], config }],
  ]) {
    const error = capturedThrow(() => projectContractViewResult(method, value, options));
    assert.equal(error.message.includes(secret), false);
  }
});

test("fixed pinned legacy fixture binds calldata, fees, chain, raw bytes, local hash, receipt, and NewTransaction", async () => {
  const captured = {};
  const fixture = protocolWriter({ onMethod: (payload) => {
    if (payload.method === "eth_estimateGas") captured.estimate = payload.params[0];
    if (payload.method === "eth_sendRawTransaction") captured.raw = payload.params[0];
  } });
  let guardCalls = 0;
  const txId = await fixture.client.writeContract({ address: EXPECTED_CONTRACT_ADDRESS,
    functionName: "verify_and_release", args: ["2"], value: 0n },
  { beforeRawBroadcast: () => { guardCalls += 1; } });
  assert.equal(txId, VERIFY_HASH);
  assert.equal(guardCalls, 1);
  assert.equal(captured.estimate.from, TEST_SIGNER);
  assert.equal(captured.estimate.to, CONSENSUS_ADDRESS);
  assert.equal(captured.estimate.data, EXPECTED_ADD_TRANSACTION_CALLDATA);
  assert.equal(captured.estimate.value, "0x0");
  assert.equal(captured.raw, EXPECTED_SIGNED_RAW_TRANSACTION);
  assert.equal(keccak256(captured.raw), EXPECTED_LOCAL_EVM_HASH);
  assert.equal(fixture.sends(), 1);
});

test("hard-coded raw fixture exactly matches pinned 1.1.8 _sendTransaction with captured transport", async () => {
  const OriginalDate = globalThis.Date;
  const originalFetch = globalThis.fetch;
  const calls = [];
  class FixedDate extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return OriginalDate.parse(NOW); }
  }
  try {
    globalThis.Date = FixedDate;
    globalThis.fetch = async (_url, request) => {
      const payload = JSON.parse(request.body);
      calls.push(payload);
      let result;
      if (payload.method === "eth_getTransactionCount") result = "0x1";
      else if (payload.method === "eth_estimateGas") result = "0x30d40";
      else if (payload.method === "eth_gasPrice") result = "0x3b9aca00";
      else if (payload.method === "eth_sendRawTransaction") result = EXPECTED_LOCAL_EVM_HASH;
      else if (payload.method === "eth_getTransactionReceipt") result = successfulEvmReceipt();
      else if (payload.method === "eth_blockNumber") result = "0x1";
      else assert.fail(`unexpected pinned SDK method ${payload.method}`);
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: payload.id, result }) };
    };
    const pinned = createPinnedSdkClient({ chain: testnetBradbury, account: privateKeyToAccount(TEST_PRIVATE_KEY) });
    const txId = await pinned.writeContract({ address: EXPECTED_CONTRACT_ADDRESS,
      functionName: "verify_and_release", args: ["2"], value: 0n });
    assert.equal(txId, VERIFY_HASH);
    const nonce = calls.find(({ method }) => method === "eth_getTransactionCount");
    const estimate = calls.find(({ method }) => method === "eth_estimateGas");
    const broadcast = calls.find(({ method }) => method === "eth_sendRawTransaction");
    assert.deepEqual(nonce.params, [TEST_SIGNER, "pending"]);
    assert.equal(estimate.params[0].from, TEST_SIGNER);
    assert.equal(estimate.params[0].to, CONSENSUS_ADDRESS);
    assert.equal(estimate.params[0].data, EXPECTED_ADD_TRANSACTION_CALLDATA);
    assert.equal(estimate.params[0].value, "0x0");
    assert.deepEqual(broadcast.params, [EXPECTED_SIGNED_RAW_TRANSACTION]);
    assert.equal(keccak256(broadcast.params[0]), EXPECTED_LOCAL_EVM_HASH);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = OriginalDate;
  }
});

test("exact pinned creation event fixtures decode indexed IDs and ignore only unknown topics", () => {
  const unknown = { ...newTransactionLog(), topics: [`0x${"12".repeat(32)}`], data: "0x1234" };
  assert.equal(extractUniqueGenLayerTransactionId([unknown, newTransactionLog()], creationEventContext), VERIFY_HASH);
  assert.equal(extractUniqueGenLayerTransactionId([createdTransactionLog()], creationEventContext), VERIFY_HASH);
});

test("writer accepts a valid NewTransaction activator distinct from the EVM signer", async () => {
  const receipt = successfulEvmReceipt([newTransactionLog(VERIFY_HASH, {
    topics: [
      NEW_TRANSACTION_TOPIC,
      VERIFY_HASH,
      padHex(EXPECTED_CONTRACT_ADDRESS, { size: 32 }),
      padHex(OBSERVED_VALIDATOR_ACTIVATOR, { size: 32 }),
    ],
  })]);
  const fixture = protocolWriter({ receipt });
  const txId = await fixture.client.writeContract({
    address: EXPECTED_CONTRACT_ADDRESS,
    functionName: "verify_and_release",
    args: ["2"],
    value: 0n,
  });
  assert.equal(txId, VERIFY_HASH);
  assert.equal(fixture.sends(), 1);
});

test("NewTransaction rejects malformed activator encoding", () => {
  const malformedActivator = newTransactionLog(VERIFY_HASH, {
    topics: [
      NEW_TRANSACTION_TOPIC,
      VERIFY_HASH,
      padHex(EXPECTED_CONTRACT_ADDRESS, { size: 32 }),
      "0x1234",
    ],
  });
  assert.throws(
    () => extractUniqueGenLayerTransactionId([malformedActivator], creationEventContext),
    /EVENT_DECODING/,
  );
});

test("raw hash, receipt identity, emitter, event cardinality, event encoding, and status fail closed", async () => {
  const cases = [
    ["rpc-hash", { sendHash: OTHER_HASH }, /HASH_MISMATCH/],
    ["receipt-hash", { receipt: successfulEvmReceipt(undefined, { transactionHash: OTHER_HASH }) }, /RECEIPT_INVALID/],
    ["receipt-from", { receipt: successfulEvmReceipt(undefined, { from: EXPECTED_CLIENT_ADDRESS }) }, /RECEIPT_INVALID/],
    ["receipt-to", { receipt: successfulEvmReceipt(undefined, { to: EXPECTED_CONTRACT_ADDRESS }) }, /RECEIPT_INVALID/],
    ["wrong-emitter", { receipt: successfulEvmReceipt([newTransactionLog(VERIFY_HASH, { address: EXPECTED_CONTRACT_ADDRESS })]) }, /EVENT_BINDING/],
    ["wrong-event-recipient", { receipt: successfulEvmReceipt([newTransactionLog(VERIFY_HASH,
      { topics: [NEW_TRANSACTION_TOPIC, VERIFY_HASH, padHex(EXPECTED_FREELANCER_ADDRESS, { size: 32 }),
        padHex(TEST_SIGNER, { size: 32 })] })]) }, /EVENT_DECODING/],
    ["missing-event", { receipt: successfulEvmReceipt([{ ...newTransactionLog(), topics: [`0x${"12".repeat(32)}`] }]) }, /EVENT_COUNT/],
    ["duplicate-event", { receipt: successfulEvmReceipt([newTransactionLog(), newTransactionLog()]) }, /EVENT_COUNT/],
    ["conflicting-event", { receipt: successfulEvmReceipt([newTransactionLog(), createdTransactionLog(OTHER_HASH)]) }, /EVENT_COUNT/],
    ["malformed-topics", { receipt: successfulEvmReceipt([newTransactionLog(VERIFY_HASH, { topics: [NEW_TRANSACTION_TOPIC, VERIFY_HASH] })]) }, /EVENT_DECODING/],
    ["malformed-data", { receipt: successfulEvmReceipt([createdTransactionLog(VERIFY_HASH, { data: "0x01" })]) }, /EVENT_DECODING/],
    ["failed-receipt", { receipt: successfulEvmReceipt(undefined, { status: "0x0" }) }, /RECEIPT_INVALID/],
  ];
  for (const [name, options, expected] of cases) {
    const fixture = protocolWriter(options);
    await assert.rejects(fixture.client.writeContract({ address: EXPECTED_CONTRACT_ADDRESS,
      functionName: "verify_and_release", args: ["2"], value: 0n }), expected, name);
  }
});

test("signed transaction bytes and all permitted receipt and log fields use closed canonical schemas", async () => {
  for (const signed of ["0x", "0x1", "0xzz", "0x01"]) {
    const fixture = protocolWriter({ account: { address: TEST_SIGNER, signTransaction: async () => signed } });
    await assert.rejects(fixture.client.writeContract({ address: EXPECTED_CONTRACT_ADDRESS,
      functionName: "verify_and_release", args: ["2"], value: 0n }), /SIGNING_RESULT_INVALID/);
    assert.equal(fixture.sends(), 0);
  }
  for (const receipt of [
    successfulEvmReceipt(undefined, { blockNumber: "0x01" }),
    successfulEvmReceipt(undefined, { gasUsed: "1" }),
    successfulEvmReceipt(undefined, { logsBloom: "0x00" }),
    successfulEvmReceipt(undefined, { contractAddress: EXPECTED_CONTRACT_ADDRESS }),
    successfulEvmReceipt([{ ...newTransactionLog(), removed: "false" }]),
    successfulEvmReceipt([{ ...newTransactionLog(), removed: true }]),
    successfulEvmReceipt([{ ...newTransactionLog(), transactionHash: "0x1" }]),
  ]) {
    const fixture = protocolWriter({ receipt });
    await assert.rejects(fixture.client.writeContract({ address: EXPECTED_CONTRACT_ADDRESS,
      functionName: "verify_and_release", args: ["2"], value: 0n }), /RECEIPT_RESULT_INVALID/);
  }
});

test("HTTP errors and accessor-bearing or custom-prototype envelopes fail without exposing or evaluating fields", async () => {
  const client = createBradburyRpcClient({ fetchFn: async () => ({ ok: false, status: 503,
    statusText: "DISTINCTIVE_HTTP_SECRET", text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }) }) });
  const error = await capturedFailure(() => client.getBalance({ address: EXPECTED_FREELANCER_ADDRESS }));
  assert.match(error.message, /HTTP_FAILED/);
  assert.equal(error.message.includes("DISTINCTIVE_HTTP_SECRET"), false);
  let evaluations = 0;
  const accessor = { jsonrpc: "2.0", id: 1 };
  Object.defineProperty(accessor, "result", { enumerable: true, get() { evaluations += 1; return "0x1"; } });
  assert.throws(() => validateJsonRpcResponse(accessor, 1, "eth_getBalance"), /ENVELOPE_INVALID/);
  assert.equal(evaluations, 0);
  assert.throws(() => validateJsonRpcResponse(Object.assign(Object.create({}),
    { jsonrpc: "2.0", id: 1, result: "0x1" }), 1, "eth_getBalance"), /ENVELOPE_INVALID/);
});

test("runner reproduces pinned 1.1.8 dual-source polling, timestamp units, and asymmetric merge", async () => {
  assert.equal(genlayerAbi.transactions.serialize([
    genlayerAbi.calldata.encode(genlayerAbi.calldata.makeCalldataObject("verify_and_release", ["2"])), false,
  ]), PINNED_TRANSACTION_CALLDATA);
  const fixture = encodedPinnedTransactionResults();
  const runnerCalls = [];
  const runner = createBradburyRpcClient({ now: () => Date.parse(NOW), fetchFn: async (_url, request) => {
    const payload = JSON.parse(request.body);
    assert.equal(payload.method, "eth_call");
    assert.equal(payload.params[1], "latest");
    const decoded = decodeFunctionData({ abi: testnetBradbury.consensusDataContract.abi,
      data: payload.params[0].data });
    runnerCalls.push(decoded);
    if (decoded.functionName === "getTransactionData") {
      assert.deepEqual(decoded.args, [VERIFY_HASH, BigInt(PINNED_UNIX_TIMESTAMP)]);
      return rpcResult(payload.id, fixture.currentResult);
    }
    assert.equal(decoded.functionName, "getTransactionAllData");
    assert.deepEqual(decoded.args, [VERIFY_HASH]);
    return rpcResult(payload.id, fixture.allResult);
  } });
  const expectedRequest = { sender: EXPECTED_CLIENT_ADDRESS, address: EXPECTED_CONTRACT_ADDRESS,
    functionName: "verify_and_release", args: ["2"], value: 0n };
  const runnerTransaction = await runner.getTransaction({ hash: VERIFY_HASH, expectedRequest });
  assert.deepEqual(runnerCalls.map(({ functionName }) => functionName).sort(),
    ["getTransactionAllData", "getTransactionData"]);
  assert.deepEqual(runnerTransaction, {
    hash: VERIFY_HASH, txId: VERIFY_HASH, sender: EXPECTED_CLIENT_ADDRESS, recipient: EXPECTED_CONTRACT_ADDRESS,
    functionName: "verify_and_release", args: ["2"], txCalldata: PINNED_TRANSACTION_CALLDATA,
    currentTimestamp: String(PINNED_UNIX_TIMESTAMP), status: 7, statusName: "FINALIZED",
    resultName: "MAJORITY_AGREE", txExecutionResultName: "FINISHED_WITH_RETURN",
  });

  const OriginalDate = globalThis.Date;
  const originalFetch = globalThis.fetch;
  const sdkCalls = [];
  class FixedDate extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return OriginalDate.parse(NOW); }
  }
  try {
    globalThis.Date = FixedDate;
    globalThis.fetch = async (_url, request) => {
      const payload = JSON.parse(request.body);
      assert.equal(payload.method, "eth_call");
      assert.equal(payload.params[1], "latest");
      const decoded = decodeFunctionData({ abi: testnetBradbury.consensusDataContract.abi,
        data: payload.params[0].data });
      sdkCalls.push(decoded);
      const result = decoded.functionName === "getTransactionData" ? fixture.currentResult : fixture.allResult;
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: payload.id, result }) };
    };
    const pinned = createPinnedSdkClient({ chain: testnetBradbury });
    const sdkTransaction = await pinned.getTransaction({ hash: VERIFY_HASH });
    assert.deepEqual(sdkCalls.map(({ functionName }) => functionName).sort(),
      ["getTransactionAllData", "getTransactionData"]);
    assert.deepEqual(sdkCalls.find(({ functionName }) => functionName === "getTransactionData").args,
      [VERIFY_HASH, BigInt(PINNED_UNIX_TIMESTAMP)]);
    assert.equal(sdkTransaction.status, runnerTransaction.status);
    assert.equal(sdkTransaction.statusName, runnerTransaction.statusName);
    assert.equal(sdkTransaction.resultName, runnerTransaction.resultName);
    assert.equal(sdkTransaction.txExecutionResultName, runnerTransaction.txExecutionResultName);
    assert.equal(sdkTransaction.sender, runnerTransaction.sender);
    assert.equal(sdkTransaction.recipient, runnerTransaction.recipient);
    assert.equal(sdkTransaction.txDataDecoded.callData.get("method"), runnerTransaction.functionName);
    assert.deepEqual(sdkTransaction.txDataDecoded.callData.get("args"), runnerTransaction.args);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = OriginalDate;
  }
});

test("pinned transaction responses bind independent IDs, identities, calldata, and complete closed structs", () => {
  const fixture = pinnedTransactionFixtures();
  const expectedRequest = { sender: EXPECTED_CLIENT_ADDRESS, address: EXPECTED_CONTRACT_ADDRESS,
    functionName: "verify_and_release", args: ["2"], value: 0n };
  const project = (overrides = {}) => projectPinnedTransactionResponse({ ...fixture,
    requestedHash: VERIFY_HASH, requestedTimestamp: PINNED_UNIX_TIMESTAMP, expectedRequest, ...overrides });
  assert.equal(project().txId, VERIFY_HASH);
  for (const mutation of [
    { transactionData: { ...fixture.transactionData, txId: OTHER_HASH } },
    { transactionAllData: { ...fixture.transactionAllData, id: OTHER_HASH } },
    { transactionAllData: { ...fixture.transactionAllData, sender: EXPECTED_FREELANCER_ADDRESS } },
    { transactionAllData: { ...fixture.transactionAllData, recipient: EXPECTED_FREELANCER_ADDRESS } },
    { transactionAllData: { ...fixture.transactionAllData, txCalldata: "0x0102" } },
    { transactionData: { ...fixture.transactionData, unexpected: "secret" } },
    { transactionAllData: { ...fixture.transactionAllData, unexpected: "secret" } },
  ]) assert.throws(() => project(mutation), /TRANSACTION_/);

  let evaluations = 0;
  const accessor = { ...fixture.transactionData };
  Object.defineProperty(accessor, "sender", { enumerable: true, get() { evaluations += 1; return EXPECTED_CLIENT_ADDRESS; } });
  assert.throws(() => project({ transactionData: accessor }), /TRANSACTION_DATA_SCHEMA_INVALID/);
  assert.equal(evaluations, 0);
  assert.throws(() => project({ transactionData: Object.assign(Object.create({}), fixture.transactionData) }),
    /TRANSACTION_DATA_SCHEMA_INVALID/);
});

test("accounting reads immutable immediate pre-verification snapshots, never stale pre-job fields", () => {
  const input = accountingInput("approval");
  input.beforeStats = { total_paid: "0" };
  input.beforeProfile = { total_earned: "0", jobs_completed: "0" };
  input.beforeFreelancerBalance = "0";
  assert.doesNotThrow(() => assertApprovalAccounting(input));
  input.journal.state.before_verification_stats.total_paid = "9";
  assert.throws(() => assertApprovalAccounting(input), /TOTAL_PAID_DELTA_MISMATCH/);
});

test("unrelated additive accounting activity and freelancer profile identity changes fail", () => {
  const additive = accountingInput("approval");
  additive.afterStats.total_paid = String(BigInt(additive.afterStats.total_paid) + 1n);
  assert.throws(() => assertApprovalAccounting(additive), /TOTAL_PAID_DELTA_MISMATCH/);
  const changedIdentity = accountingInput("approval");
  changedIdentity.afterProfile.address = "0xother";
  assert.throws(() => assertApprovalAccounting(changedIdentity), /FINAL_PROFILE_IDENTITY_MISMATCH/);
});

test("evidence documents compensating concurrent activity as a residual attribution limitation", () => {
  const evidence = readFileSync(new URL("../docs/BRADBURY_SUPPORTED_RUNTIME_EVIDENCE_2026-07-20.md", import.meta.url), "utf8");
  assert.match(evidence, /cannot mathematically exclude perfectly compensating unrelated concurrent transfers/);
  assert.match(evidence, /not cryptographic attribution/);
  assert.match(evidence, /Snapshot freshness begins before the first awaited snapshot read/);
});

test("pre-verification snapshots are recorded together after the exact SUBMITTED current-run job", async () => {
  const value = journal({ state: { job_id: "2" } });
  const submitted = retryJob({ escrow_balance: String(EXPECTED_ESCROW_WEI) });
  let saves = 0;
  await recordPreVerificationSnapshots({ journal: value, job: submitted, escrowWei: EXPECTED_ESCROW_WEI,
    readStats: async () => ({ total_paid: "10" }),
    readProfile: async () => ({ found: true, address: config.freelancer_address, role: "freelancer", total_earned: "4",
      jobs_completed: "2" }),
    readBalance: async () => 100n, save: async () => { saves += 1; } });
  assert.equal(saves, 1);
  assert.doesNotThrow(() => assertPreVerificationSnapshots({ journal: value, escrowWei: EXPECTED_ESCROW_WEI }));
  assert.equal(value.state.before_verification_job.status, "SUBMITTED");
  assert.equal(value.state.before_verification_context.run_id, config.run_id);
});

test("snapshot collection freshness starts before the first read and is inclusive at ten minutes", async () => {
  const start = Date.parse(NOW);
  for (const [elapsed, shouldPass] of [
    [MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS - 1, true],
    [MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS, true],
    [MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS + 1, false],
  ]) {
    const value = journal({ state: { job_id: "2" } });
    const times = [start, start + elapsed];
    let saves = 0;
    const operation = recordPreVerificationSnapshots({ journal: value, job: retryJob(), escrowWei: EXPECTED_ESCROW_WEI,
      readStats: async () => ({ total_paid: "10" }),
      readProfile: async () => ({ found: true, address: config.freelancer_address, role: "freelancer",
        total_earned: "4", jobs_completed: "2" }),
      readBalance: async () => 100n, save: async () => { saves += 1; }, now: () => times.shift() });
    if (shouldPass) {
      await operation;
      assert.equal(value.state.before_verification_snapshot_started_at, NOW);
      assert.equal(saves, 1);
    } else {
      await assert.rejects(operation, /STALE_MANUAL_INVESTIGATION_REQUIRED/);
      assert.equal(saves, 0);
      assert.equal(Object.keys(value.state).some((key) => key.startsWith("before_verification_")), false);
    }
  }
});

test("a stalled first snapshot read cannot reset the freshness timestamp", async () => {
  const value = journal({ state: { job_id: "2" } });
  const start = Date.parse(NOW);
  let current = start;
  let saves = 0;
  const gate = deferred();
  const operation = recordPreVerificationSnapshots({ journal: value, job: retryJob(), escrowWei: EXPECTED_ESCROW_WEI,
    readStats: async () => { await gate.promise; return { total_paid: "10" }; },
    readProfile: async () => ({ found: true, address: config.freelancer_address, role: "freelancer",
      total_earned: "4", jobs_completed: "2" }),
    readBalance: async () => 100n, save: async () => { saves += 1; }, now: () => current });
  current = start + MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS + 1;
  gate.resolve();
  await assert.rejects(operation, /STALE_MANUAL_INVESTIGATION_REQUIRED/);
  assert.equal(saves, 0);
  assert.deepEqual(value.state, { job_id: "2" });
});

const terminalFailure = { hash: FAILED_HASH, status: 13, statusName: "LEADER_TIMEOUT", resultName: "IDLE",
  txExecutionResultName: "NOT_VOTED" };

function retryJob(overrides = {}) {
  return { ...matchingJob("2"), status: "SUBMITTED", escrow_balance: String(EXPECTED_ESCROW_WEI),
    deliverable_url: config.deliverable_url, ai_verdict: "", ...overrides };
}

function retryJournal(extraSteps = {}, state = {}) {
  return journal({ steps: { verify_and_release: {
    status: "HASH_RECORDED", hash: FAILED_HASH, request: {
      sender: config.client_address, address: config.contract_address,
      functionName: "verify_and_release", args: ["2"], value: "0",
    }, created_at: CREATED_AT, hash_recorded_at: HASH_RECORDED_AT,
  }, ...extraSteps }, state: {
    job_id: "2",
    before_verification_context: { run_id: config.run_id, job_id: "2", contract_address: config.contract_address,
      client_address: config.client_address, freelancer_address: config.freelancer_address,
      deliverable_url: config.deliverable_url, escrow_wei: String(EXPECTED_ESCROW_WEI) },
    before_verification_job: retryJob(),
    before_verification_stats: { total_paid: "10" },
    before_verification_freelancer_profile: { found: true, address: config.freelancer_address, role: "freelancer",
      total_earned: "4", jobs_completed: "2" },
    before_verification_freelancer_balance: "100",
    before_verification_snapshot_started_at: NOW,
    ...state,
  } });
}

test("validated persistence rejects every noncanonical stored job ID before calling storage", async () => {
  const secret = "DISTINCTIVE_PERSISTED_JOB_ID_SECRET";
  const invalid = [1, 0, "0", "-1", "+1", "01", "1.0", "1e3", " 1", "1 ", "\t1", "", null, {}, secret];
  for (const jobId of invalid) {
    const value = retryJournal();
    value.state.job_id = jobId;
    let storageCalls = 0;
    const error = await capturedFailure(() => persistValidatedJournal(value, async () => { storageCalls += 1; }));
    assert.match(error.message, /JOURNAL_JOB_ID_INVALID/);
    assert.equal(storageCalls, 0);
    assert.equal(error.message.includes(secret), false);
    assert.equal(safeProcessError(error).includes(secret), false);
  }
});

test("every major journal save stage revalidates a job ID mutated immediately before persistence", async () => {
  const stages = ["registration", "job-discovery", "funded-job", "snapshot", "verification-intent", "hash",
    "execution-confirmation", "final-evidence", "completed-journal"];
  for (const stage of stages) {
    const value = stage === "completed-journal" ? completedJournal() : retryJournal();
    const options = stage === "completed-journal"
      ? { rawEvaluatorHex: completedRawHex(), journalBasename: "journal.json" } : {};
    assert.doesNotThrow(() => validateJournalForPersistence(value, options));
    value.state.job_id = `INVALID_${stage}`;
    let storageCalls = 0;
    await assert.rejects(persistValidatedJournal(value, async () => { storageCalls += 1; }), /JOURNAL_JOB_ID_INVALID/);
    assert.equal(storageCalls, 0, stage);
  }
});

test("completed journal persistence requires bound workflow, finalization, and exact accounting evidence", async () => {
  assert.doesNotThrow(() => validateStoredCompletedJournal(completedJournal(), completedRawHex(), "journal.json"));
  assert.doesNotThrow(() => validateStoredCompletedJournal(completedJournal("rejection"), completedRawHex("rejection"), "journal.json"));
  const mutations = [
    (value) => { delete value.state.final_job; },
    (value) => { delete value.state.evaluator_evidence; },
    (value) => { value.state.evaluator_evidence = null; },
    (value) => { value.state.evaluator_evidence.transaction_id = OTHER_HASH; },
    (value) => { value.state.evaluator_evidence.eq_blocks_outputs_sha256 = "bad"; },
    (value) => { value.state.evaluator_evidence.eq_blocks_outputs_byte_length = 0; },
    (value) => { delete value.state.evaluator_evidence.approved; },
    (value) => { value.state.evaluator_evidence.score = 101; },
    (value) => { value.state.evaluator_evidence.reason = { present: true, byte_length: 1, sha256: "raw prose forbidden" }; },
    (value) => { value.state.verify_finalization.eq_blocks_outputs_byte_length += 1; },
    (value) => { value.state.evaluator_evidence.approved = false; },
    (value) => { value.state.funded_job.status = "OPEN"; },
    (value) => { value.state.final_job.status = "DISPUTED"; },
    (value) => { value.state.final_job.job_id = "3"; },
    (value) => { value.state.final_job.deliverable_url = "https://example.test/other"; },
    (value) => { value.state.verify_success_step = "verify_and_release_retry_1"; },
    (value) => { value.state.verify_finalization.transaction_hash = OTHER_HASH; },
    (value) => { value.state.verify_finalization.result_name = "MAJORITY_AGREE"; },
    (value) => { value.state.after_stats.total_paid = String(EXPECTED_ESCROW_WEI + 11n); },
    (value) => { value.state.after_freelancer_profile.jobs_completed = "4"; },
    (value) => { value.state.after_finalization_freelancer_balance = String(EXPECTED_ESCROW_WEI + 99n); },
    (value) => { delete value.steps.submit_work; },
  ];
  for (const mutate of mutations) {
    const value = completedJournal();
    mutate(value);
    let storageCalls = 0;
    await assert.rejects(persistValidatedJournal(value, async () => { storageCalls += 1; },
      { rawEvaluatorHex: completedRawHex(), journalBasename: "journal.json" }));
    assert.equal(storageCalls, 0);
  }
});

test("completed journals persist a private raw sidecar and re-decode every evaluator field", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-escrow-sidecar-"));
  const journalPath = join(directory, "journal.json");
  let lock;
  try {
    lock = await acquireJournalLock(journalPath, { pid: 6101, now: () => NOW });
    await persistJournalToDisk(journalPath, completedJournal(), lock);
    const storedBytes = readFileSync(journalPath);
    const stored = JSON.parse(storedBytes.toString("utf8"));
    const evaluator = stored.state.evaluator_evidence;
    const sidecarPath = join(directory, evaluator.sidecar_basename);
    const raw = readFileSync(sidecarPath);
    assert.equal(statSync(sidecarPath).isFile(), true);
    assert.equal(statSync(sidecarPath).mode & 0o777, 0o600);
    assert.equal(raw.toString("hex"), completedRawHex().slice(2));
    assert.equal(raw.length, evaluator.sidecar_byte_length);
    assert.equal(createHash("sha256").update(raw).digest("hex"), evaluator.sidecar_sha256);
    assert.equal(storedBytes.includes(Buffer.from("comprehensive, accurate technical explanation")), false);
    assert.doesNotThrow(() => validateStoredCompletedJournal(stored, `0x${raw.toString("hex")}`, "journal.json"));

    const mutations = [
      (value) => { value.state.evaluator_evidence.approved = false; },
      (value) => { value.state.evaluator_evidence.score = 96; },
      (value) => { value.state.evaluator_evidence.reason.sha256 = "0".repeat(64); },
      (value) => { value.state.evaluator_evidence.reason.byte_length += 1; },
      (value) => { value.state.evaluator_evidence.evidence_summary.sha256 = "0".repeat(64); },
      (value) => { value.state.evaluator_evidence.evidence_summary.byte_length += 1; },
      (value) => { value.state.evaluator_evidence.sidecar_sha256 = "0".repeat(64); },
      (value) => { value.state.evaluator_evidence.sidecar_byte_length += 1; },
      (value) => { value.state.evaluator_evidence.sidecar_basename = "journal.json.evaluator-forged.bin"; },
      (value) => { value.state.evaluator_evidence.transaction_id = OTHER_HASH; },
      (value) => { value.state.evaluator_evidence.structural_selector = "forged.selector"; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(stored);
      mutate(changed);
      assert.throws(() => validateStoredCompletedJournal(changed, `0x${raw.toString("hex")}`, "journal.json"));
    }
    const changedRaw = Buffer.from(raw);
    changedRaw[20] ^= 1;
    assert.throws(() => validateStoredCompletedJournal(stored, `0x${changedRaw.toString("hex")}`, "journal.json"));
    await lock.release();
    lock = undefined;
  } finally {
    if (lock?.active) await lock.abandon();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("completed sidecars fail closed when missing, linked, or not mode 0600", async () => {
  for (const mutation of ["missing", "symlink", "mode"]) {
    const directory = mkdtempSync(join(tmpdir(), `freelance-escrow-sidecar-${mutation}-`));
    const journalPath = join(directory, "journal.json");
    let lock;
    try {
      lock = await acquireJournalLock(journalPath, { pid: 6102, now: () => NOW });
      await persistJournalToDisk(journalPath, completedJournal(), lock);
      const stored = JSON.parse(readFileSync(journalPath, "utf8"));
      const sidecarPath = join(directory, stored.state.evaluator_evidence.sidecar_basename);
      if (mutation === "missing") rmSync(sidecarPath);
      if (mutation === "symlink") {
        const target = join(directory, "target.bin");
        renameSync(sidecarPath, target);
        symlinkSync(target, sidecarPath);
      }
      if (mutation === "mode") chmodSync(sidecarPath, 0o644);
      await assert.rejects(lock.readEvaluatorSidecar(stored.state.evaluator_evidence.sidecar_basename),
        /EVALUATOR_SIDECAR_READ_FAILED/);
    } finally {
      if (lock?.active) await lock.abandon();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("schema validation errors never interpolate hostile stored values", () => {
  const secret = "DISTINCTIVE_SCHEMA_VERSION_SECRET";
  const value = retryJournal();
  value.schema_version = secret;
  let error;
  try {
    validateJournalForPersistence(value);
    assert.fail("hostile schema version must fail");
  } catch (caught) {
    error = caught;
  }
  assert.match(error.message, /JOURNAL_SCHEMA_MISMATCH/);
  assert.equal(error.message.includes(secret), false);
  assert.equal(safeProcessError(error).includes(secret), false);

  const completed = completedJournal();
  const completedError = capturedThrow(() => validateJournal(completed, completed.config));
  assert.match(completedError.message, /JOURNAL_COMPLETED_MANUAL_ARCHIVE_REQUIRED/);
  assert.equal(completedError.message.includes(completed.config.run_id), false);

  const roleSecret = "DISTINCTIVE_PROFILE_ROLE_SECRET";
  const roleError = capturedThrow(() => assertRegistrationProfile({ found: true, address: config.freelancer_address,
    role: roleSecret, jobs_completed: "0", total_earned: "0" }, "freelancer", config.freelancer_address));
  assert.match(roleError.message, /REGISTRATION_ROLE_MISMATCH/);
  assert.equal(roleError.message.includes(roleSecret), false);
});

test("validation failure occurs before temporary or destination journal file creation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-escrow-journal-validation-"));
  const temporaryPath = join(directory, "journal.json.tmp");
  const destinationPath = join(directory, "journal.json");
  try {
    const value = retryJournal();
    value.state.job_id = "DISTINCTIVE_FILE_WRITE_SECRET";
    const error = await capturedFailure(() => persistValidatedJournal(value, async () => {
      writeFileSync(temporaryPath, "unexpected");
      writeFileSync(destinationPath, "unexpected");
    }));
    assert.match(error.message, /JOURNAL_JOB_ID_INVALID/);
    assert.equal(existsSync(temporaryPath), false);
    assert.equal(existsSync(destinationPath), false);
    assert.equal(safeProcessError(error).includes("DISTINCTIVE_FILE_WRITE_SECRET"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("exclusive journal locks fail closed before later side effects and release normally", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-escrow-lock-"));
  const journalPath = join(directory, "journal.json");
  const secret = "DISTINCTIVE_LOCK_SECRET";
  let journalReads = 0;
  let keyLoads = 0;
  let clientCreations = 0;
  let writes = 0;
  try {
    const first = await acquireJournalLock(journalPath, { pid: 1001, now: () => NOW });
    const heldError = await capturedFailure(async () => {
      const second = await acquireJournalLock(journalPath, { pid: 1002, now: () => NOW });
      journalReads += 1; keyLoads += 1; clientCreations += 1; writes += 1;
      await second.release();
    });
    assert.match(heldError.message, /JOURNAL_LOCK_HELD_MANUAL_INVESTIGATION_REQUIRED/);
    assert.equal(heldError.message.includes(secret), false);
    assert.deepEqual({ journalReads, keyLoads, clientCreations, writes }, { journalReads: 0, keyLoads: 0, clientCreations: 0, writes: 0 });
    await first.release();
    const later = await acquireJournalLock(journalPath, { pid: 1002, now: () => NOW });
    await later.release();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("journal lock acquisition order is symmetric and an awaited operation retains ownership", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-escrow-lock-order-"));
  const journalPath = join(directory, "journal.json");
  try {
    const secondStarter = await acquireJournalLock(journalPath, { pid: 2002, now: () => NOW });
    await assert.rejects(acquireJournalLock(journalPath, { pid: 2001, now: () => NOW }), /LOCK_HELD/);
    const gate = deferred();
    const held = (async () => { await gate.promise; return secondStarter.active; })();
    await assert.rejects(acquireJournalLock(journalPath, { pid: 2003, now: () => NOW }), /LOCK_HELD/);
    gate.resolve();
    assert.equal(await held, true);
    await secondStarter.release();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function spawnLockProcess(journalPath, { hold, label }) {
  const moduleUrl = new URL("../scripts/smoke-freelance-market.mjs", import.meta.url).href;
  const source = `import { acquireJournalLock } from ${JSON.stringify(moduleUrl)};
let journalReads = 0; let keyLoads = 0; let rpcCalls = 0; let writes = 0;
try {
  const lock = await acquireJournalLock(${JSON.stringify(journalPath)}, { pid: process.pid, now: () => ${JSON.stringify(NOW)} });
  process.stdout.write(${JSON.stringify(`ACQUIRED:${label}\n`)});
  ${hold ? "await new Promise((resolve) => process.stdin.once(\"data\", resolve));" : ""}
  await lock.release();
  process.stdout.write(${JSON.stringify(`RELEASED:${label}\n`)});
} catch (error) {
  process.stdout.write(${JSON.stringify(`BLOCKED:${label}:`)} + error.message +
    ":effects=" + [journalReads, keyLoads, rpcCalls, writes].join(",") + "\\n");
}`;
  return spawn(process.execPath, ["--input-type=module", "--eval", source], { stdio: ["pipe", "pipe", "pipe"] });
}

function waitForChildText(child, needle) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const onData = (chunk) => {
      output += chunk;
      if (output.includes(needle)) {
        cleanup();
        resolve(output);
      }
    };
    const onErrorData = (chunk) => { errors += chunk; };
    const onError = (error) => { cleanup(); reject(error); };
    const onExit = (code) => {
      if (!output.includes(needle)) {
        cleanup();
        reject(new Error(`lock child exited ${code}: ${errors}`));
      }
    };
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.stderr.off("data", onErrorData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onErrorData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForChildExit(child) {
  return waitForChildExitResult(child).then(({ code }) => code);
}

function waitForChildExitResult(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function exactDirectoryMetadata(directory) {
  return readdirSync(directory).sort().map((name) => {
    const metadata = statSync(join(directory, name), { bigint: true });
    return {
      name,
      device: metadata.dev,
      inode: metadata.ino,
      mode: metadata.mode,
      links: metadata.nlink,
      owner: metadata.uid,
      group: metadata.gid,
      size: metadata.size,
      modified_ns: metadata.mtimeNs,
      changed_ns: metadata.ctimeNs,
    };
  });
}

function completedJournalWithRawEvidence(flow) {
  const value = completedJournal(flow);
  const evidence = decodeBradburyEqBlocksOutputs(completedRawHex(flow), VERIFY_HASH);
  Object.assign(evidence, value.state.evaluator_evidence);
  value.state.evaluator_evidence = evidence;
  return value;
}

function spawnJournalParentHarness(journalPath, value, rawHex, stage) {
  const moduleUrl = new URL("../scripts/smoke-freelance-market.mjs", import.meta.url).href;
  const source = `import { acquireJournalLock, decodeBradburyEqBlocksOutputs, persistJournalToDisk } from ${JSON.stringify(moduleUrl)};
const value = ${JSON.stringify(value)};
const evidence = decodeBradburyEqBlocksOutputs(${JSON.stringify(rawHex)}, ${JSON.stringify(VERIFY_HASH)});
Object.assign(evidence, value.state.evaluator_evidence);
value.state.evaluator_evidence = evidence;
const lock = await acquireJournalLock(${JSON.stringify(journalPath)}, { pid: process.pid, now: () => ${JSON.stringify(NOW)} });
process.stdout.write("PARENT_LOCK_ACQUIRED\\n");
await persistJournalToDisk(${JSON.stringify(journalPath)}, value, lock, {
  [${JSON.stringify(stage)}]: async () => {
    process.stdout.write(${JSON.stringify(`CHECKPOINT:${stage}\n`)});
    await new Promise(() => {});
  },
});
process.stdout.write("PARENT_FINAL_SUCCESS\\n");`;
  return spawn(process.execPath, ["--input-type=module", "--eval", source], { stdio: ["ignore", "pipe", "pipe"] });
}

async function proveParentSigkillRecovery({ stage, durableState, outcome }) {
  const directory = mkdtempSync(join(tmpdir(), `freelance-escrow-parent-kill-${outcome}-`));
  const journalPath = join(directory, "journal.json");
  const lockPath = `${journalPath}.lock`;
  let setupLock;
  let recoveryLock;
  let parent;
  try {
    setupLock = await acquireJournalLock(journalPath, { pid: 6401, now: () => NOW });
    await persistJournalToDisk(journalPath, completedJournal(), setupLock);
    await setupLock.release();
    setupLock = undefined;
    const oldJournal = readFileSync(journalPath);
    const oldParsed = JSON.parse(oldJournal.toString("utf8"));
    const oldSidecarPath = join(directory, oldParsed.state.evaluator_evidence.sidecar_basename);
    const oldSidecar = readFileSync(oldSidecarPath);
    const newJournalValue = completedJournalWithRawEvidence("rejection");
    const newJournal = Buffer.from(`${JSON.stringify(newJournalValue, null, 2)}\n`, "utf8");
    const newSidecarPath = join(directory, newJournalValue.state.evaluator_evidence.sidecar_basename);
    const newSidecar = Buffer.from(completedRawHex("rejection").slice(2), "hex");

    parent = spawnJournalParentHarness(journalPath, newJournalValue, completedRawHex("rejection"), stage);
    const checkpointOutput = await waitForChildText(parent, `CHECKPOINT:${stage}`);
    assert.match(checkpointOutput, /PARENT_LOCK_ACQUIRED/);
    assert.equal(checkpointOutput.includes("PARENT_FINAL_SUCCESS"), false);
    const lockBeforeDeath = readFileSync(lockPath);
    const lockMetadata = JSON.parse(lockBeforeDeath.toString("utf8"));
    assert.equal(lockMetadata.pid, parent.pid);
    const transactionBeforeDeath = JSON.parse(readFileSync(`${journalPath}.transaction`, "utf8"));
    assert.equal(transactionBeforeDeath.state, durableState);

    assert.equal(parent.kill("SIGKILL"), true);
    const parentExit = await waitForChildExitResult(parent);
    assert.deepEqual(parentExit, { code: null, signal: "SIGKILL" });
    parent = undefined;
    assert.deepEqual(readFileSync(lockPath), lockBeforeDeath);
    assert.equal(JSON.parse(readFileSync(`${journalPath}.transaction`, "utf8")).state, durableState);

    // The test environment's authorized crash-left-lock procedure proves the owner died above, then removes only that lock.
    rmSync(lockPath);
    recoveryLock = await acquireJournalLock(journalPath, { pid: 6402, now: () => NOW });
    const expectedJournal = outcome === "rolled_back" ? oldJournal : newJournal;
    const expectedSidecarPath = outcome === "rolled_back" ? oldSidecarPath : newSidecarPath;
    const expectedSidecar = outcome === "rolled_back" ? oldSidecar : newSidecar;
    const rejectedSidecarPath = outcome === "rolled_back" ? newSidecarPath : oldSidecarPath;
    assert.deepEqual(readFileSync(journalPath), expectedJournal);
    assert.deepEqual(readFileSync(expectedSidecarPath), expectedSidecar);
    assert.equal(existsSync(rejectedSidecarPath), false);
    assert.deepEqual(readdirSync(directory).filter((name) =>
      name.includes(".rollback") || name.includes(".tmp") || name.endsWith(".transaction")), []);

    const filesAfterFirstRecovery = readdirSync(directory).sort();
    const firstRead = await recoveryLock.readJournal();
    const secondRead = await recoveryLock.readJournal();
    assert.equal(firstRead.contents, expectedJournal.toString("utf8"));
    assert.deepEqual(secondRead, firstRead);
    assert.deepEqual(readdirSync(directory).sort(), filesAfterFirstRecovery);
    assert.deepEqual(readFileSync(journalPath), expectedJournal);
    assert.deepEqual(readFileSync(expectedSidecarPath), expectedSidecar);
    assert.equal(existsSync(rejectedSidecarPath), false);
    await recoveryLock.release();
    recoveryLock = undefined;
  } finally {
    if (parent?.exitCode === null && parent?.signalCode === null) parent.kill("SIGKILL");
    if (setupLock?.active) await setupLock.abandon();
    if (recoveryLock?.active) await recoveryLock.abandon();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("two live child processes contend symmetrically and a released lock is reacquirable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-escrow-lock-live-"));
  const children = new Set();
  try {
    for (const [holderLabel, contenderLabel] of [["A", "B"], ["B", "A"]]) {
      const journalPath = join(directory, `journal-${holderLabel}.json`);
      const holder = spawnLockProcess(journalPath, { hold: true, label: holderLabel });
      children.add(holder);
      await waitForChildText(holder, `ACQUIRED:${holderLabel}`);
      const contender = spawnLockProcess(journalPath, { hold: false, label: contenderLabel });
      children.add(contender);
      const blocked = await waitForChildText(contender, `BLOCKED:${contenderLabel}`);
      assert.match(blocked, /JOURNAL_LOCK_HELD_MANUAL_INVESTIGATION_REQUIRED/);
      assert.match(blocked, /effects=0,0,0,0/);
      await waitForChildExit(contender);
      children.delete(contender);
      holder.stdin.end("release\n");
      await waitForChildText(holder, `RELEASED:${holderLabel}`);
      await waitForChildExit(holder);
      children.delete(holder);

      const later = spawnLockProcess(journalPath, { hold: false, label: "later" });
      children.add(later);
      const acquired = await waitForChildText(later, "RELEASED:later");
      assert.match(acquired, /ACQUIRED:later/);
      await waitForChildExit(later);
      children.delete(later);
    }
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("symlink lock paths and replaced journal parents fail closed without unlinking unowned files", async () => {
  const root = mkdtempSync(join(tmpdir(), "freelance-escrow-lock-path-"));
  const originalParent = join(root, "journal-parent");
  const movedParent = join(root, "journal-parent-moved");
  mkdirSync(originalParent);
  const journalPath = join(originalParent, "journal.json");
  const lockPath = `${journalPath}.lock`;
  const symlinkTarget = join(root, "target.txt");
  try {
    writeFileSync(symlinkTarget, "must remain\n", { mode: 0o600 });
    symlinkSync(symlinkTarget, lockPath);
    await assert.rejects(acquireJournalLock(journalPath, { pid: 5001, now: () => NOW }), /LOCK_HELD/);
    assert.equal(readFileSync(symlinkTarget, "utf8"), "must remain\n");
    rmSync(lockPath);

    const lock = await acquireJournalLock(journalPath, { pid: 5002, now: () => NOW });
    renameSync(originalParent, movedParent);
    mkdirSync(originalParent);
    await assert.rejects(lock.release(), /JOURNAL_LOCK_RELEASE_OWNERSHIP_INVALID/);
    assert.equal(existsSync(join(originalParent, "journal.json.lock")), false);
    assert.equal(existsSync(join(movedParent, "journal.json.lock")), true);
    await lock.abandon();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parent replacement at every persistence checkpoint commits nowhere and preserves the original journal", async () => {
  for (const stage of ["after_transaction_record", "after_backup_creation", "after_journal_rename",
    "after_prepared_notification"]) {
    const root = mkdtempSync(join(tmpdir(), `freelance-escrow-parent-race-${stage}-`));
    const visibleParent = join(root, "journal-parent");
    const movedParent = join(root, "journal-parent-moved");
    mkdirSync(visibleParent);
    const journalPath = join(visibleParent, "journal.json");
    const original = `${JSON.stringify(journal(), null, 2)}\n`;
    writeFileSync(journalPath, original, { mode: 0o600 });
    const lock = await acquireJournalLock(journalPath, { pid: 5100, now: () => NOW });
    try {
      await assert.rejects(persistJournalToDisk(journalPath, journal({ created_at: NOW }), lock, {
        [stage]: async () => {
          renameSync(visibleParent, movedParent);
          mkdirSync(visibleParent);
        },
      }), /JOURNAL_SAVE_FAILED/);
      assert.equal(existsSync(join(visibleParent, "journal.json")), false, stage);
      assert.equal(readFileSync(join(movedParent, "journal.json"), "utf8"), original, stage);
      assert.equal(existsSync(join(movedParent, "journal.json.lock")), true, stage);
      assert.equal(existsSync(join(visibleParent, "journal.json.lock")), false, stage);
    } finally {
      await lock.abandon();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("symlink parents and symlink journal destinations fail closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "freelance-escrow-journal-symlink-"));
  const realParent = join(root, "real");
  const linkedParent = join(root, "linked");
  mkdirSync(realParent);
  symlinkSync(realParent, linkedParent);
  await assert.rejects(acquireJournalLock(`${realParent}/..`, { pid: 5199, now: () => NOW }), /JOURNAL_BASENAME_INVALID/);
  await assert.rejects(acquireJournalLock(join(linkedParent, "journal.json"), { pid: 5200, now: () => NOW }),
    /JOURNAL_LOCK_PARENT_INVALID/);
  const target = join(root, "target.json");
  const journalPath = join(realParent, "journal.json");
  writeFileSync(target, "must remain\n", { mode: 0o600 });
  symlinkSync(target, journalPath);
  const lock = await acquireJournalLock(journalPath, { pid: 5201, now: () => NOW });
  try {
    await assert.rejects(persistJournalToDisk(journalPath, journal(), lock), /JOURNAL_SAVE_FAILED/);
    assert.equal(readFileSync(target, "utf8"), "must remain\n");
    await lock.release();
  } finally {
    if (lock.active) await lock.abandon();
    rmSync(root, { recursive: true, force: true });
  }
});

test("real helper SIGTERM, disconnect, malformed IPC, and timeout fail closed with the prior journal intact", async () => {
  for (const failure of ["SIGTERM", "disconnect", "malformed", "timeout"]) {
    const directory = mkdtempSync(join(tmpdir(), `freelance-escrow-helper-${failure}-`));
    const journalPath = join(directory, "journal.json");
    const original = `${JSON.stringify(journal(), null, 2)}\n`;
    writeFileSync(journalPath, original, { mode: 0o600 });
    const lock = await acquireJournalLock(journalPath, { pid: 5300, now: () => NOW, helperTimeoutMs: 100 });
    try {
      if (failure === "SIGTERM") {
        const exit = await lock.terminateIoHelper("SIGTERM");
        assert.deepEqual(exit, { code: null, signal: "SIGTERM" });
      }
      if (failure === "disconnect") lock.disconnectIoHelper();
      if (failure === "malformed") lock.sendMalformedIoMessage();
      const io = failure === "timeout" ? { after_transaction_record: () => new Promise(() => {}) } : undefined;
      await assert.rejects(persistJournalToDisk(journalPath, journal({ created_at: NOW }), lock, io), /JOURNAL_/);
      assert.equal(readFileSync(journalPath, "utf8"), original, failure);
    } finally {
      await lock.abandon();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("real helper SIGKILL at every pre-commit checkpoint rolls back the prior pair under the original lock", async () => {
  const stages = ["after_transaction_record", "after_backup_creation", "after_sidecar_rename",
    "after_journal_rename", "after_prepared_notification"];
  for (const [index, stage] of stages.entries()) {
    const directory = mkdtempSync(join(tmpdir(), `freelance-escrow-sidecar-kill-${stage}-`));
    const journalPath = join(directory, "journal.json");
    let lock;
    try {
      lock = await acquireJournalLock(journalPath, { pid: 6200 + index, now: () => NOW });
      await persistJournalToDisk(journalPath, completedJournal(), lock);
      const priorJournal = readFileSync(journalPath);
      const priorParsed = JSON.parse(priorJournal.toString("utf8"));
      const priorSidecarPath = join(directory, priorParsed.state.evaluator_evidence.sidecar_basename);
      const priorSidecar = readFileSync(priorSidecarPath);
      const nextJournal = completedJournal("rejection");
      const newDigest = HISTORICAL_EXPECTATIONS[REJECTION_TRANSACTION_ID].digest;
      const newSidecarPath = join(directory, `journal.json.evaluator-${newDigest}.bin`);
      let helperExit;
      await assert.rejects(persistJournalToDisk(journalPath, nextJournal, lock, {
        [stage]: async () => { helperExit = await lock.terminateIoHelper("SIGKILL"); },
      }), /JOURNAL_SAVE_FAILED/, stage);
      assert.deepEqual(helperExit, { code: null, signal: "SIGKILL" }, stage);
      assert.deepEqual(readFileSync(journalPath), priorJournal, stage);
      assert.deepEqual(readFileSync(priorSidecarPath), priorSidecar, stage);
      assert.equal(existsSync(newSidecarPath), false, stage);
      assert.equal(existsSync(`${journalPath}.lock`), true, stage);
      assert.equal(lock.active, true, stage);
      assert.deepEqual(readdirSync(directory).filter((name) =>
        name.includes(".rollback") || name.includes(".tmp") || name.endsWith(".transaction")), [], stage);

      const recoveredJournalBytes = readFileSync(journalPath);
      const recoveredSidecarBytes = readFileSync(priorSidecarPath);
      const recoveredDirectoryMetadata = exactDirectoryMetadata(directory);
      const expectedRead = { exists: true, contents: recoveredJournalBytes.toString("utf8") };
      for (let recoveryAttempt = 1; recoveryAttempt <= 2; recoveryAttempt += 1) {
        const recovered = await lock.readJournal();
        assert.deepEqual(recovered, expectedRead, `${stage}: recovery ${recoveryAttempt}`);
        assert.doesNotThrow(() => validateStoredCompletedJournal(JSON.parse(recovered.contents),
          `0x${recoveredSidecarBytes.toString("hex")}`, "journal.json"),
        `${stage}: recovery ${recoveryAttempt}`);
        assert.deepEqual(readFileSync(journalPath), recoveredJournalBytes,
          `${stage}: recovery ${recoveryAttempt}: journal bytes`);
        assert.deepEqual(readFileSync(priorSidecarPath), recoveredSidecarBytes,
          `${stage}: recovery ${recoveryAttempt}: sidecar bytes`);
        assert.deepEqual(exactDirectoryMetadata(directory), recoveredDirectoryMetadata,
          `${stage}: recovery ${recoveryAttempt}: directory metadata`);
        assert.deepEqual(readdirSync(directory).filter((name) =>
          name.includes(".rollback") || name.includes(".tmp") || name.endsWith(".transaction")), [],
        `${stage}: recovery ${recoveryAttempt}: transaction artifacts`);
        assert.equal(existsSync(newSidecarPath), false, `${stage}: recovery ${recoveryAttempt}: new sidecar`);
        assert.equal(existsSync(`${journalPath}.lock`), true, `${stage}: recovery ${recoveryAttempt}: lock`);
        assert.equal(lock.active, true, `${stage}: recovery ${recoveryAttempt}: active lock`);
        assert.equal(await lock.verifyOwnership(), true, `${stage}: recovery ${recoveryAttempt}: lock ownership`);
      }
      await lock.release();
      lock = undefined;
    } finally {
      if (lock?.active) await lock.abandon();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("real helper SIGKILL after durable COMMIT_ACKNOWLEDGED rolls the new pair forward exactly once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-escrow-sidecar-post-commit-kill-"));
  const journalPath = join(directory, "journal.json");
  let lock;
  try {
    lock = await acquireJournalLock(journalPath, { pid: 6210, now: () => NOW });
    await persistJournalToDisk(journalPath, completedJournal(), lock);
    const prior = JSON.parse(readFileSync(journalPath, "utf8"));
    const priorSidecar = join(directory, prior.state.evaluator_evidence.sidecar_basename);
    const nextJournal = completedJournal("rejection");
    const expectedJournal = Buffer.from(`${JSON.stringify(nextJournal, null, 2)}\n`, "utf8");
    const expectedSidecar = Buffer.from(completedRawHex("rejection").slice(2), "hex");
    let helperExit;
    await persistJournalToDisk(journalPath, nextJournal, lock, {
      after_commit_acknowledged: async () => { helperExit = await lock.terminateIoHelper("SIGKILL"); },
    });
    assert.deepEqual(helperExit, { code: null, signal: "SIGKILL" });
    assert.deepEqual(readFileSync(journalPath), expectedJournal);
    const committed = JSON.parse(readFileSync(journalPath, "utf8"));
    assert.equal(committed.config.flow, "rejection");
    assert.equal(committed.state.evaluator_evidence.approved, false);
    const committedSidecar = join(directory, committed.state.evaluator_evidence.sidecar_basename);
    assert.deepEqual(readFileSync(committedSidecar), expectedSidecar);
    assert.equal(existsSync(priorSidecar), false);
    assert.deepEqual(readdirSync(directory).filter((name) =>
      name.includes(".rollback") || name.includes(".tmp") || name.endsWith(".transaction")), []);
    const filesAfterRecovery = readdirSync(directory).sort();
    const firstRead = await lock.readJournal();
    const secondRead = await lock.readJournal();
    assert.equal(firstRead.contents, expectedJournal.toString("utf8"));
    assert.deepEqual(secondRead, firstRead);
    assert.deepEqual(readdirSync(directory).sort(), filesAfterRecovery);
    assert.deepEqual(readFileSync(journalPath), expectedJournal);
    assert.deepEqual(readFileSync(committedSidecar), expectedSidecar);
    await lock.release();
    lock = undefined;
  } finally {
    if (lock?.active) await lock.abandon();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("real parent SIGKILL before durable COMMIT_ACKNOWLEDGED rolls the prior pair back on the next invocation", async () => {
  await proveParentSigkillRecovery({
    stage: "after_prepared_notification",
    durableState: "PREPARED_AFTER_RENAME",
    outcome: "rolled_back",
  });
});

test("real parent SIGKILL after durable COMMIT_ACKNOWLEDGED but before final success rolls the new pair forward", async () => {
  await proveParentSigkillRecovery({
    stage: "after_commit_acknowledged",
    durableState: "COMMIT_ACKNOWLEDGED",
    outcome: "committed",
  });
});

test("crash-left lock fails closed and temporary save names are process-unique", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-escrow-lock-crash-"));
  const journalPath = join(directory, "journal.json");
  const moduleUrl = new URL("../scripts/smoke-freelance-market.mjs", import.meta.url).href;
  const source = `import { acquireJournalLock } from ${JSON.stringify(moduleUrl)};
await acquireJournalLock(${JSON.stringify(journalPath)}, { pid: 3001, now: () => ${JSON.stringify(NOW)} });
process.stdout.write("LOCKED\\n");
await new Promise(() => {});`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; if (output.includes("LOCKED")) resolve(); });
      child.once("error", reject);
      child.once("exit", (code) => { if (!output.includes("LOCKED")) reject(new Error(`child exited ${code}`)); });
    });
    child.kill("SIGKILL");
    assert.deepEqual(await waitForChildExitResult(child), { code: null, signal: "SIGKILL" });
    await assert.rejects(acquireJournalLock(journalPath, { pid: 3002, now: () => NOW }), /LOCK_HELD/);
    const first = uniqueJournalTemporaryPath(journalPath, { pid: 3002, id: "11111111-1111-4111-8111-111111111111" });
    const second = uniqueJournalTemporaryPath(journalPath, { pid: 3002, id: "22222222-2222-4222-8222-222222222222" });
    assert.notEqual(first, second);
    assert.equal(readdirSync(directory).filter((name) => name.endsWith(".tmp")).length, 0);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("real parent SIGKILL after journal rename leaves a pre-commit transaction for next-invocation rollback", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-escrow-next-invocation-recovery-"));
  const journalPath = join(directory, "journal.json");
  let setupLock;
  let recoveryLock;
  let child;
  try {
    setupLock = await acquireJournalLock(journalPath, { pid: 6301, now: () => NOW });
    await persistJournalToDisk(journalPath, completedJournal(), setupLock);
    await setupLock.release();
    setupLock = undefined;
    const priorJournal = readFileSync(journalPath);
    const priorParsed = JSON.parse(priorJournal.toString("utf8"));
    const priorSidecarPath = join(directory, priorParsed.state.evaluator_evidence.sidecar_basename);
    const priorSidecar = readFileSync(priorSidecarPath);
    const moduleUrl = new URL("../scripts/smoke-freelance-market.mjs", import.meta.url).href;
    const nextJournal = JSON.parse(JSON.stringify(completedJournal("rejection")));
    const rejectionRaw = completedRawHex("rejection");
    const source = `import { acquireJournalLock, decodeBradburyEqBlocksOutputs, persistJournalToDisk } from ${JSON.stringify(moduleUrl)};
const value = ${JSON.stringify(nextJournal)};
const evidence = decodeBradburyEqBlocksOutputs(${JSON.stringify(rejectionRaw)}, ${JSON.stringify(VERIFY_HASH)});
Object.assign(evidence, value.state.evaluator_evidence);
value.state.evaluator_evidence = evidence;
const lock = await acquireJournalLock(${JSON.stringify(journalPath)}, { pid: process.pid, now: () => ${JSON.stringify(NOW)} });
await persistJournalToDisk(${JSON.stringify(journalPath)}, value, lock, { after_journal_rename: () => process.kill(process.pid, "SIGKILL") });`;
    child = spawn(process.execPath, ["--input-type=module", "--eval", source], { stdio: ["ignore", "pipe", "pipe"] });
    assert.deepEqual(await waitForChildExitResult(child), { code: null, signal: "SIGKILL" });
    child = undefined;
    assert.equal(existsSync(`${journalPath}.transaction`), true);
    rmSync(`${journalPath}.lock`);
    recoveryLock = await acquireJournalLock(journalPath, { pid: 6302, now: () => NOW });
    assert.deepEqual(readFileSync(journalPath), priorJournal);
    assert.deepEqual(readFileSync(priorSidecarPath), priorSidecar);
    assert.deepEqual(readdirSync(directory).filter((name) =>
      name.includes(".rollback") || name.includes(".tmp") || name.endsWith(".transaction")), []);
    await recoveryLock.release();
    recoveryLock = undefined;
  } finally {
    if (child?.exitCode === null) child.kill("SIGKILL");
    if (setupLock?.active) await setupLock.abandon();
    if (recoveryLock?.active) await recoveryLock.abandon();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent saves under one owner use distinct temporary files and leave valid journal data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-escrow-save-unique-"));
  const journalPath = join(directory, "journal.json");
  let lock;
  try {
    lock = await acquireJournalLock(journalPath, { pid: 4001, now: () => NOW });
    const first = journal({ created_at: "2026-07-20T11:57:00.000Z" });
    const second = journal({ created_at: "2026-07-20T11:58:00.000Z" });
    await Promise.all([persistJournalToDisk(journalPath, first, lock), persistJournalToDisk(journalPath, second, lock)]);
    const persisted = JSON.parse(readFileSync(journalPath, "utf8"));
    assert.equal(new Set([first.created_at, second.created_at]).has(persisted.created_at), true);
    assert.equal(readdirSync(directory).filter((name) => name.endsWith(".tmp")).length, 0);
    await lock.release();
    lock = undefined;
  } finally {
    if (lock?.active) await lock.release();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("all stable-directory save checkpoints preserve an existing valid journal byte-for-byte", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-escrow-save-fault-"));
  const journalPath = join(directory, "journal.json");
  const original = `${JSON.stringify(journal(), null, 2)}\n`;
  let lock;
  try {
    writeFileSync(journalPath, original, { mode: 0o600 });
    lock = await acquireJournalLock(journalPath, { pid: 6001, now: () => NOW });
    for (const stage of ["after_transaction_record", "after_backup_creation", "after_journal_rename",
      "after_prepared_notification"]) {
      await assert.rejects(persistJournalToDisk(journalPath,
        journal({ created_at: "2026-07-20T11:57:00.000Z" }), lock,
        { [stage]: async () => { throw new Error("injected checkpoint fault"); } }), /JOURNAL_SAVE_FAILED/, stage);
      assert.equal(readFileSync(journalPath, "utf8"), original, stage);
      assert.equal(readdirSync(directory).filter((name) => name.endsWith(".tmp")).length, 0, stage);
    }
    await lock.release();
    lock = undefined;
  } finally {
    if (lock?.active) await lock.release();
    rmSync(directory, { recursive: true, force: true });
  }
});

function retryDependencies(value, overrides = {}) {
  let writes = 0;
  let keyLoads = 0;
  let freelancerKeyLoads = 0;
  const dependencies = {
    journal: value, authorizedHash: FAILED_HASH, escrowWei: EXPECTED_ESCROW_WEI,
    getTransaction: async () => terminalFailure,
    readJob: async () => retryJob(),
    save: async () => {},
    loadClientAccount: () => { keyLoads += 1; return { address: config.client_address }; },
    loadFreelancerAccount: () => { freelancerKeyLoads += 1; throw new Error("must not load"); },
    createWriter: () => ({ writeContract: async (_request, { beforeRawBroadcast } = {}) => {
      beforeRawBroadcast?.(); writes += 1; return RETRY_HASH;
    } }),
    wait: async () => success,
    now: () => NOW,
    ...overrides,
  };
  return { dependencies, counts: () => ({ writes, keyLoads, freelancerKeyLoads }) };
}

test("retry writer construction leaves console descriptors untouched and sanitizes failures", async () => {
  const secret = "DISTINCTIVE_RETRY_WRITER_CONSTRUCTOR_SECRET";
  const before = Object.fromEntries(["error", "warn", "log"].map((name) => [name, Object.getOwnPropertyDescriptor(console, name)]));
  const value = retryJournal();
  const fixture = retryDependencies(value, { createWriter: () => { throw new Error(secret); } });
  const error = await capturedFailure(() => executeVerifyRetry(fixture.dependencies));
  assert.match(error.message, /WRITE_CLIENT_CREATION_FAILED/);
  assert.equal(error.message.includes(secret), false);
  for (const name of Object.keys(before)) assert.deepEqual(Object.getOwnPropertyDescriptor(console, name), before[name]);
});

test("missing retry balance baseline fails before account loading, writer creation, or submission", async () => {
  const value = retryJournal();
  delete value.state.before_verification_freelancer_balance;
  let accountLoads = 0;
  let writerCreations = 0;
  let writes = 0;
  const fixture = retryDependencies(value, {
    loadClientAccount: () => { accountLoads += 1; return { address: config.client_address }; },
    createWriter: () => { writerCreations += 1; return { writeContract: async () => { writes += 1; } }; },
  });
  await assert.rejects(executeVerifyRetry(fixture.dependencies), /PRE_VERIFICATION_SNAPSHOTS_MISSING/);
  assert.deepEqual({ accountLoads, writerCreations, writes }, { accountLoads: 0, writerCreations: 0, writes: 0 });
});

test("malformed and negative retry balance baselines fail before any side effect", async () => {
  for (const baseline of ["-1", "01", "1.2", "", 1]) {
    const value = retryJournal({}, { before_verification_freelancer_balance: baseline });
    const fixture = retryDependencies(value);
    await assert.rejects(executeVerifyRetry(fixture.dependencies), /FREELANCER_BALANCE_BASELINE_INVALID/);
    assert.deepEqual(fixture.counts(), { writes: 0, keyLoads: 0, freelancerKeyLoads: 0 });
  }
});

test("pre-job snapshots cannot substitute for missing immediate pre-verification snapshots", async () => {
  const value = retryJournal();
  for (const key of Object.keys(value.state).filter((key) => key.startsWith("before_verification_"))) delete value.state[key];
  value.state.before_stats = { total_paid: "10" };
  value.state.before_freelancer_profile = { total_earned: "4", jobs_completed: "2" };
  const fixture = retryDependencies(value);
  await assert.rejects(executeVerifyRetry(fixture.dependencies), /PRE_VERIFICATION_SNAPSHOTS_MISSING/);
  assert.deepEqual(fixture.counts(), { writes: 0, keyLoads: 0, freelancerKeyLoads: 0 });
});

test("snapshot start-time freshness boundaries fail closed before side effects", async () => {
  const nowMs = Date.parse(NOW);
  const cases = [
    [undefined, /SNAPSHOTS_MISSING/],
    ["2026-07-20 12:00:00Z", /TIMESTAMP_MALFORMED/],
    [new Date(nowMs + 1).toISOString(), /TIMESTAMP_FUTURE/],
    [new Date(nowMs - MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS - 1).toISOString(), /STALE_MANUAL_INVESTIGATION_REQUIRED/],
  ];
  for (const [capturedAt, expected] of cases) {
    const value = retryJournal();
    if (capturedAt === undefined) delete value.state.before_verification_snapshot_started_at;
    else value.state.before_verification_snapshot_started_at = capturedAt;
    const fixture = retryDependencies(value);
    await assert.rejects(executeVerifyRetry(fixture.dependencies), expected);
    assert.deepEqual(fixture.counts(), { writes: 0, keyLoads: 0, freelancerKeyLoads: 0 });
  }
});

test("snapshot exactly at the fixed age limit authorizes the expected retry path", async () => {
  const value = retryJournal({}, {
    before_verification_snapshot_started_at: new Date(Date.parse(NOW) - MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS).toISOString(),
  });
  const fixture = retryDependencies(value);
  await executeVerifyRetry(fixture.dependencies);
  assert.deepEqual(fixture.counts(), { writes: 1, keyLoads: 1, freelancerKeyLoads: 0 });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

test("initial verification rechecks freshness after durable intent and permits the inclusive limit", async () => {
  const value = retryJournal();
  value.steps = {};
  value.state.before_verification_snapshot_started_at = new Date(Date.parse(NOW) - MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS).toISOString();
  let writes = 0;
  const order = [];
  await submitStep({ journal: value, stepName: "verify_and_release", sender: config.client_address,
    request: { address: config.contract_address, functionName: "verify_and_release", args: ["2"], value: 0n },
    save: async () => { order.push("save"); },
    beforeRawBroadcast: () => { order.push("guard-start"); assertPreVerificationSnapshots({ journal: value,
      escrowWei: EXPECTED_ESCROW_WEI, now: () => NOW }); order.push("guard-end"); },
    client: { writeContract: (_request, { beforeRawBroadcast } = {}) => {
      order.push("prepared"); beforeRawBroadcast?.(); order.push("transport-start"); writes += 1; return VERIFY_HASH;
    } }, wait: async () => success });
  assert.equal(writes, 1);
  assert.deepEqual(order.slice(0, 5), ["save", "prepared", "guard-start", "guard-end", "transport-start"]);
});

test("initial verification expiration while intent save is pending leaves ambiguous intent and writes zero", async () => {
  const value = retryJournal();
  value.steps = {};
  const intentSaved = deferred();
  const continueSave = deferred();
  let nowMs = Date.parse(NOW);
  value.state.before_verification_snapshot_started_at = new Date(nowMs - MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS).toISOString();
  let writes = 0;
  const submission = submitStep({ journal: value, stepName: "verify_and_release", sender: config.client_address,
    request: { address: config.contract_address, functionName: "verify_and_release", args: ["2"], value: 0n },
    save: async () => { intentSaved.resolve(); await continueSave.promise; },
    beforeRawBroadcast: () => assertPreVerificationSnapshots({ journal: value, escrowWei: EXPECTED_ESCROW_WEI, now: () => nowMs }),
    client: { writeContract: (_request, { beforeRawBroadcast } = {}) => {
      beforeRawBroadcast?.(); writes += 1; return VERIFY_HASH;
    } }, wait: async () => success });
  await intentSaved.promise;
  nowMs += 1;
  continueSave.resolve();
  const error = await capturedFailure(() => submission);
  assert.match(error.message, /STALE_MANUAL_INVESTIGATION_REQUIRED/);
  assert.equal(safeProcessError(error).includes(value.state.before_verification_snapshot_started_at), false);
  assert.equal(writes, 0);
  assert.equal(value.steps.verify_and_release.status, "INTENT_RECORDED");
  await assert.rejects(submitStep({ journal: value, stepName: "verify_and_release", sender: config.client_address,
    request: { address: config.contract_address, functionName: "verify_and_release", args: ["2"], value: 0n },
    save: async () => {}, beforeRawBroadcast: () => assert.fail("must not guard or broadcast"),
    client: { writeContract: () => { writes += 1; } }, wait: async () => success }), /AMBIGUOUS_BROADCAST/);
  assert.equal(writes, 0);
});

test("nonce, gas, gas-price, and signing delays expire at the true raw-broadcast boundary", async () => {
  for (const delayedStage of ["nonce", "gas", "gas-price", "signing"]) {
    const value = retryJournal();
    value.steps = {};
    let nowMs = Date.parse(NOW);
    value.state.before_verification_snapshot_started_at =
      new Date(nowMs - MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS).toISOString();
    let rawBroadcasts = 0;
    const baseAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
    const account = delayedStage === "signing" ? { ...baseAccount, signTransaction: async (transaction) => {
      const signed = await baseAccount.signTransaction(transaction);
      nowMs += 1;
      return signed;
    } } : baseAccount;
    const writer = createBradburyRpcClient({ account, now: () => nowMs, receiptAttempts: 1, intervalMs: 0,
      fetchFn: async (_url, rawRequest) => {
        const payload = JSON.parse(rawRequest.body);
        if (payload.method === "eth_getTransactionCount") {
          if (delayedStage === "nonce") nowMs += 1;
          return rpcResult(payload.id, "0x1");
        }
        if (payload.method === "eth_estimateGas") {
          if (delayedStage === "gas") nowMs += 1;
          return rpcResult(payload.id, "0x30d40");
        }
        if (payload.method === "eth_gasPrice") {
          if (delayedStage === "gas-price") nowMs += 1;
          return rpcResult(payload.id, "0x3b9aca00");
        }
        if (payload.method === "eth_sendRawTransaction") {
          rawBroadcasts += 1;
          return rpcResult(payload.id, EXPECTED_LOCAL_EVM_HASH);
        }
        assert.fail(`unexpected method ${payload.method}`);
      } });
    const operation = submitStep({ journal: value, stepName: "verify_and_release", sender: config.client_address,
      request: { address: config.contract_address, functionName: "verify_and_release", args: ["2"], value: 0n },
      save: async () => {}, client: writer, wait: async () => success,
      beforeRawBroadcast: () => assertPreVerificationSnapshots({ journal: value,
        escrowWei: EXPECTED_ESCROW_WEI, now: () => nowMs }) });
    await assert.rejects(operation, /STALE_MANUAL_INVESTIGATION_REQUIRED/, delayedStage);
    assert.equal(rawBroadcasts, 0, delayedStage);
    assert.equal(value.steps.verify_and_release.status, "INTENT_RECORDED", delayedStage);
    await assert.rejects(submitStep({ journal: value, stepName: "verify_and_release", sender: config.client_address,
      request: { address: config.contract_address, functionName: "verify_and_release", args: ["2"], value: 0n },
      save: async () => {}, client: writer, wait: async () => success,
      beforeRawBroadcast: () => assert.fail("ambiguous rerun must not prepare") }), /AMBIGUOUS_BROADCAST/, delayedStage);
  }
});

test("production raw-broadcast callback must be synchronous and starts no transport when invalid", async () => {
  const fixture = protocolWriter();
  await assert.rejects(fixture.client.writeContract({ address: EXPECTED_CONTRACT_ADDRESS,
    functionName: "verify_and_release", args: ["2"], value: 0n },
  { beforeRawBroadcast: async () => {} }), /MUST_BE_SYNCHRONOUS/);
  assert.equal(fixture.sends(), 0);
});

test("authorized retry expiration during intent save loads only after read checks but blocks broadcast and rerun", async () => {
  const value = retryJournal();
  value.state.before_verification_snapshot_started_at = new Date(Date.parse(NOW) - MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS).toISOString();
  const intentSaved = deferred();
  const continueSave = deferred();
  let nowMs = Date.parse(NOW);
  let saves = 0;
  let keyLoads = 0;
  let writerCreations = 0;
  let writes = 0;
  const dependencies = {
    journal: value, authorizedHash: FAILED_HASH, escrowWei: EXPECTED_ESCROW_WEI, now: () => nowMs,
    getTransaction: async () => terminalFailure, readJob: async () => retryJob(),
    save: async () => { saves += 1; if (saves === 2) { intentSaved.resolve(); await continueSave.promise; } },
    loadClientAccount: () => { keyLoads += 1; return { address: config.client_address }; },
    createWriter: () => { writerCreations += 1; return { writeContract: (_request, { beforeRawBroadcast } = {}) => {
      beforeRawBroadcast?.(); writes += 1; return RETRY_HASH;
    } }; },
    wait: async () => success,
  };
  const retry = executeVerifyRetry(dependencies);
  await intentSaved.promise;
  assert.deepEqual({ keyLoads, writerCreations, writes }, { keyLoads: 1, writerCreations: 1, writes: 0 });
  nowMs += 1;
  continueSave.resolve();
  await assert.rejects(retry, /STALE_MANUAL_INVESTIGATION_REQUIRED/);
  assert.equal(value.steps.verify_and_release_retry_1.status, "INTENT_RECORDED");
  assert.deepEqual({ keyLoads, writerCreations, writes }, { keyLoads: 1, writerCreations: 1, writes: 0 });
  await assert.rejects(executeVerifyRetry({ ...dependencies, authorizedHash: RETRY_HASH }), /AMBIGUOUS_BROADCAST/);
  assert.equal(writes, 0);
});

test("verification guard must be synchronous and failed intent save performs zero writes", async () => {
  const request = { address: config.contract_address, functionName: "verify_and_release", args: ["2"], value: 0n };
  let writes = 0;
  await assert.rejects(submitStep({ journal: journal(), stepName: "verify_and_release", sender: config.client_address, request,
    save: async () => { throw new Error("save failed"); }, beforeRawBroadcast: () => {},
    client: { writeContract: () => { writes += 1; } }, wait: async () => success }), /save failed/);
  assert.equal(writes, 0);
});

test("explicitly authorized stale retry hash still performs zero side effects", async () => {
  const value = retryJournal({}, {
    before_verification_snapshot_started_at: new Date(Date.parse(NOW) - MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS - 1).toISOString(),
  });
  const fixture = retryDependencies(value, { authorizedHash: FAILED_HASH });
  await assert.rejects(executeVerifyRetry(fixture.dependencies), /STALE_MANUAL_INVESTIGATION_REQUIRED/);
  assert.deepEqual(fixture.counts(), { writes: 0, keyLoads: 0, freelancerKeyLoads: 0 });
});

test("partial snapshot persistence cannot authorize a write", async () => {
  for (const key of ["before_verification_context", "before_verification_job", "before_verification_stats",
    "before_verification_freelancer_profile", "before_verification_freelancer_balance", "before_verification_snapshot_started_at"]) {
    const value = retryJournal();
    delete value.state[key];
    const fixture = retryDependencies(value);
    await assert.rejects(executeVerifyRetry(fixture.dependencies), /PRE_VERIFICATION_SNAPSHOTS_MISSING/);
    assert.deepEqual(fixture.counts(), { writes: 0, keyLoads: 0, freelancerKeyLoads: 0 });
  }
});

test("failed atomic snapshot save rolls back the complete in-memory set", async () => {
  const value = journal({ state: { job_id: "2" } });
  const secret = "DISTINCTIVE_SNAPSHOT_SAVE_SECRET";
  const error = await capturedFailure(() => recordPreVerificationSnapshots({ journal: value,
    job: retryJob(), escrowWei: EXPECTED_ESCROW_WEI,
    readStats: async () => ({ total_paid: "10" }),
    readProfile: async () => ({ found: true, address: config.freelancer_address, role: "freelancer",
      total_earned: "4", jobs_completed: "2" }),
    readBalance: async () => 100n, save: async () => { throw new Error(secret); }, now: () => NOW }));
  assert.match(safeProcessError(error), /PRE_VERIFICATION_SNAPSHOT_SAVE_FAILED/);
  assert.equal(JSON.stringify(value).includes(secret), false);
  assert.equal(Object.keys(value.state).some((key) => key.startsWith("before_verification_")), false);
});

test("manual authorization is exact and missing or wrong hashes perform zero writes", async () => {
  for (const [authorizedHash, error] of [[undefined, /VERIFY_RETRY_REQUIRED/], [OTHER_HASH, /VERIFY_RETRY_HASH_MISMATCH/]]) {
    const value = retryJournal();
    const fixture = retryDependencies(value, { authorizedHash });
    await assert.rejects(executeVerifyRetry(fixture.dependencies), error);
    assert.deepEqual(fixture.counts(), { writes: 0, keyLoads: 0, freelancerKeyLoads: 0 });
  }
});

test("pending, successful, and malformed previous receipts perform zero writes", async () => {
  for (const [transaction, error] of [
    [{ hash: FAILED_HASH, status: 4, statusName: "REVEALING", resultName: "IDLE", txExecutionResultName: "NOT_VOTED" }, /PREVIOUS_PENDING/],
    [{ ...success, hash: FAILED_HASH }, /PREVIOUS_SUCCESSFUL/],
    [{ hash: FAILED_HASH, status: 13, statusName: "LEADER_TIMEOUT", resultName: "IDLE" }, /RECEIPT_RPC_FAILED/],
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
  assert.equal(value.steps.verify_and_release.terminal_failure_confirmed_at, NOW);
  assert.equal(value.steps.verify_and_release.status, "TERMINAL_FAILURE_CONFIRMED");
  assert.equal(value.steps.verify_and_release_retry_1.hash, RETRY_HASH);
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
  const value = retryJournal({ verify_and_release_retry_1: { status: "HASH_RECORDED", hash: RETRY_HASH, request: {} } });
  const fixture = retryDependencies(value, { authorizedHash: undefined });
  await assert.rejects(executeVerifyRetry(fixture.dependencies), /VERIFY_RETRY_REQUIRED/);
  assert.equal(fixture.counts().writes, 0);
  const wrong = retryDependencies(value, { authorizedHash: FAILED_HASH });
  await assert.rejects(executeVerifyRetry(wrong.dependencies), /VERIFY_RETRY_HASH_MISMATCH/);
  assert.equal(wrong.counts().writes, 0);
});

test("all read-only job checks precede key loading", async () => {
  const mutations = [
    ["deliverable_url", "https://example.test/changed", /URL_MISMATCH/], ["escrow_balance", "2", /ESCROW_MISMATCH/],
    ["status", "PAID", /STATUS_MISMATCH/], ["ai_verdict", "APPROVED", /VERDICT_NOT_EMPTY/],
    ["ai_reasoning", { present: true, byte_length: 6, sha256: "4".repeat(64) }, /REASONING_NOT_EMPTY/],
    ["title", "changed", /JOB_EVIDENCE_IDENTITY_INVALID/], ["job_id", "3", /JOB_ID_MISMATCH/],
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
  await assert.rejects(executeVerifyRetry(fixture.dependencies), /BROADCAST_RESULT_UNKNOWN/);
  assert.equal(value.steps.verify_and_release_retry_1.status, "INTENT_RECORDED");
  assert.equal(value.steps.verify_and_release_retry_1.hash, undefined);
  assert.equal(savedStatuses.includes("INTENT_RECORDED"), true);
});

test("final evidence follows a valid success pointer and rejects a failed pointer", () => {
  const input = accountingInput("approval");
  input.journal.steps.verify_and_release.status = "TERMINAL_FAILURE_CONFIRMED";
  input.journal.steps.verify_and_release.execution = { status_name: "LEADER_TIMEOUT", result_name: "IDLE", execution_result_name: "NOT_VOTED" };
  input.journal.steps.verify_and_release_retry_1 = {
    status: "EXECUTION_CONFIRMED", hash: VERIFY_HASH, request: { sender: config.client_address, address: config.contract_address,
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
  await assert.rejects(prepareVerifyRetry({ journal: value, authorizedHash: FAILED_HASH, escrowWei: EXPECTED_ESCROW_WEI, now: () => NOW,
    getTransaction: async () => terminalFailure, readJob: async () => retryJob({ client: "0xchanged" }),
    save: async () => { saves += 1; } }), /JOB_EVIDENCE_INVALID/);
  assert.equal(saves, 0);
  assert.equal(value.steps.verify_and_release.status, "HASH_RECORDED");
});

function terminalRunFixture(flow = "approval") {
  const input = accountingInput(flow);
  input.journal.config = { ...config, flow };
  const events = [];
  let jobReads = 0;
  const dependencies = {
    flow,
    journal: input.journal,
    save: async () => { events.push("save"); },
    waitFinalized: async () => { events.push("finalized"); return input.verificationFinalization; },
    read: async (method) => {
      events.push(method);
      if (method === "get_job") { jobReads += 1; return input.job; }
      if (method === "get_stats") return input.afterStats;
      if (method === "get_profile") return input.afterProfile;
      assert.fail("unexpected terminal read");
    },
    readFreelancerBalance: async () => { events.push("balance"); return BigInt(input.afterFreelancerBalance); },
    escrowWei: EXPECTED_ESCROW_WEI,
  };
  return { input, dependencies, events, jobReads: () => jobReads };
}

test("status code 7 and comparative output precede every terminal-state read", async () => {
  const fixture = terminalRunFixture("approval");
  await finishRun(fixture.dependencies);
  assert.deepEqual(fixture.events.slice(0, 6), ["finalized", "get_job", "get_stats", "get_profile", "balance", "get_job"]);
  assert.equal(fixture.input.journal.status, "COMPLETED");
  assert.equal(fixture.input.journal.state.evaluator_evidence.approved, true);
  for (const transaction of [
    { hash: VERIFY_HASH, status: 5, statusName: "ACCEPTED", resultName: "AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" },
    { hash: VERIFY_HASH, status: 6, statusName: "UNDETERMINED", resultName: "AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" },
    { hash: VERIFY_HASH, status: 7, statusName: "FINALIZED", resultName: "AGREE", txExecutionResultName: "FINISHED_WITH_RETURN" },
  ]) {
    const blocked = terminalRunFixture("approval");
    blocked.dependencies.waitFinalized = async () => transaction;
    await assert.rejects(finishRun(blocked.dependencies));
    assert.equal(blocked.jobReads(), 0);
    assert.deepEqual(blocked.events, []);
  }
});

test("post-finalization bracketing detects refund or escrow changes without persisting terminal evidence", async () => {
  const fixture = terminalRunFixture("rejection");
  let reads = 0;
  fixture.dependencies.read = async (method) => {
    if (method === "get_job") {
      reads += 1;
      return reads === 1 ? fixture.input.job : { ...fixture.input.job, escrow_balance: "0" };
    }
    if (method === "get_stats") return fixture.input.afterStats;
    if (method === "get_profile") return fixture.input.afterProfile;
    assert.fail("unexpected terminal read");
  };
  await assert.rejects(finishRun(fixture.dependencies), /FINAL_JOB_EVIDENCE_WINDOW_CHANGED/);
  assert.equal(fixture.input.journal.status, "ACTIVE");
  assert.equal(fixture.input.journal.state.final_job, undefined);
});

test("approval post-finalization bracketing detects a changed paid job before persistence", async () => {
  const fixture = terminalRunFixture("approval");
  let reads = 0;
  fixture.dependencies.read = async (method) => {
    if (method === "get_job") {
      reads += 1;
      return reads === 1 ? fixture.input.job : { ...fixture.input.job, ai_verdict: "REJECTED" };
    }
    if (method === "get_stats") return fixture.input.afterStats;
    if (method === "get_profile") return fixture.input.afterProfile;
    assert.fail("unexpected terminal read");
  };
  await assert.rejects(finishRun(fixture.dependencies), /FINAL_JOB_EVIDENCE_WINDOW_CHANGED/);
  assert.equal(fixture.input.journal.status, "ACTIVE");
  assert.equal(fixture.input.journal.state.final_job, undefined);
});

test("gas estimate multiplier 2 doubles signed gas without changing estimation input or broadcast-guard timing", async () => {
  const { createBradburyRpcClient } = await import("../scripts/smoke-freelance-market.mjs");
  const baseAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
  const events = [];
  const requests = [];
  let signedTransaction;
  let localHash;

  const client = createBradburyRpcClient({
    account: {
      ...baseAccount,
      signTransaction: async (transaction) => {
        signedTransaction = transaction;
        events.push("sign");
        return baseAccount.signTransaction(transaction);
      },
    },
    gasEstimateMultiplier: 2,
    now: () => Date.parse(NOW),
    receiptAttempts: 1,
    intervalMs: 0,
    fetchFn: async (_url, rawRequest) => {
      const payload = JSON.parse(rawRequest.body);
      requests.push(payload);

      if (payload.method === "eth_getTransactionCount") {
        return rpcResult(payload.id, "0x1");
      }

      if (payload.method === "eth_estimateGas") {
        return rpcResult(payload.id, "0x30d40");
      }

      if (payload.method === "eth_gasPrice") {
        return rpcResult(payload.id, "0x3b9aca00");
      }

      if (payload.method === "eth_sendRawTransaction") {
        events.push("send");
        localHash = keccak256(payload.params[0]);
        return rpcResult(payload.id, localHash);
      }

      if (payload.method === "eth_getTransactionReceipt") {
        assert.equal(payload.params[0], localHash);
        return rpcResult(
          payload.id,
          successfulEvmReceipt(
            [newTransactionLog(VERIFY_HASH, { transactionHash: localHash })],
            { transactionHash: localHash },
          ),
        );
      }

      assert.fail(`unexpected method ${payload.method}`);
    },
  });

  let guardCalls = 0;

  const transactionId = await client.writeContract(
    {
      address: EXPECTED_CONTRACT_ADDRESS,
      functionName: "verify_and_release",
      args: ["2"],
      value: 0n,
    },
    {
      beforeRawBroadcast: () => {
        guardCalls += 1;
        events.push("guard");
      },
    },
  );

  assert.equal(transactionId, VERIFY_HASH);
  assert.equal(signedTransaction.gas, 0x30d40n * 2n);

  const estimateRequest = requests.find(
    ({ method }) => method === "eth_estimateGas",
  );

  assert.deepEqual(estimateRequest.params, [
    {
      from: TEST_SIGNER,
      to: CONSENSUS_ADDRESS,
      data: EXPECTED_ADD_TRANSACTION_CALLDATA,
      value: "0x0",
    },
  ]);

  assert.equal(guardCalls, 1);
  assert.deepEqual(events.slice(-2), ["guard", "send"]);
});

test("invalid gas estimate multipliers fail before RPC or signing side effects", async () => {
  const { createBradburyRpcClient } = await import("../scripts/smoke-freelance-market.mjs");

  for (const gasEstimateMultiplier of [
    0,
    -1,
    1.5,
    5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    "2",
    null,
  ]) {
    let rpcCalls = 0;
    let signingCalls = 0;

    assert.throws(
      () =>
        createBradburyRpcClient({
          account: {
            address: TEST_SIGNER,
            signTransaction: async () => {
              signingCalls += 1;
              return "0x01";
            },
          },
          gasEstimateMultiplier,
          fetchFn: async () => {
            rpcCalls += 1;
            throw new Error("must not perform RPC");
          },
        }),
      /RPC_CLIENT_CONFIG_INVALID/,
      String(gasEstimateMultiplier),
    );

    assert.equal(rpcCalls, 0, String(gasEstimateMultiplier));
    assert.equal(signingCalls, 0, String(gasEstimateMultiplier));
  }
});

test("all live Bradbury writer paths use multiplier 2 while read clients keep default options", async () => {
  const { createLiveBradburyWriterRpcOptions } = await import(
    "../scripts/smoke-freelance-market.mjs"
  );
  const { readFile } = await import("node:fs/promises");

  const baseOptions = Object.freeze({
    projectionConfig: {
      contract_address: EXPECTED_CONTRACT_ADDRESS,
    },
    receiptAttempts: 120,
    intervalMs: 5_000,
  });

  const writerOptions = createLiveBradburyWriterRpcOptions(baseOptions);

  assert.deepEqual(writerOptions, {
    ...baseOptions,
    gasEstimateMultiplier: 2,
  });

  assert.equal(
    Object.hasOwn(baseOptions, "gasEstimateMultiplier"),
    false,
  );

  const source = await readFile(
    new URL("../scripts/smoke-freelance-market.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const writerRpcOptions = createLiveBradburyWriterRpcOptions\(rpcOptions\);/,
  );

  assert.match(
    source,
    /createBradburyReadClient\(createBradburyRpcClient,\s*rpcOptions\)/,
  );

  assert.match(
    source,
    /createWriter:\s*\(account\)\s*=>\s*createBradburyWriterClient\(\s*account,\s*createBradburyRpcClient,\s*writerRpcOptions,\s*\)/,
  );

  assert.match(
    source,
    /const client = createBradburyWriterClient\(clientAccount,\s*createBradburyRpcClient,\s*writerRpcOptions\);/,
  );

  assert.match(
    source,
    /const freelancer = createBradburyWriterClient\(freelancerAccount,\s*createBradburyRpcClient,\s*writerRpcOptions\);/,
  );
});
