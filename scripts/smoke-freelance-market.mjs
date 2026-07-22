/**
 * Explicitly opt-in, resumable GenLayer Bradbury smoke runner.
 *
 * Required environment:
 *   SMOKE_LIVE_BRADBURY=I_UNDERSTAND_THIS_WRITES_TO_BRADBURY
 *   SMOKE_BRADBURY_CHAIN_ID=4221
 *   SMOKE_BRADBURY_CONTRACT_ADDRESS=0x...
 *   SMOKE_BRADBURY_CLIENT_ADDRESS=0x...
 *   SMOKE_BRADBURY_FREELANCER_ADDRESS=0x...
 *   SMOKE_BRADBURY_CLIENT_PRIVATE_KEY=0x...
 *   SMOKE_BRADBURY_FREELANCER_PRIVATE_KEY=0x...
 *   SMOKE_APPROVAL_DELIVERABLE_URL=https://... (approval flow)
 *   SMOKE_REJECTION_DELIVERABLE_URL=https://... (rejection flow)
 *
 * Optional: SMOKE_ESCROW_WEI=1000000000000000000, SMOKE_POLL_INTERVAL_MS=5000,
 * SMOKE_RECEIPT_ATTEMPTS=120, SMOKE_STATE_ATTEMPTS=120, and flow-prefixed
 * SMOKE_APPROVAL/REJECTION_JOB_TITLE/JOB_DESCRIPTION variables.
 *
 * Journals are .smoke-freelance-market.<flow>.json. To start a new run, first
 * inspect every recorded/ambiguous transaction, then manually rename the old journal
 * (for example, append .completed-<run-id>) and invoke the command again. To recover
 * an ambiguous broadcast, manually set that step to HASH_RECORDED and add its verified
 * hash. The runner never deletes or replaces an existing run with different configuration.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { abi, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import {
  DECIDED_STATES,
  ExecutionResult,
  TransactionResult,
  TransactionStatus,
  executionResultNumberToName,
  transactionResultNumberToName,
  transactionsStatusNumberToName,
} from "genlayer-js/types";
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, fromRlp, hexToBytes, keccak256, parseTransaction,
  recoverTransactionAddress, stringToHex } from "viem";
import { SUCCESS_RESULTS } from "./genlayer-transaction-outcomes.mjs";

export const JOURNAL_SCHEMA_VERSION = 1;
export const MIN_DELIVERABLE_URL_LENGTH = 10;
export const MAX_DELIVERABLE_URL_LENGTH = 500;
export const MIN_JOB_TITLE_LENGTH = 3;
export const MAX_JOB_TITLE_LENGTH = 100;
export const MIN_JOB_DESCRIPTION_LENGTH = 20;
export const MAX_JOB_DESCRIPTION_LENGTH = 1000;
export const BRADBURY_CHAIN_ID = 4221;
export const BRADBURY_CONTRACT_ADDRESS = "0x066131dffbE72e27AB40446620792d45a9a6054a";
export const BRADBURY_CLIENT_ADDRESS = "0x5bB49021001200fE8156a81c7fcF097e535e7181";
export const BRADBURY_FREELANCER_ADDRESS = "0x1f87Ae197af539253978d435aD45cCf28Fb95024";
export const EXACT_ESCROW_WEI = 1_000_000_000_000_000_000n;
export const LIVE_OPT_IN = "I_UNDERSTAND_THIS_WRITES_TO_BRADBURY";
export const EXTERNAL_ERROR_MARKER = "[external error redacted]";
export const MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS = 10 * 60 * 1_000;
export const EVALUATOR_STRUCTURAL_SELECTOR = "eqBlocksOutputs.rlp[0].genvm_return.calldata_string.json";
export const EVALUATOR_OUTPUT_IDENTITY = "rlp_item_0_successful_genvm_return";
const EVALUATOR_PADDED_MARKER = new TextEncoder().encode("padded");
const EVALUATOR_RAW_OUTPUTS = new WeakMap();
const MAX_EVALUATOR_TEXT_CODE_POINTS = 500;
const MAX_EVALUATOR_TEXT_UTF8_BYTES = 2_000;
if (testnetBradbury.id !== BRADBURY_CHAIN_ID) throw new Error("Installed Bradbury chain definition is not chain ID 4221");
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

function positiveBigInt(name, fallback, environment = process.env) {
  const raw = environment[name] ?? fallback;
  if ((typeof raw !== "string" && typeof raw !== "bigint") || !/^[1-9]\d*$/.test(String(raw))) {
    throw new Error("POSITIVE_BIGINT_CONFIGURATION_INVALID");
  }
  const value = BigInt(raw);
  if (value <= 0n) throw new Error(`${name} must be positive`);
  return value;
}

function required(name, environment = process.env) {
  const value = environment[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const safeSmokeErrors = new WeakSet();

function safeError(code, context = {}) {
  const suffix = Object.entries(context).map(([key, value]) => ` ${key}=${String(value)}`).join("");
  const error = new Error(`${code}${suffix}`);
  safeSmokeErrors.add(error);
  return error;
}

function externalError(code, operation, context = {}) {
  return safeError(code, { operation, ...context, detail: EXTERNAL_ERROR_MARKER });
}

export function safeProcessError(error) {
  return safeSmokeErrors.has(error) ? error.message : externalError("SMOKE_FLOW_FAILED", "top_level").message;
}

function safeErrorCode(error) {
  if (!safeSmokeErrors.has(error)) return null;
  const match = /^([A-Z][A-Z0-9_]*)(?: |$)/.exec(String(error.message));
  return match?.[1] ?? null;
}

function submitWriteFailure(error) {
  const stage = safeErrorCode(error);

  if (stage?.startsWith("PRE_VERIFICATION_") ||
      stage?.startsWith("BEFORE_RAW_BROADCAST_")) {
    return error;
  }

  const preBroadcastFailure = stage !== null && (
    [
      "WRITE_ACCOUNT_INVALID",
      "WRITE_REQUEST_INVALID",
      "WRITE_REQUEST_ENCODING_FAILED",
      "WRITE_TRANSACTION_SIGNING_FAILED",
      "WRITE_TRANSACTION_SIGNING_RESULT_INVALID",
      "RPC_TRANSACTION_BROADCAST_REQUEST_INVALID",
    ].includes(stage) ||
    stage.startsWith("RPC_NONCE_READ_") ||
    stage.startsWith("RPC_GAS_ESTIMATE_") ||
    stage.startsWith("RPC_GAS_PRICE_")
  );

  if (preBroadcastFailure) {
    return externalError("WRITE_PRE_BROADCAST_FAILED", "write_contract", {
      stage,
      journal: "intent_remains_recorded",
      broadcast: "not_started",
    });
  }

  return externalError("BROADCAST_RESULT_UNKNOWN", "write_contract", {
    ...(stage === null ? {} : { stage }),
    journal: "intent_remains_recorded",
    broadcast: stage === null ? "unknown" : "started_or_unknown",
  });
}

function requireSynchronousDependency(operation) {
  const result = operation();
  if (result && typeof result.then === "function") {
    Promise.resolve(result).catch(() => {});
    throw safeError("DEPENDENCY_OPERATION_MUST_BE_SYNCHRONOUS");
  }
  return result;
}

export function assertLiveOptIn(environment = process.env) {
  if (environment.SMOKE_LIVE_BRADBURY !== LIVE_OPT_IN) {
    throw new Error(`LIVE_SMOKE_OPT_IN_REQUIRED: set SMOKE_LIVE_BRADBURY=${LIVE_OPT_IN} only for an explicitly authorized Bradbury write run`);
  }
}

export function loadSmokeRuntimeConfig(flow, environment = process.env) {
  if (!new Set(["approval", "rejection"]).has(flow)) {
    throw new Error("Usage: node scripts/smoke-freelance-market.mjs <approval|rejection>");
  }
  assertLiveOptIn(environment);
  const chainIdText = required("SMOKE_BRADBURY_CHAIN_ID", environment);
  if (chainIdText !== String(BRADBURY_CHAIN_ID)) throw new Error("SMOKE_BRADBURY_CHAIN_ID must be exactly 4221");
  const contractAddress = required("SMOKE_BRADBURY_CONTRACT_ADDRESS", environment);
  const clientAddress = required("SMOKE_BRADBURY_CLIENT_ADDRESS", environment);
  const freelancerAddress = required("SMOKE_BRADBURY_FREELANCER_ADDRESS", environment);
  if (!sameAddress(contractAddress, BRADBURY_CONTRACT_ADDRESS)) throw new Error("UNSUPPORTED_BRADBURY_CONTRACT");
  if (!sameAddress(clientAddress, BRADBURY_CLIENT_ADDRESS)) throw new Error("UNSUPPORTED_BRADBURY_CLIENT");
  if (!sameAddress(freelancerAddress, BRADBURY_FREELANCER_ADDRESS)) throw new Error("UNSUPPORTED_BRADBURY_FREELANCER");
  const escrowWei = positiveBigInt("SMOKE_ESCROW_WEI", EXACT_ESCROW_WEI, environment);
  if (escrowWei !== EXACT_ESCROW_WEI) throw new Error(`SMOKE_ESCROW_WEI must be exactly ${EXACT_ESCROW_WEI}`);
  const prefix = flow.toUpperCase();
  return {
    flow,
    chainId: BRADBURY_CHAIN_ID,
    contractAddress,
    clientAddress,
    freelancerAddress,
    escrowWei,
    deliverableUrl: validateDeliverableUrl(required(`SMOKE_${prefix}_DELIVERABLE_URL`, environment)),
    clientPrivateKey: required("SMOKE_BRADBURY_CLIENT_PRIVATE_KEY", environment),
    freelancerPrivateKey: required("SMOKE_BRADBURY_FREELANCER_PRIVATE_KEY", environment),
  };
}

export function verifyConfiguredAccount(runtimeConfig, role, createAccountFromKey = createAccount) {
  const definitions = {
    client: { key: runtimeConfig.clientPrivateKey, address: runtimeConfig.clientAddress, variable: "SMOKE_BRADBURY_CLIENT_PRIVATE_KEY" },
    freelancer: { key: runtimeConfig.freelancerPrivateKey, address: runtimeConfig.freelancerAddress, variable: "SMOKE_BRADBURY_FREELANCER_PRIVATE_KEY" },
  };
  const definition = definitions[role];
  if (!definition) throw new Error("ACCOUNT_ROLE_INVALID");
  let account;
  try {
    // genlayer-js@1.1.8 dist/index.js createAccount is a synchronous, logging-free
    // privateKeyToAccount wrapper. Never install process-global console interception here.
    account = requireSynchronousDependency(() => createAccountFromKey(definition.key));
  } catch {
    throw externalError("ACCOUNT_DERIVATION_FAILED", "create_account", { variable: definition.variable, role });
  }
  if (!sameAddress(account.address, definition.address)) {
    throw safeError("ACCOUNT_ADDRESS_MISMATCH", { variable: definition.variable, role });
  }
  return account;
}

export function verifyConfiguredAccounts(runtimeConfig, createAccountFromKey = createAccount) {
  const clientAccount = verifyConfiguredAccount(runtimeConfig, "client", createAccountFromKey);
  const freelancerAccount = verifyConfiguredAccount(runtimeConfig, "freelancer", createAccountFromKey);
  return { clientAccount, freelancerAccount };
}

export function createBradburyReadClient(createRpcClient = createBradburyRpcClient, options = {}) {
  try {
    return requireSynchronousDependency(() => createRpcClient(options));
  } catch (error) {
    if (safeSmokeErrors.has(error)) throw error;
    throw externalError("READ_CLIENT_CREATION_FAILED", "create_read_client");
  }
}

export function createBradburyWriterClient(account, createRpcClient = createBradburyRpcClient, options = {}) {
  try {
    return requireSynchronousDependency(() => createRpcClient({ ...options, account }));
  } catch (error) {
    if (safeSmokeErrors.has(error)) throw error;
    throw externalError("WRITE_CLIENT_CREATION_FAILED", "create_writer");
  }
}

export function createLiveBradburyWriterRpcOptions(options = {}) {
  if (!plainObject(options)) throw safeError("RPC_CLIENT_CONFIG_INVALID");
  return { ...options, gasEstimateMultiplier: LIVE_BRADBURY_GAS_ESTIMATE_MULTIPLIER };
}

export function publicRuntimeMetadata(runtimeConfig) {
  return {
    flow: runtimeConfig.flow,
    chain_id: runtimeConfig.chainId,
    contract_address: runtimeConfig.contractAddress,
    client_address: runtimeConfig.clientAddress,
    freelancer_address: runtimeConfig.freelancerAddress,
    escrow_wei: String(runtimeConfig.escrowWei),
    deliverable_url: runtimeConfig.deliverableUrl,
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sameAddress(left, right) {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

function validAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function canonicalTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function currentMilliseconds(now) {
  const value = now();
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("CURRENT_TIME_INVALID");
  return milliseconds;
}

function currentTimestamp(now) {
  return new Date(currentMilliseconds(now)).toISOString();
}

const BRADBURY_RPC_URL = testnetBradbury.rpcUrls.default.http[0];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BRADBURY_CONSENSUS_ADDRESS = testnetBradbury.consensusMainContract.address;
const MAX_GAS_ESTIMATE_MULTIPLIER = 4;
const LIVE_BRADBURY_GAS_ESTIMATE_MULTIPLIER = 2;
const NEW_TRANSACTION_TOPIC = keccak256(stringToHex("NewTransaction(bytes32,address,address)"));
const CREATED_TRANSACTION_TOPIC = keccak256(stringToHex("CreatedTransaction(bytes32,uint256)"));
const RPC_ERROR_CODES = Object.freeze({
  gen_call: "RPC_CONTRACT_VIEW",
  eth_getBalance: "RPC_BALANCE_READ",
  eth_call: "RPC_TRANSACTION_READ",
  gen_dbg_traceTransaction: "RPC_TRACE_READ",
  eth_getTransactionCount: "RPC_NONCE_READ",
  eth_estimateGas: "RPC_GAS_ESTIMATE",
  eth_gasPrice: "RPC_GAS_PRICE",
  eth_sendRawTransaction: "RPC_TRANSACTION_BROADCAST",
  eth_getTransactionReceipt: "RPC_TRANSACTION_RECEIPT",
});
const RPC_METHODS = new Set(Object.keys(RPC_ERROR_CODES));

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every((key) => typeof key === "string" &&
    Object.hasOwn(descriptors[key], "value") && descriptors[key].get === undefined && descriptors[key].set === undefined);
}

function exactObjectKeys(value, allowed, required = allowed) {
  return plainObject(value) && Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key));
}

function fixedRpcError(method, suffix) {
  return safeError(`${RPC_ERROR_CODES[method] ?? "RPC_REQUEST"}_${suffix}`);
}

function validBytes(value, { bytes, allowEmpty = true } = {}) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) return false;
  const length = (value.length - 2) / 2;
  return (allowEmpty || length > 0) && (bytes === undefined || length === bytes);
}

function validHash(value) {
  return validBytes(value, { bytes: 32, allowEmpty: false });
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function decodeRlpLength(bytes, offset, lengthOfLength, minimumLength) {
  if (lengthOfLength < 1 || lengthOfLength > 8 || offset + lengthOfLength > bytes.length || bytes[offset] === 0) {
    throw safeError("EVALUATOR_OUTPUT_RLP_INVALID");
  }
  let length = 0n;
  for (let index = 0; index < lengthOfLength; index += 1) length = (length << 8n) + BigInt(bytes[offset + index]);
  if (length < BigInt(minimumLength) || length > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw safeError("EVALUATOR_OUTPUT_RLP_INVALID");
  }
  return Number(length);
}

function decodeRlpHeader(bytes, offset) {
  if (offset >= bytes.length) throw safeError("EVALUATOR_OUTPUT_RLP_TRUNCATED");
  const prefix = bytes[offset];
  let kind;
  let payloadStart;
  let payloadLength;
  if (prefix <= 0x7f) {
    kind = "bytes";
    payloadStart = offset;
    payloadLength = 1;
  } else if (prefix <= 0xb7) {
    kind = "bytes";
    payloadStart = offset + 1;
    payloadLength = prefix - 0x80;
    if (payloadLength === 1 && payloadStart < bytes.length && bytes[payloadStart] <= 0x7f) {
      throw safeError("EVALUATOR_OUTPUT_RLP_NONCANONICAL");
    }
  } else if (prefix <= 0xbf) {
    kind = "bytes";
    const lengthOfLength = prefix - 0xb7;
    payloadStart = offset + 1 + lengthOfLength;
    payloadLength = decodeRlpLength(bytes, offset + 1, lengthOfLength, 56);
  } else if (prefix <= 0xf7) {
    kind = "list";
    payloadStart = offset + 1;
    payloadLength = prefix - 0xc0;
  } else {
    kind = "list";
    const lengthOfLength = prefix - 0xf7;
    payloadStart = offset + 1 + lengthOfLength;
    payloadLength = decodeRlpLength(bytes, offset + 1, lengthOfLength, 56);
  }
  const end = payloadStart + payloadLength;
  if (!Number.isSafeInteger(end) || end > bytes.length) throw safeError("EVALUATOR_OUTPUT_RLP_TRUNCATED");
  return { kind, payloadStart, payloadLength, end };
}

function decodeExactEqOutputsRlp(bytes) {
  const outer = decodeRlpHeader(bytes, 0);
  if (outer.kind !== "list" || outer.end !== bytes.length) throw safeError("EVALUATOR_OUTPUT_RLP_INVALID");
  const items = [];
  let offset = outer.payloadStart;
  while (offset < outer.end) {
    const item = decodeRlpHeader(bytes, offset);
    if (item.kind !== "bytes" || item.end > outer.end) throw safeError("EVALUATOR_OUTPUT_RLP_STRUCTURE_INVALID");
    items.push(bytes.slice(item.payloadStart, item.end));
    offset = item.end;
  }
  if (offset !== outer.end) throw safeError("EVALUATOR_OUTPUT_RLP_TRAILING_BYTES");
  if (items.length !== 2) throw safeError("EVALUATOR_OUTPUT_STRUCTURAL_SIBLINGS_INVALID");
  if (!sameBytes(items[1], EVALUATOR_PADDED_MARKER)) throw safeError("EVALUATOR_OUTPUT_PADDED_MARKER_INVALID");
  return items;
}

function decodeCanonicalUleb128(bytes, start) {
  let value = 0n;
  let shift = 0n;
  let index = start;
  for (; index < bytes.length && index - start < 10; index += 1) {
    const byte = bytes[index];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      if (index > start && byte === 0) throw safeError("EVALUATOR_OUTPUT_CALLDATA_NONCANONICAL");
      return { value, next: index + 1 };
    }
    shift += 7n;
  }
  throw safeError("EVALUATOR_OUTPUT_CALLDATA_TRUNCATED");
}

function decodeExactCalldataString(bytes) {
  const header = decodeCanonicalUleb128(bytes, 0);
  if ((header.value & 7n) !== 4n) throw safeError("EVALUATOR_OUTPUT_CALLDATA_TAG_INVALID");
  const byteLength = header.value >> 3n;
  if (byteLength > BigInt(Number.MAX_SAFE_INTEGER) || header.next + Number(byteLength) !== bytes.length) {
    throw safeError("EVALUATOR_OUTPUT_CALLDATA_FRAMING_INVALID");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(header.next));
  } catch {
    throw safeError("EVALUATOR_OUTPUT_UTF8_INVALID");
  }
}

function projectHashedText(value, code, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || [...value].length > MAX_EVALUATOR_TEXT_CODE_POINTS) {
    throw safeError(code);
  }
  assertUnicodeScalarString(value, code);
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > MAX_EVALUATOR_TEXT_UTF8_BYTES) throw safeError(code);
  return value.length === 0
    ? { present: false, byte_length: 0, sha256: null }
    : { present: true, byte_length: bytes.length, sha256: sha256Bytes(bytes) };
}

export function assertUnicodeScalarString(value, code = "UNICODE_SCALAR_INVALID") {
  if (typeof value !== "string") throw safeError(code);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) throw safeError(code);
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) throw safeError(code);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw safeError(code);
    }
  }
  return value;
}

function validateEvaluatorSchema(value) {
  const keys = ["approved", "evidence_summary", "reason", "score"];
  if (!exactObjectKeys(value, keys) || typeof value.approved !== "boolean" ||
      !Number.isSafeInteger(value.score) || value.score < 0 || value.score > 100 ||
      (value.approved && value.score < 70)) {
    throw safeError("EVALUATOR_OUTPUT_SCHEMA_INVALID");
  }
  return {
    approved: value.approved,
    score: value.score,
    reason: projectHashedText(value.reason, "EVALUATOR_REASON_INVALID"),
    evidence_summary: projectHashedText(value.evidence_summary, "EVALUATOR_EVIDENCE_SUMMARY_INVALID"),
  };
}

function rejectDuplicateEvaluatorKeys(jsonText) {
  const seen = new Set();
  const keyPattern = /"((?:\\.|[^"\\])*)"\s*:/g;
  for (const match of jsonText.matchAll(keyPattern)) {
    let key;
    try {
      key = JSON.parse(`"${match[1]}"`);
    } catch {
      throw safeError("EVALUATOR_OUTPUT_JSON_INVALID");
    }
    if (seen.has(key)) throw safeError("EVALUATOR_OUTPUT_JSON_DUPLICATE_KEY");
    seen.add(key);
  }
}

export function decodeBradburyEqBlocksOutputs(eqBlocksOutputs, transactionId) {
  if (!validTransactionHash(transactionId)) throw safeError("EVALUATOR_TRANSACTION_ID_INVALID");
  if (eqBlocksOutputs === null) throw safeError("EVALUATOR_OUTPUT_NULL");
  if (!validBytes(eqBlocksOutputs, { allowEmpty: false })) throw safeError("EVALUATOR_OUTPUT_BYTES_INVALID");
  const bytes = hexToBytes(eqBlocksOutputs);
  const items = decodeExactEqOutputsRlp(bytes);
  if (items[0].length < 2 || items[0][0] !== 0) throw safeError("EVALUATOR_OUTPUT_GENVM_RETURN_INVALID");
  const jsonText = decodeExactCalldataString(items[0].slice(1));
  let parsed;
  try {
    rejectDuplicateEvaluatorKeys(jsonText);
    parsed = JSON.parse(jsonText);
  } catch {
    throw safeError("EVALUATOR_OUTPUT_JSON_INVALID");
  }
  const evaluator = validateEvaluatorSchema(parsed);
  // Observed Bradbury layers are ABI bytes -> exact two-item RLP -> item 0's
  // successful GenVM return envelope -> one exactly consumed calldata string ->
  // evaluator JSON; item 1 must be the fixed "padded" marker. This fixed path
  // identifies the comparative output and rejects zero/multiple candidates or siblings.
  const evidence = {
    transaction_id: transactionId,
    eq_blocks_outputs_sha256: sha256Bytes(bytes),
    eq_blocks_outputs_byte_length: bytes.length,
    structural_selector: EVALUATOR_STRUCTURAL_SELECTOR,
    selected_output_index: 0,
    selected_output_identity: EVALUATOR_OUTPUT_IDENTITY,
    approved: evaluator.approved,
    score: evaluator.score,
    reason: evaluator.reason,
    evidence_summary: evaluator.evidence_summary,
  };
  EVALUATOR_RAW_OUTPUTS.set(evidence, eqBlocksOutputs.toLowerCase());
  return evidence;
}

function validSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validateHashedTextProjection(value, code, { required = true } = {}) {
  if (!exactObjectKeys(value, ["present", "byte_length", "sha256"]) || typeof value.present !== "boolean" ||
      !Number.isSafeInteger(value.byte_length) || value.byte_length < 0 || value.byte_length > MAX_EVALUATOR_TEXT_UTF8_BYTES ||
      (value.present ? value.byte_length === 0 || !validSha256(value.sha256) : required || value.byte_length !== 0 || value.sha256 !== null)) {
    throw safeError(code);
  }
  return value;
}

export function validateEvaluatorEvidence(value, transactionId, { requireSidecar = false } = {}) {
  const keys = ["transaction_id", "eq_blocks_outputs_sha256", "eq_blocks_outputs_byte_length", "structural_selector",
    "selected_output_index", "selected_output_identity", "approved", "score", "reason", "evidence_summary"];
  const sidecarKeys = ["sidecar_basename", "sidecar_sha256", "sidecar_byte_length"];
  const allowedKeys = requireSidecar ? [...keys, ...sidecarKeys] : keys;
  if (!exactObjectKeys(value, allowedKeys) || !validTransactionHash(value.transaction_id) ||
      (transactionId !== undefined && value.transaction_id.toLowerCase() !== transactionId.toLowerCase()) ||
      !validSha256(value.eq_blocks_outputs_sha256) || !Number.isSafeInteger(value.eq_blocks_outputs_byte_length) ||
      value.eq_blocks_outputs_byte_length <= 0 || value.structural_selector !== EVALUATOR_STRUCTURAL_SELECTOR ||
      value.selected_output_index !== 0 || value.selected_output_identity !== EVALUATOR_OUTPUT_IDENTITY ||
      typeof value.approved !== "boolean" || !Number.isSafeInteger(value.score) || value.score < 0 || value.score > 100 ||
      (value.approved && value.score < 70)) {
    throw safeError("EVALUATOR_EVIDENCE_INVALID");
  }
  if (!exactObjectKeys(value, allowedKeys, keys) || (requireSidecar &&
      (!validSidecarBasename(value.sidecar_basename) || !validSha256(value.sidecar_sha256) ||
       !Number.isSafeInteger(value.sidecar_byte_length) || value.sidecar_byte_length <= 0))) {
    throw safeError("EVALUATOR_EVIDENCE_INVALID");
  }
  validateHashedTextProjection(value.reason, "EVALUATOR_REASON_EVIDENCE_INVALID");
  validateHashedTextProjection(value.evidence_summary, "EVALUATOR_SUMMARY_EVIDENCE_INVALID");
  return value;
}

function validSidecarBasename(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && value === basename(value) &&
    value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\") && !value.includes("\0") &&
    /^[A-Za-z0-9._-]+$/.test(value);
}

function evaluatorSidecarBasename(journalBasename, outputDigest) {
  const value = `${journalBasename}.evaluator-${outputDigest}.bin`;
  if (!validSidecarBasename(value)) throw safeError("EVALUATOR_SIDECAR_BASENAME_INVALID");
  return value;
}

function rawEvaluatorHex(value) {
  const raw = value && typeof value === "object" ? EVALUATOR_RAW_OUTPUTS.get(value) : undefined;
  if (!validBytes(raw, { allowEmpty: false }) || raw !== raw.toLowerCase()) {
    throw safeError("EVALUATOR_RAW_EVIDENCE_MISSING");
  }
  return raw;
}

function prepareCompletedJournalSidecar(journal, journalBasename) {
  const rawHex = rawEvaluatorHex(journal?.state?.evaluator_evidence);
  const rawBytes = hexToBytes(rawHex);
  const digest = sha256Bytes(rawBytes);
  const basenameValue = evaluatorSidecarBasename(journalBasename, digest);
  const prepared = JSON.parse(JSON.stringify(journal));
  Object.assign(prepared.state.evaluator_evidence, {
    sidecar_basename: basenameValue,
    sidecar_sha256: digest,
    sidecar_byte_length: rawBytes.length,
  });
  return { journal: prepared, sidecar: { basename: basenameValue, hex: rawHex.slice(2), sha256: digest,
    byte_length: rawBytes.length } };
}

function validQuantity(value) {
  return typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value);
}

function validateRpcRequest(method, params, id) {
  if (!RPC_METHODS.has(method) || !Number.isSafeInteger(id) || id <= 0 || !Array.isArray(params)) {
    throw safeError("RPC_REQUEST_INVALID");
  }
  const address = (value) => validAddress(value);
  const transactionHash = (value) => validHash(value);
  let valid = false;
  if (method === "gen_call") {
    const value = params[0];
    valid = params.length === 1 && exactObjectKeys(value,
      ["type", "to", "from", "data", "transaction_hash_variant"]) && value.type === "read" &&
      address(value.to) && address(value.from) && validBytes(value.data, { allowEmpty: false }) && value.transaction_hash_variant === "latest-nonfinal";
  } else if (method === "eth_getBalance") {
    valid = params.length === 2 && address(params[0]) && params[1] === "latest";
  } else if (method === "eth_call") {
    valid = params.length === 2 && exactObjectKeys(params[0], ["to", "data"]) &&
      address(params[0].to) && validBytes(params[0].data, { allowEmpty: false }) && params[1] === "latest";
  } else if (method === "gen_dbg_traceTransaction") {
    valid = params.length === 1 && exactObjectKeys(params[0], ["txID", "round"]) &&
      transactionHash(params[0].txID) && Number.isSafeInteger(params[0].round) && params[0].round >= 0;
  } else if (method === "eth_getTransactionCount") {
    valid = params.length === 2 && address(params[0]) && params[1] === "pending";
  } else if (method === "eth_estimateGas") {
    valid = params.length === 1 && exactObjectKeys(params[0], ["from", "to", "data", "value"]) &&
      address(params[0].from) && address(params[0].to) && validBytes(params[0].data, { allowEmpty: false }) && validQuantity(params[0].value);
  } else if (method === "eth_gasPrice") {
    valid = params.length === 0;
  } else if (method === "eth_sendRawTransaction") {
    valid = params.length === 1 && validBytes(params[0], { allowEmpty: false });
  } else if (method === "eth_getTransactionReceipt") {
    valid = params.length === 1 && transactionHash(params[0]);
  }
  if (!valid) throw fixedRpcError(method, "REQUEST_INVALID");
}

function validateJsonValue(value, depth = 0) {
  if (depth > 8) return false;
  if (value === null || ["string", "boolean"].includes(typeof value)) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => validateJsonValue(entry, depth + 1));
  return plainObject(value) && Object.values(value).every((entry) => validateJsonValue(entry, depth + 1));
}

function optionalField(value, key, validator) {
  return !Object.hasOwn(value, key) || validator(value[key]);
}

function validateReceiptResult(value) {
  if (value === null) return value;
  const receiptKeys = ["blockHash", "blockNumber", "contractAddress", "cumulativeGasUsed", "effectiveGasPrice", "from",
    "gasUsed", "logs", "logsBloom", "root", "status", "to", "transactionHash", "transactionIndex", "type"];
  if (!exactObjectKeys(value, receiptKeys, ["status", "transactionHash", "from", "to", "logs"]) ||
      !validQuantity(value.status) || !validHash(value.transactionHash) || !validAddress(value.from) ||
      !(value.to === null || validAddress(value.to)) || !Array.isArray(value.logs) ||
      !optionalField(value, "blockHash", (entry) => entry === null || validHash(entry)) ||
      !optionalField(value, "blockNumber", (entry) => entry === null || validQuantity(entry)) ||
      !optionalField(value, "contractAddress", (entry) => entry === null) ||
      !optionalField(value, "cumulativeGasUsed", validQuantity) || !optionalField(value, "effectiveGasPrice", validQuantity) ||
      !optionalField(value, "gasUsed", validQuantity) || !optionalField(value, "logsBloom", (entry) => validBytes(entry, { bytes: 256 })) ||
      !optionalField(value, "root", validHash) || !optionalField(value, "transactionIndex", validQuantity) ||
      !optionalField(value, "type", validQuantity)) {
    throw fixedRpcError("eth_getTransactionReceipt", "RESULT_INVALID");
  }
  const logKeys = ["address", "blockHash", "blockNumber", "data", "logIndex", "removed", "topics",
    "transactionHash", "transactionIndex"];
  for (const log of value.logs) {
    if (!exactObjectKeys(log, logKeys, ["address", "data", "topics"]) || !validAddress(log.address) ||
        !validBytes(log.data) || !Array.isArray(log.topics) || log.topics.length === 0 || !log.topics.every(validHash) ||
        !optionalField(log, "blockHash", (entry) => entry === null || validHash(entry)) ||
        !optionalField(log, "blockNumber", (entry) => entry === null || validQuantity(entry)) ||
        !optionalField(log, "logIndex", (entry) => entry === null || validQuantity(entry)) ||
        !optionalField(log, "removed", (entry) => entry === false) ||
        !optionalField(log, "transactionHash", (entry) => entry === null || validHash(entry)) ||
        !optionalField(log, "transactionIndex", (entry) => entry === null || validQuantity(entry))) {
      throw fixedRpcError("eth_getTransactionReceipt", "RESULT_INVALID");
    }
  }
  return value;
}

const GEN_CALL_FULL_RESULT_KEYS = ["data", "eqOutputs", "events", "logs", "messages",
  "nondetDisagreementCallNo", "status", "stderr", "stdout", "syncedBlock"];
const GEN_CALL_LOG_REQUIRED_KEYS = ["file", "level", "message", "target", "ts"];
const GEN_CALL_LOG_KEY_SETS = [
  GEN_CALL_LOG_REQUIRED_KEYS,
  [...GEN_CALL_LOG_REQUIRED_KEYS, "version"],
  [...GEN_CALL_LOG_REQUIRED_KEYS, "genvm_id"],
  [...GEN_CALL_LOG_REQUIRED_KEYS, "metrics"],
];
const GEN_CALL_MAX_DATA_BYTES = 1024 * 1024;
const GEN_CALL_MAX_TEXT_LENGTH = 1024 * 1024;
const GEN_CALL_MAX_LOG_ENTRIES = 1024;

function boundedString(value, maximumLength, { allowEmpty = true } = {}) {
  return typeof value === "string" && value.length <= maximumLength && (allowEmpty || value.length > 0);
}

function exactGenCallObjectKeys(value, allowed, required = allowed) {
  if (!plainObject(value)) return false;
  const keys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(value));
  return keys.every((key) => typeof key === "string" && allowed.includes(key)) &&
    required.every((key) => keys.includes(key));
}

function boundedDataArray(value, maximumLength, validator) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximumLength) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
      Object.keys(descriptors).some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.get !== undefined || descriptor.set !== undefined ||
        !validator(descriptor.value)) return false;
  }
  return Object.keys(descriptors).length === value.length + 1;
}

function validGenCallData(value, { allowEmpty = false, maximumBytes = GEN_CALL_MAX_DATA_BYTES } = {}) {
  if (typeof value !== "string" || !/^(?:0x)?(?:[0-9a-fA-F]{2})*$/.test(value)) return false;
  const unprefixed = value.startsWith("0x") ? value.slice(2) : value;
  return (allowEmpty || unprefixed.length > 0) && unprefixed.length / 2 <= maximumBytes;
}

function validateGenCallStatus(value) {
  return exactGenCallObjectKeys(value, ["code", "message"]) && Number.isSafeInteger(value.code) &&
    boundedString(value.message, 65_536);
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateGenCallMetrics(value) {
  return exactGenCallObjectKeys(value, ["gvm", "llm", "web"]) && value.llm === null && value.web === null &&
    exactGenCallObjectKeys(value.gvm, ["host", "llm_module", "supervisor", "web_module"]) &&
    exactGenCallObjectKeys(value.gvm.host, ["time"]) && nonNegativeSafeInteger(value.gvm.host.time) &&
    exactGenCallObjectKeys(value.gvm.llm_module, ["calls", "time"]) &&
    nonNegativeSafeInteger(value.gvm.llm_module.calls) && nonNegativeSafeInteger(value.gvm.llm_module.time) &&
    exactGenCallObjectKeys(value.gvm.supervisor, ["compilation_time", "compiled_modules", "precompile_hits"]) &&
    nonNegativeSafeInteger(value.gvm.supervisor.compilation_time) &&
    nonNegativeSafeInteger(value.gvm.supervisor.compiled_modules) &&
    nonNegativeSafeInteger(value.gvm.supervisor.precompile_hits) &&
    exactGenCallObjectKeys(value.gvm.web_module, ["calls", "time"]) &&
    nonNegativeSafeInteger(value.gvm.web_module.calls) && nonNegativeSafeInteger(value.gvm.web_module.time);
}

function validateGenCallLog(value) {
  if (!GEN_CALL_LOG_KEY_SETS.some((keys) => exactGenCallObjectKeys(value, keys))) return false;
  return boundedString(value.file, 512, { allowEmpty: false }) &&
    typeof value.level === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value.level) &&
    boundedString(value.message, 65_536) && boundedString(value.target, 512, { allowEmpty: false }) &&
    typeof value.ts === "string" && /^\d{1,20}$/.test(value.ts) &&
    optionalField(value, "version", (entry) => boundedString(entry, 256, { allowEmpty: false })) &&
    optionalField(value, "genvm_id", (entry) => boundedString(entry, 256, { allowEmpty: false })) &&
    optionalField(value, "metrics", validateGenCallMetrics);
}

function validateFullGenCallResult(value) {
  return exactGenCallObjectKeys(value, GEN_CALL_FULL_RESULT_KEYS) && validGenCallData(value.data) &&
    boundedDataArray(value.eqOutputs, 0, () => false) &&
    boundedDataArray(value.events, 0, () => false) &&
    boundedDataArray(value.logs, GEN_CALL_MAX_LOG_ENTRIES, validateGenCallLog) &&
    boundedDataArray(value.messages, 0, () => false) && value.nondetDisagreementCallNo === null &&
    validateGenCallStatus(value.status) && boundedString(value.stderr, GEN_CALL_MAX_TEXT_LENGTH) &&
    boundedString(value.stdout, GEN_CALL_MAX_TEXT_LENGTH) && validQuantity(value.syncedBlock) && value.syncedBlock.length <= 66;
}

function validateGenCallResult(result) {
  const direct = validGenCallData(result);
  const minimalWrapper = exactGenCallObjectKeys(result, ["data", "status"]) && validGenCallData(result.data) &&
    validateGenCallStatus(result.status);
  if (!direct && !minimalWrapper && !validateFullGenCallResult(result)) {
    throw fixedRpcError("gen_call", "RESULT_INVALID");
  }
  return result;
}

function validateRpcResult(method, result) {
  if (method === "gen_call") {
    return validateGenCallResult(result);
  }
  if (new Set(["eth_getBalance", "eth_getTransactionCount", "eth_estimateGas", "eth_gasPrice"]).has(method)) {
    if (!validQuantity(result)) throw fixedRpcError(method, "RESULT_INVALID");
  } else if (new Set(["eth_call", "eth_sendRawTransaction"]).has(method)) {
    if (!(method === "eth_sendRawTransaction" ? validHash(result) : validBytes(result, { allowEmpty: false }))) {
      throw fixedRpcError(method, "RESULT_INVALID");
    }
  } else if (method === "gen_dbg_traceTransaction") {
    if (!exactObjectKeys(result, ["result_code"]) || !Number.isSafeInteger(result.result_code)) {
      throw fixedRpcError(method, "RESULT_INVALID");
    }
  } else if (method === "eth_getTransactionReceipt") {
    return validateReceiptResult(result);
  }
  return result;
}

export function validateJsonRpcResponse(value, requestId, method) {
  if (!RPC_METHODS.has(method) || !Number.isSafeInteger(requestId) || requestId <= 0 || !plainObject(value) ||
      value.jsonrpc !== "2.0" || value.id !== requestId) throw fixedRpcError(method, "ENVELOPE_INVALID");
  const hasResult = Object.hasOwn(value, "result");
  const hasError = Object.hasOwn(value, "error");
  if (hasResult === hasError) throw fixedRpcError(method, "ENVELOPE_INVALID");
  if (hasResult) {
    if (!exactObjectKeys(value, ["jsonrpc", "id", "result"])) throw fixedRpcError(method, "ENVELOPE_INVALID");
    return validateRpcResult(method, value.result);
  }
  if (!exactObjectKeys(value, ["jsonrpc", "id", "error"]) ||
      !exactObjectKeys(value.error, ["code", "message", "data"], ["code", "message"]) ||
      !Number.isSafeInteger(value.error.code) || typeof value.error.message !== "string" ||
      (Object.hasOwn(value.error, "data") && !validateJsonValue(value.error.data))) {
    throw fixedRpcError(method, "ENVELOPE_INVALID");
  }
  throw fixedRpcError(method, "RPC_ERROR");
}

function parseContractJson(value) {
  if (typeof value !== "string") throw safeError("CONTRACT_VIEW_RETURN_TYPE_INVALID");
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw safeError("CONTRACT_VIEW_JSON_INVALID");
  }
  if (!plainObject(parsed)) throw safeError("CONTRACT_VIEW_SCHEMA_INVALID");
  return parsed;
}

const PROFILE_RESPONSE_KEYS = ["address", "role", "name", "bio", "skills", "rate", "rate_type", "portfolio",
  "twitter", "github", "registered_at", "jobs_completed", "total_earned", "found"];
const JOB_RESPONSE_KEYS = ["job_id", "title", "description", "client", "client_name", "freelancer", "freelancer_name",
  "freelancer_rate", "freelancer_rate_type", "deadline", "status", "created_at", "funded_at", "submitted_at",
  "resolved_at", "deliverable_url", "ai_verdict", "ai_reasoning", "found", "escrow_balance"];

export function projectContractViewResult(functionName, parsed, { args = [], config } = {}) {
  if (!plainObject(parsed)) throw safeError("CONTRACT_VIEW_SCHEMA_INVALID");
  if (functionName === "get_profile") {
    if (parsed.found === false) {
      if (!exactObjectKeys(parsed, ["found", "address"]) || !validAddress(parsed.address) ||
          !sameAddress(parsed.address, args[0])) throw safeError("PROFILE_RESPONSE_INVALID");
      return { found: false, address: parsed.address };
    }
    if (!exactObjectKeys(parsed, PROFILE_RESPONSE_KEYS) || parsed.found !== true || !validAddress(parsed.address) ||
        !sameAddress(parsed.address, args[0]) || !new Set(["client", "freelancer"]).has(parsed.role) ||
        PROFILE_RESPONSE_KEYS.filter((key) => !new Set(["found"]).has(key)).some((key) => typeof parsed[key] !== "string") ||
        !nonNegativeDecimal(parsed.jobs_completed) || !nonNegativeDecimal(parsed.total_earned)) {
      throw safeError("PROFILE_RESPONSE_INVALID");
    }
    return { found: true, address: parsed.address, role: parsed.role,
      jobs_completed: parsed.jobs_completed, total_earned: parsed.total_earned };
  }
  if (functionName === "get_stats") {
    if (!exactObjectKeys(parsed, ["total_jobs", "total_paid", "total_freelancers"]) ||
        !nonNegativeDecimal(parsed.total_jobs) || !nonNegativeDecimal(parsed.total_paid) ||
        !nonNegativeDecimal(parsed.total_freelancers)) throw safeError("STATS_RESPONSE_INVALID");
    return { total_jobs: parsed.total_jobs, total_paid: parsed.total_paid };
  }
  if (functionName === "get_job") {
    if (parsed.found === false) {
      if (!exactObjectKeys(parsed, ["found", "job_id"]) || !isCanonicalPositiveJobId(parsed.job_id) ||
          parsed.job_id !== args[0]) throw safeError("JOB_RESPONSE_INVALID");
      return { found: false, job_id: parsed.job_id };
    }
    if (!config || !exactObjectKeys(parsed, JOB_RESPONSE_KEYS) || parsed.found !== true ||
        JOB_RESPONSE_KEYS.filter((key) => key !== "found").some((key) => typeof parsed[key] !== "string")) {
      throw safeError("JOB_RESPONSE_INVALID");
    }
    return projectJobEvidence({ found: true, job_id: parsed.job_id, title: parsed.title, description: parsed.description,
      client: parsed.client, freelancer: parsed.freelancer, status: parsed.status, escrow_balance: parsed.escrow_balance,
      deliverable_url: parsed.deliverable_url, ai_verdict: parsed.ai_verdict, ai_reasoning: parsed.ai_reasoning,
      resolved_at: parsed.resolved_at }, config);
  }
  throw safeError("CONTRACT_VIEW_METHOD_INVALID");
}

function transactionProjection(transaction, requestedHash) {
  const allowed = ["hash", "txId", "sender", "recipient", "functionName", "args", "txCalldata", "currentTimestamp",
    "status", "statusName", "resultName", "txExecutionResultName", "evaluatorEvidence"];
  const required = ["status", "statusName", "resultName", "txExecutionResultName"];
  if (!exactObjectKeys(transaction, allowed, required) ||
      !Number.isSafeInteger(transaction.status) || transactionsStatusNumberToName[String(transaction.status)] !== transaction.statusName ||
      !Object.values(TransactionResult).includes(transaction.resultName) ||
      !Object.values(ExecutionResult).includes(transaction.txExecutionResultName)) {
    throw safeError("TRANSACTION_RESPONSE_INVALID");
  }
  if ((Object.hasOwn(transaction, "sender") && !validAddress(transaction.sender)) ||
      (Object.hasOwn(transaction, "recipient") && !validAddress(transaction.recipient)) ||
      (Object.hasOwn(transaction, "functionName") &&
        (!new Set(["register", "create_job", "fund_job", "submit_work", "verify_and_release", "client_refund"])
          .has(transaction.functionName))) ||
      (Object.hasOwn(transaction, "args") &&
        (!Array.isArray(transaction.args) || !transaction.args.every((value) => typeof value === "string"))) ||
      (Object.hasOwn(transaction, "txCalldata") && !validBytes(transaction.txCalldata, { allowEmpty: false })) ||
      (Object.hasOwn(transaction, "currentTimestamp") && !nonNegativeDecimal(transaction.currentTimestamp)) ||
      (Object.hasOwn(transaction, "evaluatorEvidence") &&
        !validateEvaluatorEvidence(transaction.evaluatorEvidence, requestedHash ?? transaction.txId ?? transaction.hash))) {
    throw safeError("TRANSACTION_RESPONSE_INVALID");
  }
  const identities = ["hash", "txId"].filter((key) => Object.hasOwn(transaction, key));
  if (identities.length === 0) throw safeError("TRANSACTION_RESPONSE_IDENTITY_MISSING");
  for (const key of identities) {
    if (!validTransactionHash(transaction[key])) throw safeError("TRANSACTION_RESPONSE_IDENTITY_INVALID");
    if (requestedHash !== undefined && transaction[key].toLowerCase() !== requestedHash.toLowerCase()) {
      throw safeError("TRANSACTION_RESPONSE_IDENTITY_MISMATCH");
    }
  }
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(transaction, key)).map((key) => [key, transaction[key]]));
}

export function projectTransactionState(transaction, requestedHash) {
  if (requestedHash !== undefined && !validTransactionHash(requestedHash)) throw safeError("TRANSACTION_HASH_MALFORMED");
  return transactionProjection(transaction, requestedHash);
}

function normalizedGenCallData(result) {
  result = validateGenCallResult(result);
  if (plainObject(result)) {
    if (result.status.code !== 0) throw safeError("CONTRACT_VIEW_EXECUTION_FAILED");
    result = result.data;
  }
  return result.startsWith("0x") ? result : `0x${result}`;
}

function abiInteger(value) {
  return typeof value === "bigint" ? value >= 0n : Number.isSafeInteger(value) && value >= 0;
}

function abiIntegerArray(value) {
  return Array.isArray(value) && value.every(abiInteger);
}

function validateReadStateBlockRange(value) {
  return exactObjectKeys(value, ["activationBlock", "processingBlock", "proposalBlock"]) &&
    [value.activationBlock, value.processingBlock, value.proposalBlock].every(abiInteger);
}

const ROUND_DATA_KEYS = ["round", "leaderIndex", "votesCommitted", "votesRevealed", "appealBond", "rotationsLeft",
  "result", "roundValidators", "validatorVotes", "validatorVotesHash", "validatorResultHash"];

function validateRoundData(value) {
  return exactObjectKeys(value, ROUND_DATA_KEYS) &&
    ["round", "leaderIndex", "votesCommitted", "votesRevealed", "appealBond", "rotationsLeft", "result"]
      .every((key) => abiInteger(value[key])) &&
    Array.isArray(value.roundValidators) && value.roundValidators.every(validAddress) &&
    abiIntegerArray(value.validatorVotes) && Array.isArray(value.validatorVotesHash) && value.validatorVotesHash.every(validHash) &&
    Array.isArray(value.validatorResultHash) && value.validatorResultHash.every(validHash);
}

const MESSAGE_KEYS = ["messageType", "recipient", "value", "data", "onAcceptance", "saltNonce"];
function validateSubmittedMessage(value) {
  return exactObjectKeys(value, MESSAGE_KEYS) && abiInteger(value.messageType) && validAddress(value.recipient) &&
    abiInteger(value.value) && validBytes(value.data) && typeof value.onAcceptance === "boolean" && abiInteger(value.saltNonce);
}

const TRANSACTION_DATA_KEYS = ["currentTimestamp", "sender", "recipient", "initialRotations", "txSlot", "createdTimestamp",
  "lastVoteTimestamp", "randomSeed", "result", "txExecutionHash", "txCalldata", "eqBlocksOutputs", "messages", "queueType",
  "queuePosition", "activator", "lastLeader", "status", "txId", "readStateBlockRange", "numOfRounds", "lastRound",
  "consumedValidators"];
const TRANSACTION_ALL_KEYS = ["result", "txExecutionResult", "previousStatus", "status", "txOrigin", "sender", "recipient",
  "activator", "txSlot", "initialRotations", "numOfInitialValidators", "epoch", "id", "randomSeed", "txExecutionHash",
  "resultHash", "txCalldata", "eqBlocksOutputs", "readStateBlockRanges", "validUntil", "value", "lockedStorageUnitPrice",
  "storageFeeUsed"];

function validatePinnedTransactionData(value) {
  if (!exactObjectKeys(value, TRANSACTION_DATA_KEYS) ||
      !["currentTimestamp", "initialRotations", "txSlot", "createdTimestamp", "lastVoteTimestamp", "result", "queueType",
        "queuePosition", "status", "numOfRounds"].every((key) => abiInteger(value[key])) ||
      !["sender", "recipient", "activator", "lastLeader"].every((key) => validAddress(value[key])) ||
      !["randomSeed", "txExecutionHash", "txId"].every((key) => validHash(value[key])) ||
      !validBytes(value.txCalldata, { allowEmpty: false }) || !validBytes(value.eqBlocksOutputs) ||
      !Array.isArray(value.messages) || !value.messages.every(validateSubmittedMessage) ||
      !validateReadStateBlockRange(value.readStateBlockRange) || !validateRoundData(value.lastRound) ||
      !Array.isArray(value.consumedValidators) || !value.consumedValidators.every(validAddress)) {
    throw safeError("TRANSACTION_DATA_SCHEMA_INVALID");
  }
  return value;
}

function validatePinnedTransactionAllData(value, roundsData) {
  if (!exactObjectKeys(value, TRANSACTION_ALL_KEYS) ||
      !["result", "txExecutionResult", "previousStatus", "status", "txSlot", "initialRotations", "numOfInitialValidators",
        "epoch", "validUntil", "value", "lockedStorageUnitPrice", "storageFeeUsed"].every((key) => abiInteger(value[key])) ||
      !["txOrigin", "sender", "recipient", "activator"].every((key) => validAddress(value[key])) ||
      !["id", "randomSeed", "txExecutionHash", "resultHash"].every((key) => validHash(value[key])) ||
      !validBytes(value.txCalldata, { allowEmpty: false }) || !validBytes(value.eqBlocksOutputs) ||
      !Array.isArray(value.readStateBlockRanges) || !value.readStateBlockRanges.every(validateReadStateBlockRange) ||
      !Array.isArray(roundsData) || !roundsData.every(validateRoundData)) {
    throw safeError("TRANSACTION_ALL_DATA_SCHEMA_INVALID");
  }
  return value;
}

function decodeGenLayerTransactionRequest(txCalldata) {
  let serialized;
  let decoded;
  try {
    serialized = fromRlp(txCalldata);
    if (!Array.isArray(serialized) || serialized.length !== 2 || !validBytes(serialized[0], { allowEmpty: false }) ||
        serialized[1] !== "0x00") throw new Error("invalid transaction envelope");
    decoded = abi.calldata.decode(hexToBytes(serialized[0]));
  } catch {
    throw safeError("TRANSACTION_CALLDATA_DECODING_FAILED");
  }
  if (!(decoded instanceof Map) || !["method", "args"].every((key) => decoded.has(key)) ||
      [...decoded.keys()].some((key) => !new Set(["method", "args"]).has(key)) ||
      typeof decoded.get("method") !== "string" || !Array.isArray(decoded.get("args"))) {
    throw safeError("TRANSACTION_CALLDATA_SCHEMA_INVALID");
  }
  return { functionName: decoded.get("method"), args: decoded.get("args") };
}

export function projectPinnedTransactionResponse({ transactionData, transactionAllData, roundsData, requestedHash,
  requestedTimestamp, expectedRequest }) {
  if (!validTransactionHash(requestedHash) || !Number.isSafeInteger(requestedTimestamp) || requestedTimestamp < 0) {
    throw safeError("TRANSACTION_REQUEST_IDENTITY_INVALID");
  }
  const current = validatePinnedTransactionData(transactionData);
  const all = validatePinnedTransactionAllData(transactionAllData, roundsData);
  if (BigInt(current.currentTimestamp) !== BigInt(requestedTimestamp) ||
      current.txId.toLowerCase() !== requestedHash.toLowerCase() || all.id.toLowerCase() !== requestedHash.toLowerCase() ||
      !sameAddress(current.sender, all.sender) || !sameAddress(current.recipient, all.recipient) ||
      current.txCalldata.toLowerCase() !== all.txCalldata.toLowerCase() ||
      current.eqBlocksOutputs.toLowerCase() !== all.eqBlocksOutputs.toLowerCase()) {
    throw safeError("TRANSACTION_RESPONSE_IDENTITY_MISMATCH");
  }
  const decodedRequest = decodeGenLayerTransactionRequest(current.txCalldata);
  if (expectedRequest !== undefined) {
    if (!exactObjectKeys(expectedRequest, ["sender", "address", "functionName", "args", "value"]) ||
        !validAddress(expectedRequest.sender) || !validAddress(expectedRequest.address) ||
        typeof expectedRequest.functionName !== "string" || !Array.isArray(expectedRequest.args) ||
        typeof expectedRequest.value !== "bigint" || expectedRequest.value < 0n ||
        !sameAddress(current.sender, expectedRequest.sender) || !sameAddress(current.recipient, expectedRequest.address) ||
        decodedRequest.functionName !== expectedRequest.functionName || !equalData(decodedRequest.args, expectedRequest.args) ||
        BigInt(all.value) !== expectedRequest.value) {
      throw safeError("TRANSACTION_RESPONSE_REQUEST_MISMATCH");
    }
  }
  const status = Number(current.status);
  const resultName = transactionResultNumberToName[String(current.result)];
  const txExecutionResultName = executionResultNumberToName[String(all.txExecutionResult)];
  let evaluatorEvidence;
  if (decodedRequest.functionName === "verify_and_release" && current.eqBlocksOutputs !== "0x") {
    const currentEvidence = decodeBradburyEqBlocksOutputs(current.eqBlocksOutputs, requestedHash);
    const allEvidence = decodeBradburyEqBlocksOutputs(all.eqBlocksOutputs, requestedHash);
    if (!equalData(currentEvidence, allEvidence)) throw safeError("EVALUATOR_OUTPUT_SOURCE_MISMATCH");
    evaluatorEvidence = currentEvidence;
  }
  const projected = { hash: current.txId, txId: all.id, sender: current.sender, recipient: current.recipient,
    functionName: decodedRequest.functionName, args: decodedRequest.args, txCalldata: current.txCalldata,
    currentTimestamp: String(current.currentTimestamp), status, statusName: transactionsStatusNumberToName[String(status)],
    resultName, txExecutionResultName };
  if (evaluatorEvidence !== undefined) projected.evaluatorEvidence = evaluatorEvidence;
  return projectTransactionState(projected, requestedHash);
}

export function extractUniqueGenLayerTransactionId(logs, { evmHash, consensusAddress = BRADBURY_CONSENSUS_ADDRESS,
  expectedRecipient } = {}) {
  if (!Array.isArray(logs) || !validHash(evmHash) || !sameAddress(consensusAddress, BRADBURY_CONSENSUS_ADDRESS) ||
      !validAddress(expectedRecipient)) {
    throw safeError("WRITE_TRANSACTION_EVENT_CONTEXT_INVALID");
  }
  const recognized = [];
  for (const log of logs) {
    const topic = log.topics[0]?.toLowerCase();
    const eventName = topic === NEW_TRANSACTION_TOPIC.toLowerCase() ? "NewTransaction" :
      topic === CREATED_TRANSACTION_TOPIC.toLowerCase() ? "CreatedTransaction" : null;
    // Unknown topic signatures are unrelated receipt logs and are ignored. A log
    // with a recognized creation topic is always validated strictly and cannot be ignored.
    if (!eventName) continue;
    if (!sameAddress(log.address, consensusAddress) ||
        (log.transactionHash !== undefined && log.transactionHash !== null &&
          log.transactionHash.toLowerCase() !== evmHash.toLowerCase())) {
      throw safeError("WRITE_TRANSACTION_EVENT_BINDING_INVALID");
    }
    let decoded;
    try {
      decoded = decodeEventLog({ abi: testnetBradbury.consensusMainContract.abi, eventName,
        topics: log.topics, data: log.data, strict: true });
    } catch {
      throw safeError("WRITE_TRANSACTION_EVENT_DECODING_FAILED");
    }
    const txId = decoded.args?.txId;
    // Activator is validated consensus-event metadata and may differ from the EVM signer.
    if (!validTransactionHash(txId) ||
        (eventName === "NewTransaction" && (!validAddress(decoded.args?.recipient) || !validAddress(decoded.args?.activator) ||
          !sameAddress(decoded.args.recipient, expectedRecipient))) ||
        (eventName === "CreatedTransaction" && !abiInteger(decoded.args?.txSlot))) {
      throw safeError("WRITE_TRANSACTION_EVENT_DECODING_FAILED");
    }
    recognized.push(txId);
  }
  if (recognized.length !== 1) throw safeError("WRITE_TRANSACTION_EVENT_COUNT_INVALID");
  return recognized[0];
}

export function createBradburyRpcClient({ account, fetchFn = globalThis.fetch, endpoint = BRADBURY_RPC_URL,
  projectionConfig, receiptAttempts = 120, intervalMs = 5_000, sleepFn = sleep, now = Date.now,
  gasEstimateMultiplier = 1 } = {}) {
  if (typeof fetchFn !== "function" || typeof endpoint !== "string" || !endpoint ||
      !Number.isSafeInteger(receiptAttempts) || receiptAttempts <= 0 ||
      !Number.isSafeInteger(intervalMs) || intervalMs < 0 ||
      !Number.isSafeInteger(gasEstimateMultiplier) || gasEstimateMultiplier < 1 ||
      gasEstimateMultiplier > MAX_GAS_ESTIMATE_MULTIPLIER) {
    throw safeError("RPC_CLIENT_CONFIG_INVALID");
  }
  let nextRequestId = 1;
  const rpc = async (method, params) => {
    const id = nextRequestId;
    nextRequestId += 1;
    validateRpcRequest(method, params, id);
    let body;
    try {
      const response = await fetchFn(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
      if (!response || response.ok !== true || typeof response.text !== "function") {
        throw fixedRpcError(method, "HTTP_FAILED");
      }
      body = await response.text();
    } catch (error) {
      if (safeSmokeErrors.has(error)) throw error;
      throw fixedRpcError(method, "TRANSPORT_FAILED");
    }
    let envelope;
    try {
      envelope = JSON.parse(body);
    } catch {
      throw fixedRpcError(method, "MALFORMED_JSON");
    }
    return validateJsonRpcResponse(envelope, id, method);
  };

  const readContract = async ({ address, functionName, args = [] }) => {
    if (!sameAddress(address, BRADBURY_CONTRACT_ADDRESS) || !new Set(["get_profile", "get_stats", "get_job"]).has(functionName) ||
        !Array.isArray(args) || (functionName === "get_stats" ? args.length !== 0 : args.length !== 1) ||
        (functionName === "get_profile" && !validAddress(args[0])) ||
        (functionName === "get_job" && !isCanonicalPositiveJobId(args[0]))) throw safeError("CONTRACT_VIEW_REQUEST_INVALID");
    let data;
    try {
      data = abi.transactions.serialize([abi.calldata.encode(abi.calldata.makeCalldataObject(functionName, args)), false]);
    } catch {
      throw safeError("CONTRACT_VIEW_ENCODING_FAILED");
    }
    const result = await rpc("gen_call", [{ type: "read", to: address, from: account?.address ?? ZERO_ADDRESS,
      data, transaction_hash_variant: "latest-nonfinal" }]);
    let decoded;
    try {
      decoded = abi.calldata.decode(hexToBytes(normalizedGenCallData(result)));
    } catch {
      throw safeError("CONTRACT_VIEW_DECODING_FAILED");
    }
    const parsed = parseContractJson(decoded);
    return projectContractViewResult(functionName, parsed, { args, config: projectionConfig });
  };

  const getTransaction = async ({ hash, expectedRequest }) => {
    if (!validTransactionHash(hash)) throw safeError("TRANSACTION_HASH_MALFORMED");
    const contract = testnetBradbury.consensusDataContract;
    const timestamp = Math.round(currentMilliseconds(now) / 1_000);
    let currentData;
    let allData;
    try {
      currentData = encodeFunctionData({ abi: contract.abi, functionName: "getTransactionData", args: [hash, timestamp] });
      allData = encodeFunctionData({ abi: contract.abi, functionName: "getTransactionAllData", args: [hash] });
    } catch {
      throw safeError("TRANSACTION_REQUEST_ENCODING_FAILED");
    }
    const [encodedCurrent, encodedAll] = await Promise.all([
      rpc("eth_call", [{ to: contract.address, data: currentData }, "latest"]),
      rpc("eth_call", [{ to: contract.address, data: allData }, "latest"]),
    ]);
    let transactionData;
    let transactionAllData;
    let roundsData;
    try {
      transactionData = decodeFunctionResult({ abi: contract.abi, functionName: "getTransactionData", data: encodedCurrent });
      [transactionAllData, roundsData] = decodeFunctionResult({ abi: contract.abi, functionName: "getTransactionAllData", data: encodedAll });
    } catch {
      throw safeError("TRANSACTION_RESPONSE_DECODING_FAILED");
    }
    return projectPinnedTransactionResponse({ transactionData, transactionAllData, roundsData, requestedHash: hash,
      requestedTimestamp: timestamp, expectedRequest });
  };

  const debugTraceTransaction = async ({ hash, round = 0 }) => {
    if (!validTransactionHash(hash)) throw safeError("TRANSACTION_HASH_MALFORMED");
    return rpc("gen_dbg_traceTransaction", [{ txID: hash, round }]);
  };

  const getBalance = async ({ address }) => {
    if (!validAddress(address)) throw safeError("BALANCE_REQUEST_INVALID");
    const result = await rpc("eth_getBalance", [address, "latest"]);
    return BigInt(result);
  };

  const writeContract = async (request, { beforeRawBroadcast } = {}) => {
    if (!account || !validAddress(account.address) || typeof account.signTransaction !== "function") {
      throw safeError("WRITE_ACCOUNT_INVALID");
    }
    if (!request || !sameAddress(request.address, BRADBURY_CONTRACT_ADDRESS) ||
        !new Set(["register", "create_job", "fund_job", "submit_work", "verify_and_release", "client_refund"]).has(request.functionName) ||
        !Array.isArray(request.args) || typeof request.value !== "bigint" || request.value < 0n) {
      throw safeError("WRITE_REQUEST_INVALID");
    }
    let contractData;
    let consensusData;
    try {
      contractData = abi.transactions.serialize([
        abi.calldata.encode(abi.calldata.makeCalldataObject(request.functionName, request.args)), false,
      ]);
      const consensus = testnetBradbury.consensusMainContract;
      const validUntil = BigInt(Math.floor(currentMilliseconds(now) / 1_000) + 3_600);
      consensusData = encodeFunctionData({ abi: consensus.abi, functionName: "addTransaction",
        args: [account.address, request.address, BigInt(testnetBradbury.defaultNumberOfInitialValidators),
          BigInt(testnetBradbury.defaultConsensusMaxRotations), contractData, validUntil] });
    } catch {
      throw safeError("WRITE_REQUEST_ENCODING_FAILED");
    }
    const consensusAddress = BRADBURY_CONSENSUS_ADDRESS;
    const value = `0x${request.value.toString(16)}`;
    const nonce = BigInt(await rpc("eth_getTransactionCount", [account.address, "pending"]));
    const estimatedGas = BigInt(await rpc("eth_estimateGas", [
      { from: account.address, to: consensusAddress, data: consensusData, value },
    ]));
    const gas = estimatedGas * BigInt(gasEstimateMultiplier);
    const gasPrice = BigInt(await rpc("eth_gasPrice", []));
    let serializedTransaction;
    try {
      serializedTransaction = await account.signTransaction({ to: consensusAddress, data: consensusData, value: request.value, gas, gasPrice,
        nonce, chainId: BRADBURY_CHAIN_ID, type: "legacy" });
    } catch {
      throw safeError("WRITE_TRANSACTION_SIGNING_FAILED");
    }
    if (!validBytes(serializedTransaction, { allowEmpty: false })) throw safeError("WRITE_TRANSACTION_SIGNING_RESULT_INVALID");
    const localEvmHash = keccak256(serializedTransaction);
    try {
      const parsed = parseTransaction(serializedTransaction);
      const recovered = await recoverTransactionAddress({ serializedTransaction });
      if (parsed.type !== "legacy" || parsed.chainId !== BRADBURY_CHAIN_ID || parsed.nonce !== Number(nonce) ||
          parsed.gas !== gas || parsed.gasPrice !== gasPrice || (parsed.value ?? 0n) !== request.value ||
          !sameAddress(parsed.to, consensusAddress) || parsed.data?.toLowerCase() !== consensusData.toLowerCase() ||
          !sameAddress(recovered, account.address)) throw new Error("signed transaction mismatch");
    } catch {
      throw safeError("WRITE_TRANSACTION_SIGNING_RESULT_INVALID");
    }
    if (beforeRawBroadcast !== undefined && typeof beforeRawBroadcast !== "function") {
      throw safeError("BEFORE_RAW_BROADCAST_GUARD_INVALID");
    }
    let broadcastPromise;
    if (beforeRawBroadcast !== undefined) {
      const guardResult = beforeRawBroadcast();
      if (guardResult && typeof guardResult.then === "function") {
        Promise.resolve(guardResult).catch(() => {});
        throw safeError("BEFORE_RAW_BROADCAST_GUARD_MUST_BE_SYNCHRONOUS");
      }
    }
    // Calling rpc starts fetchFn synchronously before the returned promise is awaited.
    // Nothing asynchronous occurs between the guard above and this transport start.
    broadcastPromise = rpc("eth_sendRawTransaction", [serializedTransaction]);
    const rpcEvmHash = await broadcastPromise;
    if (rpcEvmHash.toLowerCase() !== localEvmHash.toLowerCase()) throw safeError("WRITE_TRANSACTION_HASH_MISMATCH");
    let receipt = null;
    for (let attempt = 1; attempt <= receiptAttempts; attempt += 1) {
      receipt = await rpc("eth_getTransactionReceipt", [localEvmHash]);
      if (receipt !== null) break;
      if (attempt < receiptAttempts) await sleepFn(intervalMs);
    }
    if (receipt === null) throw safeError("WRITE_TRANSACTION_RECEIPT_TIMEOUT");
    if (receipt.transactionHash.toLowerCase() !== localEvmHash.toLowerCase() || BigInt(receipt.status) !== 1n ||
        !sameAddress(receipt.from, account.address) || !sameAddress(receipt.to, consensusAddress)) {
      throw safeError("WRITE_TRANSACTION_RECEIPT_INVALID");
    }
    for (const log of receipt.logs) {
      if (log.transactionHash !== undefined && log.transactionHash !== null &&
          log.transactionHash.toLowerCase() !== localEvmHash.toLowerCase()) {
        throw safeError("WRITE_TRANSACTION_RECEIPT_INVALID");
      }
    }
    return extractUniqueGenLayerTransactionId(receipt.logs, { evmHash: localEvmHash, consensusAddress,
      expectedRecipient: request.address });
  };

  return Object.freeze({ rpc, readContract, getBalance, getTransaction, debugTraceTransaction, writeContract });
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
  if (latest.step.status === "INTENT_RECORDED" && !latest.step.hash) throw new Error("AMBIGUOUS_BROADCAST_MANUAL_INVESTIGATION_REQUIRED");
  if (!authorizedHash) throw new Error("VERIFY_RETRY_REQUIRED");
  if (!validTransactionHash(latest.step.hash) || !validTransactionHash(authorizedHash)) throw new Error("VERIFY_RETRY_HASH_MALFORMED");
  if (authorizedHash !== latest.step.hash) throw new Error("VERIFY_RETRY_HASH_MISMATCH");
  return latest;
}

export function assertRetryJobPreconditions({ journal, job, config, jobId, escrowWei, now = () => new Date() }) {
  jobId = requireCanonicalPositiveJobId(jobId, "VERIFY_RETRY_JOB_ID_INVALID");
  assertPreVerificationSnapshots({ journal, config, jobId, escrowWei, now });
  if (job?.found !== true) throw new Error("VERIFY_RETRY_JOB_NOT_FOUND");
  if (job.job_id !== jobId) throw new Error("VERIFY_RETRY_JOB_ID_MISMATCH");
  if (!jobIdentityMatches(job, config)) throw new Error("VERIFY_RETRY_JOB_IDENTITY_MISMATCH");
  if (job.deliverable_url !== config.deliverable_url) throw new Error("VERIFY_RETRY_DELIVERABLE_URL_MISMATCH");
  if (job.status !== "SUBMITTED") throw new Error("VERIFY_RETRY_STATUS_MISMATCH");
  if (BigInt(job.escrow_balance) !== escrowWei) throw new Error("VERIFY_RETRY_ESCROW_MISMATCH");
  if (job.ai_verdict !== "") throw new Error("VERIFY_RETRY_VERDICT_NOT_EMPTY");
  if (job.ai_reasoning.present !== false) throw new Error("VERIFY_RETRY_REASONING_NOT_EMPTY");
  if (journal.steps.client_refund) throw new Error("VERIFY_RETRY_REFUND_STEP_PRESENT");
  if (verificationAttempts(journal).some(({ step }) => isStrictSuccessEvidence(step))) throw new Error("VERIFY_ALREADY_SUCCESSFUL");
  return job;
}

function nonNegativeDecimal(value) {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
}

export function isCanonicalPositiveJobId(value) {
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}

function requireCanonicalPositiveJobId(value, code = "JOB_ID_INVALID") {
  if (!isCanonicalPositiveJobId(value)) throw new Error(code);
  return value;
}

function requireDecimal(value, code) {
  if (!nonNegativeDecimal(value)) throw new Error(code);
  return BigInt(value);
}

export function projectFreelancerProfile(profile, expectedAddress) {
  if (!exactObjectKeys(profile, ["found", "address", "role", "jobs_completed", "total_earned"]) ||
      profile.found !== true || !validAddress(profile.address) || !sameAddress(profile.address, expectedAddress) ||
      profile.role !== "freelancer") throw new Error("FREELANCER_PROFILE_IDENTITY_INVALID");
  requireDecimal(profile.jobs_completed, "FREELANCER_PROFILE_ACCOUNTING_INVALID");
  requireDecimal(profile.total_earned, "FREELANCER_PROFILE_ACCOUNTING_INVALID");
  return {
    found: true,
    address: profile.address,
    role: "freelancer",
    jobs_completed: profile.jobs_completed,
    total_earned: profile.total_earned,
  };
}

export function assertRegistrationProfile(profile, expectedRole, expectedAddress) {
  if (!new Set(["client", "freelancer"]).has(expectedRole) || !validAddress(expectedAddress)) {
    throw safeError("REGISTRATION_EXPECTATION_INVALID");
  }
  if (profile?.found === false) return false;
  if (!exactObjectKeys(profile, ["found", "address", "role", "jobs_completed", "total_earned"]) ||
      profile.found !== true || !sameAddress(profile.address, expectedAddress) || profile.role !== expectedRole) {
    throw safeError("REGISTRATION_ROLE_MISMATCH");
  }
  return true;
}

export function projectAccountingStats(stats, { includeTotalJobs = false } = {}) {
  if (!exactObjectKeys(stats, ["total_paid", "total_jobs"], ["total_paid"])) throw new Error("STATS_INVALID");
  requireDecimal(stats.total_paid, "STATS_TOTAL_PAID_INVALID");
  const projected = { total_paid: stats.total_paid };
  if (includeTotalJobs) {
    requireDecimal(stats.total_jobs, "STATS_TOTAL_JOBS_INVALID");
    projected.total_jobs = stats.total_jobs;
  }
  return projected;
}

export function projectJobEvidence(job, config) {
  const projectedKeys = ["found", "job_id", "title", "description", "client", "freelancer", "status", "escrow_balance",
    "deliverable_url", "ai_verdict", "ai_reasoning"];
  const rawKeys = [...projectedKeys, "resolved_at"];
  const raw = exactObjectKeys(job, rawKeys);
  if ((!raw && !exactObjectKeys(job, projectedKeys)) || job.found !== true || !isCanonicalPositiveJobId(job.job_id) ||
      typeof job.title !== "string" || typeof job.description !== "string" ||
      !validAddress(job.client) || !validAddress(job.freelancer) ||
      !sameAddress(job.client, config.client_address) || !sameAddress(job.freelancer, config.freelancer_address) ||
      !new Set(["OPEN", "FUNDED", "SUBMITTED", "PAID", "DISPUTED"]).has(job.status) ||
      typeof job.deliverable_url !== "string" || typeof job.ai_verdict !== "string" ||
      (raw && (typeof job.ai_reasoning !== "string" || typeof job.resolved_at !== "string"))) {
    throw new Error("JOB_EVIDENCE_INVALID");
  }
  requireDecimal(job.escrow_balance, "JOB_EVIDENCE_ESCROW_INVALID");
  const aiReasoning = raw
    ? projectHashedText(job.ai_reasoning, "JOB_AI_REASONING_INVALID", { allowEmpty: true })
    : validateHashedTextProjection(job.ai_reasoning, "JOB_AI_REASONING_EVIDENCE_INVALID", { required: false });
  const projected = {
    found: true,
    job_id: job.job_id,
    title: job.title,
    description: job.description,
    client: job.client,
    freelancer: job.freelancer,
    status: job.status,
    escrow_balance: job.escrow_balance,
    deliverable_url: job.deliverable_url,
    ai_verdict: job.ai_verdict,
    ai_reasoning: aiReasoning,
  };
  if (!jobIdentityMatches(projected, config)) throw new Error("JOB_EVIDENCE_IDENTITY_INVALID");
  return projected;
}

export function assertPreVerificationSnapshots({ journal, config = journal?.config, jobId = journal?.state?.job_id,
  escrowWei, now = () => new Date(), enforceFreshness = true }) {
  jobId = requireCanonicalPositiveJobId(jobId, "PRE_VERIFICATION_JOB_ID_INVALID");
  const state = journal?.state;
  const context = state?.before_verification_context;
  const job = state?.before_verification_job;
  const stats = state?.before_verification_stats;
  const profile = state?.before_verification_freelancer_profile;
  const balance = state?.before_verification_freelancer_balance;
  const snapshotStartedAt = state?.before_verification_snapshot_started_at;
  if (!context || !job || !stats || !profile || balance === undefined || snapshotStartedAt === undefined) {
    throw new Error("PRE_VERIFICATION_SNAPSHOTS_MISSING");
  }
  if (!canonicalTimestamp(snapshotStartedAt)) throw safeError("PRE_VERIFICATION_SNAPSHOT_TIMESTAMP_MALFORMED");
  if (enforceFreshness) {
    const age = currentMilliseconds(now) - Date.parse(snapshotStartedAt);
    if (age < 0) throw safeError("PRE_VERIFICATION_SNAPSHOT_TIMESTAMP_FUTURE");
    if (age > MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS) throw safeError("PRE_VERIFICATION_SNAPSHOT_STALE_MANUAL_INVESTIGATION_REQUIRED");
  }
  if (!isCanonicalPositiveJobId(context.job_id) || context.run_id !== config?.run_id || context.job_id !== jobId ||
      !sameAddress(context.contract_address, config?.contract_address) ||
      !sameAddress(context.client_address, config?.client_address) ||
      !sameAddress(context.freelancer_address, config?.freelancer_address) ||
      context.deliverable_url !== config?.deliverable_url ||
      context.escrow_wei !== String(escrowWei)) {
    throw new Error("PRE_VERIFICATION_SNAPSHOT_CONTEXT_MISMATCH");
  }
  if (!exactKeys(context, ["run_id", "job_id", "contract_address", "client_address", "freelancer_address", "deliverable_url", "escrow_wei"])) {
    throw new Error("PRE_VERIFICATION_SNAPSHOT_CONTEXT_FIELDS_INVALID");
  }
  if (!equalData(job, projectJobEvidence(job, config))) throw new Error("PRE_VERIFICATION_JOB_SNAPSHOT_FIELDS_INVALID");
  if (!jobIdentityMatches(job, config) || job.job_id !== jobId ||
      job.deliverable_url !== config.deliverable_url || job.status !== "SUBMITTED" ||
      requireDecimal(job.escrow_balance, "PRE_VERIFICATION_JOB_ESCROW_INVALID") !== escrowWei ||
      job.ai_verdict !== "" || job.ai_reasoning.present !== false) {
    throw new Error("PRE_VERIFICATION_JOB_SNAPSHOT_MISMATCH");
  }
  if (!equalData(stats, projectAccountingStats(stats))) throw new Error("PRE_VERIFICATION_STATS_INVALID");
  if (profile.found !== true || profile.role !== "freelancer" ||
      !sameAddress(profile.address, config.freelancer_address)) {
    throw new Error("PRE_VERIFICATION_PROFILE_IDENTITY_MISMATCH");
  }
  if (!equalData(profile, projectFreelancerProfile(profile, config.freelancer_address))) {
    throw new Error("PRE_VERIFICATION_PROFILE_ACCOUNTING_INVALID");
  }
  requireDecimal(balance, "FREELANCER_BALANCE_BASELINE_INVALID");
  return { context, job, stats, profile, balance };
}

export async function recordPreVerificationSnapshots({ journal, job, escrowWei, readStats, readProfile, readBalance, save,
  now = () => new Date() }) {
  const state = journal.state;
  const snapshotKeys = ["before_verification_context", "before_verification_job", "before_verification_stats",
    "before_verification_freelancer_profile", "before_verification_freelancer_balance", "before_verification_snapshot_started_at"];
  if (snapshotKeys.some((key) => state[key] !== undefined)) {
    return assertPreVerificationSnapshots({ journal, escrowWei, now });
  }
  const config = journal.config;
  const jobId = requireCanonicalPositiveJobId(state.job_id, "PRE_VERIFICATION_JOB_ID_INVALID");
  const projectedJob = projectJobEvidence(job, config);
  if (projectedJob.job_id !== jobId || projectedJob.status !== "SUBMITTED" ||
      projectedJob.deliverable_url !== config.deliverable_url ||
      requireDecimal(projectedJob.escrow_balance, "PRE_VERIFICATION_JOB_ESCROW_INVALID") !== escrowWei ||
      projectedJob.ai_verdict !== "" || projectedJob.ai_reasoning.present !== false) {
    throw new Error("PRE_VERIFICATION_JOB_SNAPSHOT_MISMATCH");
  }
  const snapshotStartedAt = currentTimestamp(now);
  let stats;
  let profile;
  let balance;
  try {
    stats = projectAccountingStats(await readStats());
    profile = projectFreelancerProfile(await readProfile(), config.freelancer_address);
    balance = String(await readBalance());
  } catch {
    throw externalError("PRE_VERIFICATION_SNAPSHOT_READ_FAILED", "read_accounting_baseline", { job_id: jobId });
  }
  const snapshot = {
    before_verification_context: {
    run_id: config.run_id, job_id: jobId, contract_address: config.contract_address,
      client_address: config.client_address, freelancer_address: config.freelancer_address,
      deliverable_url: config.deliverable_url, escrow_wei: String(escrowWei),
    },
    before_verification_job: projectedJob,
    before_verification_stats: stats,
    before_verification_freelancer_profile: profile,
    before_verification_freelancer_balance: balance,
    before_verification_snapshot_started_at: snapshotStartedAt,
  };
  const completedAt = currentMilliseconds(now);
  const collectionAge = completedAt - Date.parse(snapshotStartedAt);
  if (collectionAge < 0) throw safeError("PRE_VERIFICATION_SNAPSHOT_TIMESTAMP_FUTURE");
  if (collectionAge > MAX_PRE_VERIFICATION_SNAPSHOT_AGE_MS) {
    throw safeError("PRE_VERIFICATION_SNAPSHOT_STALE_MANUAL_INVESTIGATION_REQUIRED");
  }
  Object.assign(state, snapshot);
  const snapshots = assertPreVerificationSnapshots({ journal, escrowWei, now: () => completedAt });
  try {
    await save(journal);
  } catch {
    for (const key of snapshotKeys) delete state[key];
    throw externalError("PRE_VERIFICATION_SNAPSHOT_SAVE_FAILED", "atomic_journal_save");
  }
  return snapshots;
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
  assertPreVerificationSnapshots({ journal, escrowWei, now });
  let transaction;
  try {
    transaction = projectTransactionState(await getTransaction(latest.step.hash), latest.step.hash);
  } catch {
    throw externalError("VERIFY_RETRY_RECEIPT_RPC_FAILED", "get_transaction", { hash: latest.step.hash });
  }
  const execution = exactReceiptTuple(transaction);
  const classification = classifyTransaction(transaction);
  if (classification.kind === "PENDING") throw new Error("VERIFY_RETRY_PREVIOUS_PENDING");
  if (classification.kind === "SUCCESS") throw new Error("VERIFY_RETRY_PREVIOUS_SUCCESSFUL");
  if (classification.kind !== "FAILURE") throw new Error("VERIFY_RETRY_PREVIOUS_NOT_TERMINAL_FAILURE");
  const jobId = requireCanonicalPositiveJobId(journal.state?.job_id, "VERIFY_RETRY_JOB_ID_INVALID");
  let job;
  try {
    job = await readJob(jobId);
  } catch {
    throw externalError("VERIFY_RETRY_JOB_RPC_FAILED", "read_job", { job_id: jobId });
  }
  job = projectJobEvidence(job, journal.config);
  assertRetryJobPreconditions({ journal, job, config: journal.config, jobId, escrowWei, now });
  latest.step.status = "TERMINAL_FAILURE_CONFIRMED";
  latest.step.execution = execution;
  latest.step.terminal_failure_confirmed_at = currentTimestamp(now);
  await save(journal);
  return { previous: latest, job, jobId, stepName: nextVerifyRetryStepName(journal) };
}

export async function executeVerifyRetry({ journal, authorizedHash, getTransaction, readJob, save, escrowWei,
  loadClientAccount, createWriter, wait, now }) {
  const prepared = await prepareVerifyRetry({ journal, authorizedHash, getTransaction, readJob, save, escrowWei, now });
  assertPreVerificationSnapshots({ journal, escrowWei, now: now ?? (() => new Date()) });
  let account;
  try {
    account = requireSynchronousDependency(() => loadClientAccount());
  } catch {
    throw externalError("ACCOUNT_DERIVATION_FAILED", "load_account", { variable: "SMOKE_BRADBURY_CLIENT_PRIVATE_KEY", role: "client" });
  }
  if (!sameAddress(account.address, journal.config.client_address)) throw new Error("CLIENT_ACCOUNT_ADDRESS_MISMATCH");
  let writer;
  try {
    writer = requireSynchronousDependency(() => createWriter(account));
  } catch {
    throw externalError("WRITE_CLIENT_CREATION_FAILED", "create_writer", { role: "client" });
  }
  await submitStep({ journal, stepName: prepared.stepName, client: writer, sender: journal.config.client_address, save, wait, request: {
    address: journal.config.contract_address, functionName: "verify_and_release", args: [prepared.jobId], value: 0n,
  }, beforeRawBroadcast: () => assertPreVerificationSnapshots({ journal, escrowWei, now: now ?? (() => new Date()) }) });
  journal.state.verify_success_step = prepared.stepName;
  await save(journal);
  return prepared.stepName;
}

export function formatVerificationAttempts(journal) {
  if (!new Set(["ACTIVE", "COMPLETED"]).has(journal?.status)) throw new Error("JOURNAL_STATUS_INVALID");
  validateJournalSteps(journal);
  return verificationAttempts(journal).map(({ name, step }) => {
    return {
      step_name: name,
      hash: step.hash ?? null,
      journal_status: step.status,
      status_name: step.execution?.status_name ?? null,
      result_name: step.execution?.result_name ?? null,
      execution_result_name: step.execution?.execution_result_name ?? null,
    };
  });
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
  const args = request.args ?? [];
  if (new Set(["fund_job", "submit_work", "verify_and_release", "client_refund"]).has(request.functionName)) {
    requireCanonicalPositiveJobId(args[0], "REQUEST_JOB_ID_INVALID");
  }
  return {
    sender,
    address: request.address,
    functionName: request.functionName,
    args,
    value: String(request.value ?? 0n),
  };
}

function exactKeys(value, allowed) {
  return exactObjectKeys(value, allowed);
}

const TRANSACTION_STEP_STATUSES = new Set(["INTENT_RECORDED", "HASH_RECORDED", "EXECUTION_CONFIRMED", "TERMINAL_FAILURE_CONFIRMED"]);

function expectedStepDefinition(name, journal) {
  const config = journal.config;
  if (name === "register_client" || name === "register_freelancer") {
    const role = name.slice("register_".length);
    return { functionName: "register", sender: config[`${role}_address`], value: "0", args: [role, `Smoke ${role}`,
      "Bradbury escrow smoke-test account", "testing", "0", "fixed", "", "", ""] };
  }
  if (name === "create_job") return { functionName: "create_job", sender: config.client_address,
    value: "0", args: [config.job_title, config.job_description, config.freelancer_address, "2099-12-31"] };
  const jobId = requireCanonicalPositiveJobId(journal.state?.job_id, "JOURNAL_JOB_ID_INVALID");
  if (name === "fund_job") return { functionName: "fund_job", sender: config.client_address,
    value: config.escrow_wei, args: [jobId] };
  if (name === "submit_work") return { functionName: "submit_work", sender: config.freelancer_address,
    value: "0", args: [jobId, config.deliverable_url] };
  if (name === "verify_and_release" || VERIFY_RETRY_PATTERN.test(name)) {
    return { functionName: "verify_and_release", sender: config.client_address, value: "0", args: [jobId] };
  }
  if (name === "client_refund") return { functionName: "client_refund", sender: config.client_address, value: "0", args: [jobId] };
  throw new Error("JOURNAL_STEP_NAME_INVALID");
}

function validateStoredStep(name, step, journal) {
  const definition = expectedStepDefinition(name, journal);
  if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error("JOURNAL_STEP_INVALID");
  if (step.status === "PRE_EXISTING") {
    if (!name.startsWith("register_") || !exactKeys(step, ["status", "address", "role", "recorded_at"]) ||
        step.role !== name.slice("register_".length) || !sameAddress(step.address, definition.sender) ||
        !canonicalTimestamp(step.recorded_at)) throw new Error("JOURNAL_PRE_EXISTING_STEP_INVALID");
    return;
  }
  if (!TRANSACTION_STEP_STATUSES.has(step.status)) throw new Error("JOURNAL_STEP_STATUS_INVALID");
  const allowed = ["status", "request", "created_at"];
  if (step.status !== "INTENT_RECORDED") allowed.push("hash", "hash_recorded_at");
  if (step.execution !== undefined) allowed.push("execution");
  if (step.execution_confirmed_at !== undefined) allowed.push("execution_confirmed_at");
  if (step.terminal_failure_confirmed_at !== undefined) allowed.push("terminal_failure_confirmed_at");
  if (!exactKeys(step, allowed) || !canonicalTimestamp(step.created_at)) throw new Error("JOURNAL_STEP_FIELDS_INVALID");
  if (step.status === "INTENT_RECORDED") {
    if (step.hash !== undefined || step.hash_recorded_at !== undefined) throw new Error("JOURNAL_INTENT_HASH_INVALID");
  } else if (!validTransactionHash(step.hash) || !canonicalTimestamp(step.hash_recorded_at)) {
    throw new Error("JOURNAL_STEP_HASH_INVALID");
  }
  if (!exactKeys(step.request, ["sender", "address", "functionName", "args", "value"]) ||
      !sameAddress(step.request.sender, definition.sender) || !sameAddress(step.request.address, journal.config.contract_address) ||
      step.request.functionName !== definition.functionName || !equalData(step.request.args, definition.args) ||
      !nonNegativeDecimal(step.request.value) || step.request.value !== definition.value) throw new Error("JOURNAL_STEP_REQUEST_INVALID");
  if (step.execution !== undefined) {
    if (!exactKeys(step.execution, ["status_name", "result_name", "execution_result_name"]) ||
        !Object.values(TransactionStatus).includes(step.execution.status_name) ||
        !Object.values(TransactionResult).includes(step.execution.result_name) ||
        !Object.values(ExecutionResult).includes(step.execution.execution_result_name)) {
      throw new Error("JOURNAL_STEP_EXECUTION_INVALID");
    }
  }
  if (step.execution_confirmed_at !== undefined && !canonicalTimestamp(step.execution_confirmed_at)) {
    throw new Error("JOURNAL_STEP_EXECUTION_TIMESTAMP_INVALID");
  }
  if (step.terminal_failure_confirmed_at !== undefined && !canonicalTimestamp(step.terminal_failure_confirmed_at)) {
    throw new Error("JOURNAL_STEP_FAILURE_TIMESTAMP_INVALID");
  }
  if (step.status === "EXECUTION_CONFIRMED" && (step.execution === undefined || step.execution_confirmed_at === undefined)) {
    throw new Error("JOURNAL_STEP_EXECUTION_EVIDENCE_MISSING");
  }
  if (step.status === "TERMINAL_FAILURE_CONFIRMED" && (step.execution === undefined || step.terminal_failure_confirmed_at === undefined)) {
    throw new Error("JOURNAL_STEP_FAILURE_EVIDENCE_MISSING");
  }
}

function validateClosedStoredEvidence(journal) {
  const state = journal.state;
  if (!plainObject(state)) throw new Error("JOURNAL_STATE_INVALID");
  const allowedStateKeys = new Set(["before_stats", "before_freelancer_profile", "before_job_count", "job_id", "funded_job",
    "before_verification_context", "before_verification_job", "before_verification_stats",
    "before_verification_freelancer_profile", "before_verification_freelancer_balance", "before_verification_snapshot_started_at",
    "verify_success_step", "final_job", "after_stats", "after_freelancer_profile", "verify_finalization",
    "evaluator_evidence", "after_finalization_freelancer_balance"]);
  if (Object.keys(state).some((key) => !allowedStateKeys.has(key))) throw new Error("JOURNAL_STATE_FIELD_INVALID");
  const config = journal.config;
  const exactProjection = (stored, projected, code) => {
    if (!equalData(stored, projected)) throw new Error(code);
  };
  if (state.before_stats !== undefined) exactProjection(state.before_stats,
    projectAccountingStats(state.before_stats, { includeTotalJobs: true }), "JOURNAL_BEFORE_STATS_INVALID");
  if (state.before_freelancer_profile !== undefined) exactProjection(state.before_freelancer_profile,
    projectFreelancerProfile(state.before_freelancer_profile, config.freelancer_address), "JOURNAL_BEFORE_PROFILE_INVALID");
  if (state.before_verification_stats !== undefined) exactProjection(state.before_verification_stats,
    projectAccountingStats(state.before_verification_stats), "JOURNAL_VERIFICATION_STATS_INVALID");
  if (state.before_verification_freelancer_profile !== undefined) exactProjection(state.before_verification_freelancer_profile,
    projectFreelancerProfile(state.before_verification_freelancer_profile, config.freelancer_address), "JOURNAL_VERIFICATION_PROFILE_INVALID");
  for (const key of ["before_verification_job", "funded_job", "final_job"]) {
    if (state[key] !== undefined) exactProjection(state[key], projectJobEvidence(state[key], config), `JOURNAL_${key.toUpperCase()}_INVALID`);
  }
  if (state.funded_job !== undefined && (state.funded_job.job_id !== state.job_id || state.funded_job.status !== "FUNDED" ||
      state.funded_job.escrow_balance !== config.escrow_wei || state.funded_job.deliverable_url !== "" ||
      state.funded_job.ai_verdict !== "" || state.funded_job.ai_reasoning.present !== false)) {
    throw new Error("JOURNAL_FUNDED_JOB_SEMANTICS_INVALID");
  }
  if (state.after_stats !== undefined) exactProjection(state.after_stats,
    projectAccountingStats(state.after_stats), "JOURNAL_AFTER_STATS_INVALID");
  if (state.after_freelancer_profile !== undefined) exactProjection(state.after_freelancer_profile,
    projectFreelancerProfile(state.after_freelancer_profile, config.freelancer_address), "JOURNAL_AFTER_PROFILE_INVALID");
  if (state.before_verification_context !== undefined && !exactKeys(state.before_verification_context,
    ["run_id", "job_id", "contract_address", "client_address", "freelancer_address", "deliverable_url", "escrow_wei"])) {
    throw new Error("JOURNAL_VERIFICATION_CONTEXT_INVALID");
  }
  for (const key of ["before_job_count", "job_id", "before_verification_freelancer_balance", "after_finalization_freelancer_balance"]) {
    if (state[key] !== undefined) {
      if (key === "job_id") requireCanonicalPositiveJobId(state[key], "JOURNAL_JOB_ID_INVALID");
      else requireDecimal(state[key], `JOURNAL_${key.toUpperCase()}_INVALID`);
    }
  }
  if (state.before_verification_snapshot_started_at !== undefined && !canonicalTimestamp(state.before_verification_snapshot_started_at)) {
    throw new Error("JOURNAL_VERIFICATION_TIMESTAMP_INVALID");
  }
  const snapshotKeys = ["before_verification_context", "before_verification_job", "before_verification_stats",
    "before_verification_freelancer_profile", "before_verification_freelancer_balance", "before_verification_snapshot_started_at"];
  if (snapshotKeys.some((key) => state[key] !== undefined)) {
    assertPreVerificationSnapshots({ journal, escrowWei: BigInt(config.escrow_wei), enforceFreshness: false });
  }
  if (state.verify_success_step !== undefined) selectVerifySuccessStep(journal);
  if (state.verify_finalization !== undefined && (!exactKeys(state.verify_finalization,
    ["transaction_hash", "status_code", "status_name", "result_name", "execution_result_name",
      "eq_blocks_outputs_sha256", "eq_blocks_outputs_byte_length", "structural_selector", "selected_output_index",
      "selected_output_identity"]) ||
    !validTransactionHash(state.verify_finalization.transaction_hash) || state.verify_finalization.status_code !== 7 ||
    state.verify_finalization.status_name !== TransactionStatus.FINALIZED ||
    !SUCCESS_RESULTS.has(state.verify_finalization.result_name) ||
    state.verify_finalization.execution_result_name !== ExecutionResult.FINISHED_WITH_RETURN ||
    !validSha256(state.verify_finalization.eq_blocks_outputs_sha256) ||
    !Number.isSafeInteger(state.verify_finalization.eq_blocks_outputs_byte_length) ||
    state.verify_finalization.eq_blocks_outputs_byte_length <= 0 ||
    state.verify_finalization.structural_selector !== EVALUATOR_STRUCTURAL_SELECTOR ||
    state.verify_finalization.selected_output_index !== 0 ||
    state.verify_finalization.selected_output_identity !== EVALUATOR_OUTPUT_IDENTITY)) {
    throw new Error("JOURNAL_FINALIZATION_INVALID");
  }
  if (state.evaluator_evidence !== undefined) {
    validateEvaluatorEvidence(state.evaluator_evidence, state.verify_finalization?.transaction_hash,
      { requireSidecar: journal.status === "COMPLETED" });
  }
  if (journal.status === "ACTIVE" && ["final_job", "after_stats", "after_freelancer_profile", "verify_finalization",
    "evaluator_evidence", "after_finalization_freelancer_balance"].some((key) => state[key] !== undefined)) {
    throw new Error("JOURNAL_ACTIVE_FINAL_EVIDENCE_INVALID");
  }
}

function validateCompletedJournalEvidence(journal, { rawHex, journalBasename } = {}) {
  const state = journal.state;
  const requiredState = ["job_id", "funded_job", "before_verification_context", "before_verification_job",
    "before_verification_stats", "before_verification_freelancer_profile", "before_verification_freelancer_balance",
    "before_verification_snapshot_started_at", "verify_success_step", "final_job", "after_stats", "after_freelancer_profile",
    "verify_finalization", "evaluator_evidence", "after_finalization_freelancer_balance"];
  if (requiredState.some((key) => state[key] === undefined)) throw new Error("JOURNAL_COMPLETED_EVIDENCE_MISSING");
  for (const name of ["register_client", "register_freelancer", "create_job", "fund_job", "submit_work"]) {
    const step = journal.steps[name];
    const accepted = step?.status === "PRE_EXISTING" && name.startsWith("register_");
    if (!accepted && !isStrictSuccessEvidence(step)) throw new Error("JOURNAL_COMPLETED_WORKFLOW_EVIDENCE_INVALID");
  }
  if (journal.steps.client_refund !== undefined) throw new Error("JOURNAL_COMPLETED_REFUND_STEP_INVALID");
  const verification = selectVerifySuccessStep(journal);
  const finalization = state.verify_finalization;
  const evaluator = validateEvaluatorEvidence(state.evaluator_evidence, verification.step.hash, { requireSidecar: true });
  if (!validBytes(rawHex, { allowEmpty: false }) || rawHex !== rawHex.toLowerCase()) {
    throw new Error("JOURNAL_EVALUATOR_SIDECAR_REQUIRED");
  }
  const rawBytes = hexToBytes(rawHex);
  const sidecarDigest = sha256Bytes(rawBytes);
  if (rawBytes.length !== evaluator.sidecar_byte_length || sidecarDigest !== evaluator.sidecar_sha256 ||
      evaluator.eq_blocks_outputs_sha256 !== evaluator.sidecar_sha256 ||
      evaluator.eq_blocks_outputs_byte_length !== evaluator.sidecar_byte_length ||
      (journalBasename !== undefined && evaluator.sidecar_basename !==
        evaluatorSidecarBasename(journalBasename, evaluator.eq_blocks_outputs_sha256))) {
    throw new Error("JOURNAL_EVALUATOR_SIDECAR_BINDING_INVALID");
  }
  const recomputed = decodeBradburyEqBlocksOutputs(rawHex, verification.step.hash);
  const expectedRecomputed = Object.fromEntries(Object.entries(evaluator).filter(([key]) =>
    !new Set(["sidecar_basename", "sidecar_sha256", "sidecar_byte_length"]).has(key)));
  if (!equalData(recomputed, expectedRecomputed)) throw new Error("JOURNAL_EVALUATOR_PROVENANCE_INVALID");
  if (finalization.transaction_hash.toLowerCase() !== verification.step.hash.toLowerCase() ||
      finalization.result_name !== verification.step.execution.result_name ||
      finalization.execution_result_name !== verification.step.execution.execution_result_name ||
      finalization.eq_blocks_outputs_sha256 !== evaluator.eq_blocks_outputs_sha256 ||
      finalization.eq_blocks_outputs_byte_length !== evaluator.eq_blocks_outputs_byte_length ||
      finalization.structural_selector !== evaluator.structural_selector ||
      finalization.selected_output_index !== evaluator.selected_output_index ||
      finalization.selected_output_identity !== evaluator.selected_output_identity) {
    throw new Error("JOURNAL_FINALIZATION_BINDING_INVALID");
  }
  if ((journal.config.flow === "approval" && (!evaluator.approved || state.final_job.status !== "PAID" ||
      state.final_job.ai_verdict !== "APPROVED")) ||
      (journal.config.flow === "rejection" && (evaluator.approved || state.final_job.status !== "DISPUTED" ||
      state.final_job.ai_verdict !== "REJECTED"))) throw new Error("JOURNAL_EVALUATOR_OUTCOME_MISMATCH");
  const accounting = {
    journal,
    config: journal.config,
    jobId: state.job_id,
    job: state.final_job,
    escrowWei: BigInt(journal.config.escrow_wei),
    afterStats: state.after_stats,
    afterProfile: state.after_freelancer_profile,
    evaluatorEvidence: recomputed,
    afterFreelancerBalance: state.after_finalization_freelancer_balance,
    verificationFinalization: {
      hash: finalization.transaction_hash,
      status: finalization.status_code,
      statusName: finalization.status_name,
      resultName: finalization.result_name,
      txExecutionResultName: finalization.execution_result_name,
      evaluatorEvidence: recomputed,
    },
  };
  if (journal.config.flow === "approval") assertApprovalAccounting(accounting);
  else assertRejectionAccounting(accounting);
}

function validateJournalSteps(journal) {
  if (!plainObject(journal.steps)) throw new Error("JOURNAL_INVALID: steps object is missing");
  for (const [name, step] of Object.entries(journal.steps)) validateStoredStep(name, step, journal);
}

function validateJournalSchema(journal, expectedConfig, { allowCompleted = false, rawEvaluatorHex: suppliedRawHex,
  journalBasename } = {}) {
  const requiredTopLevel = ["schema_version", "status", "config", "created_at", "steps", "state"];
  const allowedTopLevel = [...requiredTopLevel, "completed_at"];
  if (!plainObject(journal) || Object.keys(journal).some((key) => !allowedTopLevel.includes(key)) ||
      requiredTopLevel.some((key) => !(key in journal)) || !canonicalTimestamp(journal.created_at) ||
      (journal.completed_at !== undefined && !canonicalTimestamp(journal.completed_at))) throw new Error("JOURNAL_FIELDS_INVALID");
  if (journal.schema_version !== JOURNAL_SCHEMA_VERSION) {
    throw new Error("JOURNAL_SCHEMA_MISMATCH");
  }
  const configKeys = ["flow", "chain_id", "contract_address", "client_address", "freelancer_address", "escrow_wei",
    "deliverable_url", "run_id", "job_title", "job_description"];
  if (!exactKeys(journal.config, configKeys) || !new Set(["approval", "rejection"]).has(journal.config.flow) ||
      journal.config.chain_id !== BRADBURY_CHAIN_ID || !validAddress(journal.config.contract_address) ||
      !validAddress(journal.config.client_address) || !validAddress(journal.config.freelancer_address) ||
      !sameAddress(journal.config.contract_address, BRADBURY_CONTRACT_ADDRESS) ||
      !sameAddress(journal.config.client_address, BRADBURY_CLIENT_ADDRESS) ||
      !sameAddress(journal.config.freelancer_address, BRADBURY_FREELANCER_ADDRESS) ||
      journal.config.escrow_wei !== String(EXACT_ESCROW_WEI) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(journal.config.run_id)) {
    throw new Error("JOURNAL_CONFIG_FIELDS_INVALID");
  }
  validateJobFields(journal.config?.job_title, journal.config?.job_description);
  validateDeliverableUrl(journal.config?.deliverable_url);
  if (!new Set(["ACTIVE", "COMPLETED"]).has(journal.status)) throw new Error("JOURNAL_STATUS_INVALID");
  if (journal.status === "COMPLETED" && !allowCompleted) {
    throw new Error("JOURNAL_COMPLETED_MANUAL_ARCHIVE_REQUIRED");
  }
  if ((journal.status === "COMPLETED") !== (journal.completed_at !== undefined)) throw new Error("JOURNAL_COMPLETION_FIELDS_INVALID");
  if (!equalData(journal.config, expectedConfig)) {
    throw new Error("JOURNAL_CONFIG_MISMATCH: stored immutable configuration differs from the current configuration");
  }
  validateJournalSteps(journal);
  validateClosedStoredEvidence(journal);
  if (journal.status === "COMPLETED") {
    const rawHex = suppliedRawHex ?? (journal.state?.evaluator_evidence &&
      EVALUATOR_RAW_OUTPUTS.get(journal.state.evaluator_evidence));
    validateCompletedJournalEvidence(journal, { rawHex, journalBasename });
  }
  return journal;
}

export function validateJournal(journal, expectedConfig) {
  return validateJournalSchema(journal, expectedConfig);
}

export function validateJournalForPersistence(journal, options = {}) {
  return validateJournalSchema(journal, journal?.config, { allowCompleted: true, ...options });
}

export function validateStoredCompletedJournal(journal, rawHex, journalBasename) {
  return validateJournalSchema(journal, journal?.config,
    { allowCompleted: true, rawEvaluatorHex: rawHex, journalBasename });
}

function journalLockPath(path) {
  return `${path}.lock`;
}

function assertHeldJournalLock(lock, path) {
  if (!lock || lock.active !== true || lock.journalPath !== path) throw safeError("JOURNAL_LOCK_REQUIRED");
}

async function verifyHeldJournalLock(lock, path) {
  assertHeldJournalLock(lock, path);
  await lock.verifyOwnership();
  return lock;
}

const JOURNAL_HELPER_PATH = fileURLToPath(new URL("./journal-io-helper.mjs", import.meta.url));
const JOURNAL_HELPER_STAGES = ["after_transaction_record", "after_backup_creation", "after_sidecar_rename",
  "after_journal_rename", "after_prepared_notification", "after_commit_acknowledged"];

async function startJournalIoHelper({ visibleParent, canonicalParent, journalBasename, parentIdentity,
  timeoutMs = 5_000, spawnProcess = spawn }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw safeError("JOURNAL_HELPER_TIMEOUT_INVALID");
  let child;
  try {
    child = spawnProcess(process.execPath, [JOURNAL_HELPER_PATH, visibleParent, canonicalParent, journalBasename,
      `${journalBasename}.lock`, String(parentIdentity.dev), String(parentIdentity.ino)], {
      cwd: canonicalParent, stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  } catch {
    throw safeError("JOURNAL_HELPER_START_FAILED");
  }
  let nextRequestId = 1;
  let closed = false;
  let expectedLockIdentity;
  const pending = new Map();
  let resolveExit;
  const exited = new Promise((resolveExited) => { resolveExit = resolveExited; });
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const rejectAll = (code) => {
    if (closed) return;
    closed = true;
    readyReject(safeError(code));
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(safeError(code));
    }
    pending.clear();
  };
  child.on("message", (message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      rejectAll("JOURNAL_HELPER_IPC_INVALID");
      child.kill();
      return;
    }
    if (message.type === "ready") {
      readyResolve(true);
      return;
    }
    if (message.type === "startup_failed") {
      rejectAll("JOURNAL_HELPER_START_FAILED");
      return;
    }
    const request = pending.get(message.request_id);
    if (!request) {
      rejectAll("JOURNAL_HELPER_IPC_INVALID");
      child.kill();
      return;
    }
    if (message.type === "prepared_after_rename") {
      if (request.type !== "save" || message.transaction_id !== request.transactionId ||
          message.helper_pid !== child.pid || String(message.parent_dev) !== String(parentIdentity.dev) ||
          String(message.parent_ino) !== String(parentIdentity.ino) || !expectedLockIdentity ||
          String(message.lock_dev) !== String(expectedLockIdentity.dev) ||
          String(message.lock_ino) !== String(expectedLockIdentity.ino)) {
        rejectAll("JOURNAL_HELPER_IPC_INVALID");
        child.kill();
        return;
      }
      request.prepared = true;
      if (!request.pauseStages.includes("after_prepared_notification")) {
        child.send({ type: "commit", request_id: message.request_id, transaction_id: message.transaction_id });
      }
      return;
    }
    if (message.type === "stage" && JOURNAL_HELPER_STAGES.includes(message.stage) && request.pauseStages.includes(message.stage)) {
      Promise.resolve().then(() => request.onStage(message.stage)).then(
        () => {
          if (!child.connected) return;
          child.send({ type: "continue", request_id: message.request_id, stage: message.stage });
          if (message.stage === "after_prepared_notification") {
            if (!request.prepared) {
              rejectAll("JOURNAL_HELPER_IPC_INVALID");
              child.kill();
              return;
            }
            child.send({ type: "commit", request_id: message.request_id, transaction_id: request.transactionId });
          }
        },
        () => child.connected && child.send({ type: "abort", request_id: message.request_id, stage: message.stage }),
      );
      return;
    }
    if (message.type !== "response" || typeof message.ok !== "boolean") {
      rejectAll("JOURNAL_HELPER_IPC_INVALID");
      child.kill();
      return;
    }
    pending.delete(message.request_id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.result);
    else request.reject(safeError(typeof message.code === "string" && /^[A-Z0-9_]+$/.test(message.code)
      ? message.code : "JOURNAL_HELPER_OPERATION_FAILED"));
  });
  child.on("error", () => rejectAll("JOURNAL_HELPER_PROCESS_FAILED"));
  child.on("exit", (code, signal) => {
    resolveExit({ code, signal });
    rejectAll("JOURNAL_HELPER_PROCESS_FAILED");
  });
  const readyTimer = setTimeout(() => {
    rejectAll("JOURNAL_HELPER_TIMEOUT");
    child.kill();
  }, timeoutMs);
  await ready.finally(() => clearTimeout(readyTimer));

  const command = (type, payload = {}, { pauseStages = [], onStage = async () => {} } = {}) => new Promise((resolveCommand, rejectCommand) => {
    if (closed || !child.connected || !["acquire", "adopt", "verify", "recover", "recover_bound", "read", "read_sidecar",
      "save", "release"].includes(type) ||
        !pauseStages.every((stage) => JOURNAL_HELPER_STAGES.includes(stage))) {
      rejectCommand(safeError("JOURNAL_HELPER_IPC_INVALID"));
      return;
    }
    const requestId = nextRequestId;
    nextRequestId += 1;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      rejectCommand(safeError("JOURNAL_HELPER_TIMEOUT"));
      child.kill();
    }, timeoutMs);
    pending.set(requestId, { type, transactionId: payload.transaction_id, resolve: resolveCommand, reject: rejectCommand,
      timer, pauseStages, onStage, prepared: false });
    try {
      child.send({ type, request_id: requestId, ...payload, pause_stages: pauseStages });
    } catch {
      clearTimeout(timer);
      pending.delete(requestId);
      rejectCommand(safeError("JOURNAL_HELPER_IPC_FAILED"));
      child.kill();
    }
  });
  return {
    command,
    setLockIdentity(identity) {
      expectedLockIdentity = identity;
    },
    get closed() {
      return closed;
    },
    terminate(signal = "SIGTERM") {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      return exited;
    },
    disconnect() {
      if (!closed && child.connected) child.disconnect();
    },
    sendMalformed() {
      if (!closed && child.connected) child.send("malformed");
    },
    async stop() {
      closed = true;
      if (child.connected) child.disconnect();
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}

export async function acquireJournalLock(path, { now = () => new Date(), pid = process.pid, helperTimeoutMs = 5_000,
  spawnProcess = spawn } = {}) {
  if (typeof path !== "string" || !path || !Number.isSafeInteger(pid) || pid <= 0) throw safeError("JOURNAL_LOCK_CONFIG_INVALID");
  const suppliedBasename = basename(path);
  if (!suppliedBasename || suppliedBasename === "." || suppliedBasename === ".." || path.includes("\0")) {
    throw safeError("JOURNAL_BASENAME_INVALID");
  }
  const absoluteJournalPath = resolve(path);
  const visibleParent = dirname(absoluteJournalPath);
  const journalBasename = basename(absoluteJournalPath);
  if (!journalBasename || journalBasename === "." || journalBasename === ".." || journalBasename.includes("/") ||
      journalBasename.includes("\\") || journalBasename.length > 200) throw safeError("JOURNAL_BASENAME_INVALID");
  let canonicalParent;
  let parentIdentity;
  try {
    const visibleIdentity = await lstat(visibleParent);
    if (!visibleIdentity.isDirectory() || visibleIdentity.isSymbolicLink()) throw new Error("parent invalid");
    canonicalParent = await realpath(visibleParent);
    parentIdentity = await stat(canonicalParent);
    if (!parentIdentity.isDirectory()) throw new Error("parent is not canonical");
  } catch {
    throw safeError("JOURNAL_LOCK_PARENT_INVALID");
  }
  let helper = await startJournalIoHelper({ visibleParent, canonicalParent, journalBasename, parentIdentity,
    timeoutMs: helperTimeoutMs, spawnProcess });
  const metadata = { pid, instance_id: randomUUID(), created_at: currentTimestamp(now) };
  let lockIdentity;
  let parentLockHandle;
  try {
    lockIdentity = await helper.command("acquire", { metadata });
    helper.setLockIdentity(lockIdentity);
    parentLockHandle = await open(join(canonicalParent, `${journalBasename}.lock`),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const heldIdentity = await parentLockHandle.stat();
    const heldMetadata = JSON.parse(await parentLockHandle.readFile("utf8"));
    if (!heldIdentity.isFile() || (heldIdentity.mode & 0o777) !== 0o600 ||
        String(heldIdentity.dev) !== String(lockIdentity.dev) || String(heldIdentity.ino) !== String(lockIdentity.ino) ||
        !equalData(heldMetadata, metadata)) throw new Error("parent lock binding invalid");
    await helper.command("recover");
  } catch (error) {
    await parentLockHandle?.close().catch(() => {});
    await helper.stop();
    if (safeSmokeErrors.has(error)) throw error;
    throw safeError("JOURNAL_LOCK_ACQUIRE_FAILED");
  }
  const canonicalJournalPath = join(canonicalParent, journalBasename);
  const verifyParentLock = async () => {
    if (!parentLockHandle) throw safeError("JOURNAL_LOCK_OWNERSHIP_INVALID");
    const descriptor = await parentLockHandle.stat();
    const linked = await lstat(`${canonicalJournalPath}.lock`);
    if (!descriptor.isFile() || !linked.isFile() || linked.isSymbolicLink() ||
        (descriptor.mode & 0o777) !== 0o600 || (linked.mode & 0o777) !== 0o600 ||
        String(descriptor.dev) !== String(lockIdentity.dev) || String(descriptor.ino) !== String(lockIdentity.ino) ||
        String(linked.dev) !== String(lockIdentity.dev) || String(linked.ino) !== String(lockIdentity.ino)) {
      throw safeError("JOURNAL_LOCK_OWNERSHIP_INVALID");
    }
  };
  const recoverAfterHelperFailure = async () => {
    if (!helper.closed) {
      try {
        return await helper.command("recover_bound");
      } catch {}
    }
    await helper.stop().catch(() => {});
    helper = await startJournalIoHelper({ visibleParent, canonicalParent, journalBasename, parentIdentity,
      timeoutMs: helperTimeoutMs, spawnProcess });
    lockIdentity = await helper.command("adopt", { metadata });
    helper.setLockIdentity(lockIdentity);
    return helper.command("recover");
  };
  const lock = {
    journalPath: path,
    canonicalJournalPath,
    lockPath: journalLockPath(canonicalJournalPath),
    active: true,
    async verifyOwnership() {
      if (!lock.active) throw safeError("JOURNAL_LOCK_RELEASE_INVALID");
      try {
        await verifyParentLock();
        await helper.command("verify");
      } catch {
        throw safeError("JOURNAL_LOCK_RELEASE_OWNERSHIP_INVALID");
      }
      return true;
    },
    async readJournal() {
      if (!lock.active) throw safeError("JOURNAL_LOCK_REQUIRED");
      try {
        return await helper.command("read");
      } catch {
        throw safeError("JOURNAL_READ_FAILED");
      }
    },
    async readEvaluatorSidecar(sidecarBasename) {
      if (!lock.active) throw safeError("JOURNAL_LOCK_REQUIRED");
      try {
        return await helper.command("read_sidecar", { basename: sidecarBasename });
      } catch {
        throw safeError("EVALUATOR_SIDECAR_READ_FAILED");
      }
    },
    async saveJournal(journal, sidecar, io = {}) {
      if (!lock.active) throw safeError("JOURNAL_LOCK_REQUIRED");
      const hooks = Object.fromEntries(JOURNAL_HELPER_STAGES.filter((stage) => typeof io?.[stage] === "function")
        .map((stage) => [stage, io[stage]]));
      try {
        const transactionId = randomUUID();
        return await helper.command("save", { transaction_id: transactionId, journal, sidecar }, { pauseStages: Object.keys(hooks),
          onStage: (stage) => hooks[stage]() });
      } catch {
        try {
          const recovery = await recoverAfterHelperFailure();
          if (recovery?.outcome === "committed") return { transaction_id: recovery.transaction_id };
        } catch {}
        throw safeError("JOURNAL_SAVE_FAILED");
      }
    },
    async release() {
      if (!lock.active) throw safeError("JOURNAL_LOCK_RELEASE_INVALID");
      try {
        await lock.verifyOwnership();
        await helper.command("release");
        lock.active = false;
        await parentLockHandle.close();
        parentLockHandle = undefined;
        await helper.stop();
      } catch (error) {
        await helper.stop();
        await parentLockHandle?.close().catch(() => {});
        parentLockHandle = undefined;
        lock.active = false;
        if (safeSmokeErrors.has(error) && error.message === "JOURNAL_LOCK_RELEASE_OWNERSHIP_INVALID") throw error;
        throw safeError("JOURNAL_LOCK_RELEASE_FAILED");
      }
    },
    async abandon() {
      if (!lock.active) return;
      lock.active = false;
      await parentLockHandle?.close().catch(() => {});
      parentLockHandle = undefined;
      await helper.stop();
    },
    terminateIoHelper(signal = "SIGTERM") {
      return helper.terminate(signal);
    },
    disconnectIoHelper() {
      helper.disconnect();
    },
    sendMalformedIoMessage() {
      helper.sendMalformed();
    },
  };
  return lock;
}

export function uniqueJournalTemporaryPath(path, { pid = process.pid, id = randomUUID() } = {}) {
  if (typeof path !== "string" || !path || !Number.isSafeInteger(pid) || pid <= 0 ||
      typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw safeError("JOURNAL_TEMPORARY_PATH_INVALID");
  return `${path}.${pid}.${id}.tmp`;
}

async function atomicSave(path, journal, sidecar, lock, io = {}) {
  const held = await verifyHeldJournalLock(lock, path);
  await held.saveJournal(journal, sidecar, io);
}

export async function persistValidatedJournal(journal, save, options = {}) {
  validateJournalForPersistence(journal, options);
  return save(journal);
}

export async function persistJournalToDisk(path, journal, lock, io) {
  if (journal?.status === "COMPLETED") {
    const prepared = prepareCompletedJournalSidecar(journal, basename(resolve(path)));
    return persistValidatedJournal(prepared.journal,
      (value) => atomicSave(path, value, prepared.sidecar, lock, io),
      { rawEvaluatorHex: `0x${prepared.sidecar.hex}`, journalBasename: basename(resolve(path)) });
  }
  return persistValidatedJournal(journal, (value) => atomicSave(path, value, null, lock, io));
}

async function loadOrCreateJournal(path, input, lock) {
  const held = await verifyHeldJournalLock(lock, path);
  let journal;
  try {
    const stored = await held.readJournal();
    if (!stored.exists) throw safeError("JOURNAL_NOT_FOUND");
    journal = JSON.parse(stored.contents);
  } catch (error) {
    if (!(safeSmokeErrors.has(error) && error.message === "JOURNAL_NOT_FOUND")) throw safeError("JOURNAL_LOAD_FAILED");
    const runId = randomUUID();
    const { jobTitle, jobDescription } = buildMarkedJobFields(runId, input.baseTitle, input.baseDescription);
    const config = {
      ...publicRuntimeMetadata(input),
      run_id: runId,
      job_title: jobTitle,
      job_description: jobDescription,
    };
    journal = {
      schema_version: JOURNAL_SCHEMA_VERSION,
      status: "ACTIVE",
      config,
      created_at: new Date().toISOString(),
      steps: {},
      state: {},
    };
    await persistJournalToDisk(path, journal, lock);
    return journal;
  }
  if (journal?.status === "COMPLETED") {
    const sidecarBasename = journal?.state?.evaluator_evidence?.sidecar_basename;
    if (!validSidecarBasename(sidecarBasename)) throw safeError("JOURNAL_LOAD_FAILED");
    let sidecar;
    try {
      sidecar = await held.readEvaluatorSidecar(sidecarBasename);
      if (sidecar.byte_length !== journal.state.evaluator_evidence.sidecar_byte_length ||
          sidecar.sha256 !== journal.state.evaluator_evidence.sidecar_sha256) throw new Error("sidecar mismatch");
      validateStoredCompletedJournal(journal, `0x${sidecar.hex}`, basename(resolve(path)));
    } catch {
      throw safeError("JOURNAL_LOAD_FAILED");
    }
  }
  const runId = journal.config?.run_id;
  validateJobFields(journal.config?.job_title, journal.config?.job_description);
  const { jobTitle, jobDescription } = buildMarkedJobFields(runId, input.baseTitle, input.baseDescription);
  const expected = {
    ...publicRuntimeMetadata(input),
    run_id: runId,
    job_title: jobTitle,
    job_description: jobDescription,
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
    return { kind: "FAILURE", reason: "UNEXPECTED_DECIDED_OUTCOME" };
  }
  return { kind: "PENDING" };
}

async function traceFailure(client, hash, reason) {
  let traceCategory = "TRACE_UNAVAILABLE";
  try {
    const trace = await client.debugTraceTransaction({ hash });
    traceCategory = trace?.result_code === 1 ? "USER_ERROR" : trace?.result_code === 2 ? "VM_ERROR" : "UNKNOWN_TRACE_RESULT";
  } catch {
    throw externalError("TRANSACTION_FAILED", "debug_trace_transaction", { hash, reason, trace: traceCategory });
  }
  throw externalError("TRANSACTION_FAILED", "transaction_execution", { hash, reason, trace: traceCategory });
}

export async function waitForSuccessfulExecution(client, hash, options = {}) {
  if (!validTransactionHash(hash)) throw safeError("TRANSACTION_HASH_MALFORMED");
  const attempts = options.attempts ?? 120;
  const intervalMs = options.intervalMs ?? 5_000;
  const sleeper = options.sleep ?? sleep;
  let lastRpcError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const transaction = projectTransactionState(await client.getTransaction({ hash, expectedRequest: options.expectedTransaction }), hash);
      const classification = classifyTransaction(transaction);
      if (classification.kind === "SUCCESS") return transaction;
      if (classification.kind === "FAILURE") {
        if (options.traceFailures === false) throw safeError("TRANSACTION_FAILED", { operation: "transaction_execution", hash, reason: classification.reason });
        await traceFailure(client, hash, classification.reason);
      }
    } catch (error) {
      if (safeSmokeErrors.has(error) && String(error.message).startsWith("TRANSACTION_FAILED")) throw error;
      lastRpcError = true;
    }
    if (attempt < attempts) await sleeper(intervalMs);
  }
  throw safeError("TRANSACTION_POLL_TIMEOUT", { operation: "get_transaction", hash,
    detail: lastRpcError ? EXTERNAL_ERROR_MARKER : "no_successful_receipt" });
}

function validTransactionHash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function assertFinalizedExecution(transaction, requestedHash) {
  if (!validTransactionHash(requestedHash)) throw safeError("VERIFY_REQUESTED_HASH_MALFORMED");
  transaction = projectTransactionState(transaction, requestedHash);
  const identities = ["hash", "txId"].filter((field) => transaction?.[field] !== undefined);
  if (identities.length === 0) throw safeError("VERIFY_FINALIZED_TRANSACTION_IDENTITY_MISSING");
  for (const field of identities) {
    if (!validTransactionHash(transaction[field])) throw safeError(`VERIFY_FINALIZED_TRANSACTION_${field.toUpperCase()}_MALFORMED`);
    if (transaction[field].toLowerCase() !== requestedHash.toLowerCase()) {
      throw safeError(`VERIFY_FINALIZED_TRANSACTION_${field.toUpperCase()}_MISMATCH`);
    }
  }
  if (transaction?.statusName !== TransactionStatus.FINALIZED || Number(transaction?.status) !== 7) {
    throw safeError("VERIFY_TRANSACTION_NOT_FINALIZED_STATUS_7");
  }
  if (!SUCCESS_RESULTS.has(transaction.resultName) || transaction.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw safeError("VERIFY_FINALIZED_EXECUTION_OUTCOME_MISMATCH");
  }
  if (!Object.hasOwn(transaction, "evaluatorEvidence")) throw safeError("VERIFY_FINALIZED_EVALUATOR_EVIDENCE_MISSING");
  validateEvaluatorEvidence(transaction.evaluatorEvidence, requestedHash);
  return transaction;
}

export async function waitForFinalizedExecution(client, hash, options = {}) {
  if (!validTransactionHash(hash)) throw safeError("TRANSACTION_HASH_MALFORMED");
  const attempts = options.attempts ?? 120;
  const intervalMs = options.intervalMs ?? 5_000;
  const sleeper = options.sleep ?? sleep;
  let lastRpcError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const transaction = projectTransactionState(await client.getTransaction({ hash, expectedRequest: options.expectedTransaction }), hash);
      const classification = classifyTransaction(transaction);
      if (transaction?.statusName === TransactionStatus.FINALIZED) return assertFinalizedExecution(transaction, hash);
      if (classification.kind === "FAILURE") {
        if (options.traceFailures === false) throw safeError("TRANSACTION_FAILED", { operation: "transaction_execution", hash, reason: classification.reason });
        await traceFailure(client, hash, classification.reason);
      }
    } catch (error) {
      if (safeSmokeErrors.has(error) && (String(error.message).startsWith("TRANSACTION_FAILED") ||
          String(error.message).startsWith("VERIFY_TRANSACTION_NOT_FINALIZED") ||
          (String(error.message).startsWith("VERIFY_FINALIZED_") &&
            error.message !== "VERIFY_FINALIZED_EVALUATOR_EVIDENCE_MISSING") ||
          String(error.message).startsWith("VERIFY_REQUESTED_HASH_"))) throw error;
      lastRpcError = true;
    }
    if (attempt < attempts) await sleeper(intervalMs);
  }
  throw safeError("FINALIZATION_POLL_TIMEOUT", { operation: "get_transaction", hash,
    detail: lastRpcError ? EXTERNAL_ERROR_MARKER : "not_finalized" });
}

export async function submitStep({ journal, stepName, client, request, sender, save, wait, beforeRawBroadcast }) {
  let step = journal.steps[stepName];
  const metadata = publicRequestMetadata(request, sender);
  if (step && !equalData(step.request, metadata)) throw new Error("STEP_REQUEST_MISMATCH");
  if (step?.status === "INTENT_RECORDED" && !step.hash) {
    throw new Error("AMBIGUOUS_BROADCAST_MANUAL_INVESTIGATION_REQUIRED");
  }
  if (!step) {
    step = { status: "INTENT_RECORDED", request: metadata, created_at: new Date().toISOString() };
    journal.steps[stepName] = step;
    await save(journal);
    let broadcastPromise;
    try {
      broadcastPromise = client.writeContract(request, { beforeRawBroadcast });
    } catch (error) {
      throw submitWriteFailure(error);
    }
    let hash;
    try {
      hash = await broadcastPromise;
    } catch (error) {
      throw submitWriteFailure(error);
    }
    if (!validTransactionHash(hash)) {
      throw externalError("BROADCAST_RESULT_UNKNOWN", "write_contract", { journal: "intent_remains_recorded" });
    }
    step.status = "HASH_RECORDED";
    step.hash = hash;
    step.hash_recorded_at = new Date().toISOString();
    await save(journal);
  }
  if (step.status === "PRE_EXISTING") return null;
  if (!step.hash) throw new Error("JOURNAL_STEP_HASH_MISSING");
  if (step.status !== "EXECUTION_CONFIRMED") {
    const transaction = await wait(step.hash, { sender, address: request.address, functionName: request.functionName,
      args: request.args, value: request.value });
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
  let lastError = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch (error) {
      if (safeSmokeErrors.has(error) && String(error.message).startsWith("JOB_DISCOVERY_MULTIPLE_MATCHES")) throw error;
      lastError = true;
    }
    if (attempt < attempts) await sleep(intervalMs);
  }
  throw safeError("STATE_POLL_TIMEOUT", { operation: "read_contract", description,
    detail: lastError ? EXTERNAL_ERROR_MARKER : "predicate_not_satisfied" });
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
  const matches = [];
  for (const candidate of candidates) {
    if (!jobIdentityMatches(candidate, config)) continue;
    const projected = projectJobEvidence(candidate, config);
    if (jobMatches(projected, config)) matches.push(projected);
  }
  if (matches.length > 1) throw safeError("JOB_DISCOVERY_MULTIPLE_MATCHES", { count: matches.length });
  return matches[0] ?? null;
}

function assertVerificationEvidence({ journal, job, config, jobId, escrowWei, evaluatorEvidence }) {
  jobId = requireCanonicalPositiveJobId(jobId, "FINAL_JOB_ID_INVALID");
  if (job.job_id !== jobId || !jobIdentityMatches(job, config)) throw new Error("FINAL_JOB_IDENTITY_MISMATCH");
  if (job.deliverable_url !== config.deliverable_url) throw new Error("FINAL_JOB_DELIVERABLE_URL_MISMATCH");
  const fundedJob = journal.state.funded_job;
  if (!fundedJob || fundedJob.job_id !== jobId || !jobIdentityMatches(fundedJob, config) ||
      fundedJob.status !== "FUNDED" || BigInt(fundedJob.escrow_balance) !== escrowWei) {
    throw new Error("FUNDED_JOB_EVIDENCE_MISMATCH");
  }
  const { step } = selectVerifySuccessStep(journal);
  const expectedRequest = {
    sender: config.client_address,
    address: config.contract_address,
    functionName: "verify_and_release",
    args: [jobId],
    value: "0",
  };
  if (step?.status !== "EXECUTION_CONFIRMED") throw new Error("VERIFY_EXECUTION_NOT_CONFIRMED");
  if (!equalData(step.request, expectedRequest)) throw new Error("VERIFY_REQUEST_MISMATCH");
  if (!SUCCESS_STATUSES.has(step.execution?.status_name) ||
      !SUCCESS_RESULTS.has(step.execution?.result_name) ||
      step.execution?.execution_result_name !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error("VERIFY_EXECUTION_OUTCOME_MISMATCH");
  }
  const evaluator = validateEvaluatorEvidence(evaluatorEvidence, step.hash);
  if (job.ai_reasoning.present !== true) throw new Error("FINAL_JOB_AI_REASONING_EVIDENCE_MISSING");
  if ((config.flow === "approval" && (!evaluator.approved || job.status !== "PAID" || job.ai_verdict !== "APPROVED")) ||
      (config.flow === "rejection" && (evaluator.approved || job.status !== "DISPUTED" || job.ai_verdict !== "REJECTED"))) {
    throw new Error("EVALUATOR_FINAL_VERDICT_MISMATCH");
  }
  return step;
}

function sharedCounterDeltas({ snapshots, afterStats, afterProfile }) {
  return {
    total_paid: requireDecimal(afterStats?.total_paid, "FINAL_STATS_INVALID") - BigInt(snapshots.stats.total_paid),
    total_earned: requireDecimal(afterProfile?.total_earned, "FINAL_PROFILE_ACCOUNTING_INVALID") - BigInt(snapshots.profile.total_earned),
    jobs_completed: requireDecimal(afterProfile?.jobs_completed, "FINAL_PROFILE_ACCOUNTING_INVALID") - BigInt(snapshots.profile.jobs_completed),
  };
}

export function assertApprovalAccounting(input) {
  const { journal, config, jobId, job, escrowWei, afterProfile, afterFreelancerBalance, verificationFinalization } = input;
  const snapshots = assertPreVerificationSnapshots({ journal, config, jobId, escrowWei, enforceFreshness: false });
  const verificationStep = assertVerificationEvidence(input);
  assertFinalizedExecution(verificationFinalization, verificationStep.hash);
  if (afterProfile?.found !== true || afterProfile.role !== "freelancer" ||
      !sameAddress(afterProfile.address, config.freelancer_address)) throw new Error("FINAL_PROFILE_IDENTITY_MISMATCH");
  if (job.status !== "PAID" || job.ai_verdict !== "APPROVED" || BigInt(job.escrow_balance) !== 0n) throw new Error("APPROVAL_JOB_STATE_MISMATCH");
  const deltas = sharedCounterDeltas({ snapshots, afterStats: input.afterStats, afterProfile });
  if (deltas.total_paid !== EXACT_ESCROW_WEI || escrowWei !== EXACT_ESCROW_WEI) throw new Error("APPROVAL_TOTAL_PAID_DELTA_MISMATCH");
  if (deltas.total_earned !== EXACT_ESCROW_WEI) throw new Error("APPROVAL_TOTAL_EARNED_DELTA_MISMATCH");
  if (deltas.jobs_completed !== 1n) throw new Error("APPROVAL_JOBS_COMPLETED_DELTA_MISMATCH");
  const balance = requireDecimal(String(afterFreelancerBalance), "FINAL_FREELANCER_BALANCE_INVALID") - BigInt(snapshots.balance);
  if (balance !== EXACT_ESCROW_WEI) throw new Error("APPROVAL_FINALIZED_BALANCE_DELTA_MISMATCH");
  return { ...deltas, freelancer_balance: balance };
}

export function assertRejectionAccounting(input) {
  const { journal, config, jobId, job, escrowWei, afterProfile, afterFreelancerBalance, verificationFinalization } = input;
  const snapshots = assertPreVerificationSnapshots({ journal, config, jobId, escrowWei, enforceFreshness: false });
  const verificationStep = assertVerificationEvidence(input);
  assertFinalizedExecution(verificationFinalization, verificationStep.hash);
  if (afterProfile?.found !== true || afterProfile.role !== "freelancer" ||
      !sameAddress(afterProfile.address, config.freelancer_address)) throw new Error("FINAL_PROFILE_IDENTITY_MISMATCH");
  if (journal.steps.client_refund) throw new Error("REJECTION_REFUND_STEP_PRESENT");
  if (job.status !== "DISPUTED" || job.ai_verdict !== "REJECTED" || BigInt(job.escrow_balance) !== escrowWei) throw new Error("REJECTION_JOB_STATE_MISMATCH");
  const deltas = sharedCounterDeltas({ snapshots, afterStats: input.afterStats, afterProfile });
  if (escrowWei !== EXACT_ESCROW_WEI) throw new Error("REJECTION_ESCROW_CONFIGURATION_MISMATCH");
  if (deltas.total_paid !== 0n) throw new Error("REJECTION_TOTAL_PAID_DELTA_MISMATCH");
  if (deltas.total_earned !== 0n) throw new Error("REJECTION_TOTAL_EARNED_DELTA_MISMATCH");
  if (deltas.jobs_completed !== 0n) throw new Error("REJECTION_JOBS_COMPLETED_DELTA_MISMATCH");
  const balance = requireDecimal(String(afterFreelancerBalance), "FINAL_FREELANCER_BALANCE_INVALID") - BigInt(snapshots.balance);
  if (balance !== 0n) throw new Error("REJECTION_FINALIZED_BALANCE_DELTA_MISMATCH");
  return { ...deltas, freelancer_balance: balance };
}

async function run() {
  const flow = process.argv[2];
  if (!new Set(["approval", "rejection"]).has(flow)) {
    throw safeError("SMOKE_FLOW_ARGUMENT_INVALID");
  }
  assertLiveOptIn(process.env);
  const journalPath = `.smoke-freelance-market.${flow}.json`;
  const lock = await acquireJournalLock(journalPath);
  try {
    await runWithJournalLock(flow, journalPath, lock);
  } finally {
    await lock.release();
  }
}

async function runWithJournalLock(flow, journalPath, lock) {
  const runtime = loadSmokeRuntimeConfig(flow);
  const escrowWei = runtime.escrowWei;
  const prefix = flow.toUpperCase();
  const baseTitle = process.env[`SMOKE_${prefix}_JOB_TITLE`] ?? (flow === "approval" ? "Document GenLayer escrow verification" : "Summarize GenLayer escrow requirements");
  const baseDescription = process.env[`SMOKE_${prefix}_JOB_DESCRIPTION`] ?? (flow === "approval"
    ? "Provide a public page that clearly and specifically documents this GenLayer freelance escrow verification workflow and its approval behavior."
    : "Provide a public page that clearly and specifically summarizes this GenLayer freelance escrow contract and its semantic verification requirements.");
  const journal = await loadOrCreateJournal(journalPath, {
    flow, escrowWei, baseTitle, baseDescription, deliverableUrl: runtime.deliverableUrl,
    chainId: runtime.chainId, contractAddress: runtime.contractAddress,
    clientAddress: runtime.clientAddress, freelancerAddress: runtime.freelancerAddress,
  }, lock);
  const save = (value) => persistJournalToDisk(journalPath, value, lock);
  const attempts = positiveInteger("SMOKE_STATE_ATTEMPTS", 120);
  const receiptAttempts = positiveInteger("SMOKE_RECEIPT_ATTEMPTS", 120);
  const intervalMs = positiveInteger("SMOKE_POLL_INTERVAL_MS", 5_000);
  const rpcOptions = { projectionConfig: journal.config, receiptAttempts, intervalMs };
  const writerRpcOptions = createLiveBradburyWriterRpcOptions(rpcOptions);
  const readClient = createBradburyReadClient(createBradburyRpcClient, rpcOptions);
  const read = (functionName, args = []) =>
    readClient.readContract({ address: runtime.contractAddress, functionName, args });
  const wait = (hash, expectedTransaction) => waitForSuccessfulExecution(readClient, hash,
    { attempts: receiptAttempts, intervalMs, expectedTransaction });
  const waitFinalized = (hash, expectedTransaction) => waitForFinalizedExecution(readClient, hash,
    { attempts: receiptAttempts, intervalMs, expectedTransaction });
  const readFreelancerBalance = () => readClient.getBalance({ address: runtime.freelancerAddress });

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
          getTransaction: (hash) => readClient.getTransaction({ hash, expectedRequest: {
            sender: journal.config.client_address, address: journal.config.contract_address,
            functionName: "verify_and_release", args: [journal.state.job_id], value: 0n,
          } }),
          readJob: (jobId) => read("get_job", [jobId]),
          save,
          escrowWei,
          loadClientAccount: () => verifyConfiguredAccount(runtime, "client"),
          createWriter: (account) => createBradburyWriterClient(
            account,
            createBradburyRpcClient,
            writerRpcOptions,
          ),
          wait,
        });
      }
    } finally {
      console.log("Verification attempts:");
      console.log(JSON.stringify(formatVerificationAttempts(journal), null, 2));
    }
    await finishRun({ flow, journal, save, read, waitFinalized, readFreelancerBalance, pollAttempts: attempts, intervalMs, escrowWei });
    return;
  }

  const { clientAccount, freelancerAccount } = verifyConfiguredAccounts(runtime);
  const client = createBradburyWriterClient(clientAccount, createBradburyRpcClient, writerRpcOptions);
  const freelancer = createBradburyWriterClient(freelancerAccount, createBradburyRpcClient, writerRpcOptions);

  async function ensureRegistered(role, address, writer) {
    const stepName = `register_${role}`;
    const existingStep = journal.steps[stepName];
    if (existingStep && existingStep.status !== "PRE_EXISTING") {
      await submitStep({ journal, stepName, client: writer, request: {
        address: runtime.contractAddress, functionName: "register",
        args: [role, `Smoke ${role}`, "Bradbury escrow smoke-test account", "testing", "0", "fixed", "", "", ""], value: 0n,
      }, sender: address, save, wait });
    } else if (!existingStep) {
      const profile = await read("get_profile", [address]);
      if (profile.found) {
        assertRegistrationProfile(profile, role, address);
        journal.steps[stepName] = { status: "PRE_EXISTING", address, role, recorded_at: new Date().toISOString() };
        await save(journal);
      } else {
        await submitStep({ journal, stepName, client: writer, request: {
          address: runtime.contractAddress, functionName: "register",
          args: [role, `Smoke ${role}`, "Bradbury escrow smoke-test account", "testing", "0", "fixed", "", "", ""], value: 0n,
        }, sender: address, save, wait });
      }
    }
    await pollState(() => read("get_profile", [address]), (profile) => profile.found === true && profile.role === role, `${role} registration visible`, attempts, intervalMs);
  }

  await ensureRegistered("client", runtime.clientAddress, client);
  await ensureRegistered("freelancer", runtime.freelancerAddress, freelancer);
  const config = journal.config;
  const readProjectedJob = async (jobId) => projectJobEvidence(await read("get_job", [jobId]), config);
  const beforeStats = journal.state.before_stats ?? projectAccountingStats(await read("get_stats"), { includeTotalJobs: true });
  const beforeProfile = journal.state.before_freelancer_profile ??
    projectFreelancerProfile(await read("get_profile", [runtime.freelancerAddress]), runtime.freelancerAddress);
  journal.state.before_stats ??= beforeStats;
  journal.state.before_freelancer_profile ??= beforeProfile;
  journal.state.before_job_count ??= beforeStats.total_jobs;
  await save(journal);

  await submitStep({ journal, stepName: "create_job", client, sender: runtime.clientAddress, save, wait, request: {
    address: runtime.contractAddress, functionName: "create_job",
    args: [config.job_title, config.job_description, runtime.freelancerAddress, "2099-12-31"], value: 0n,
  } });

  if (!journal.state.job_id) {
    const discovered = await pollState(async () => {
      const current = await read("get_stats");
      const candidates = [];
      for (let id = BigInt(journal.state.before_job_count) + 1n; id <= BigInt(current.total_jobs); id += 1n) candidates.push(await read("get_job", [String(id)]));
      return selectUniqueJob(candidates, config);
    }, Boolean, "unique OPEN smoke job", attempts, intervalMs);
    journal.state.job_id = requireCanonicalPositiveJobId(discovered.job_id, "DISCOVERED_JOB_ID_INVALID");
    await save(journal);
  }
  const jobId = requireCanonicalPositiveJobId(journal.state.job_id, "JOURNAL_JOB_ID_INVALID");
  await pollState(() => readProjectedJob(jobId), (job) => jobIdentityMatches(job, config), "persisted job identity revalidation", attempts, intervalMs);
  if (!journal.steps.fund_job) {
    await pollState(() => readProjectedJob(jobId), (job) => jobMatches(job, config), "OPEN with zero escrow", attempts, intervalMs);
  }

  await submitStep({ journal, stepName: "fund_job", client, sender: runtime.clientAddress, save, wait, request: {
    address: runtime.contractAddress, functionName: "fund_job", args: [jobId], value: escrowWei,
  } });
  if (!journal.steps.submit_work) {
    const fundedJob = await pollState(() => readProjectedJob(jobId), (job) => jobIdentityMatches(job, config) && job.status === "FUNDED" && BigInt(job.escrow_balance) === escrowWei, "FUNDED with exact escrow", attempts, intervalMs);
    journal.state.funded_job = fundedJob;
    await save(journal);
  } else if (!journal.state.funded_job) {
    throw new Error("FUNDED_JOB_EVIDENCE_MISSING: cannot attribute the escrow transition");
  }

  await submitStep({ journal, stepName: "submit_work", client: freelancer, sender: runtime.freelancerAddress, save, wait, request: {
    address: runtime.contractAddress, functionName: "submit_work", args: [jobId, config.deliverable_url], value: 0n,
  } });
  if (!journal.steps.verify_and_release) {
    const submittedJob = await pollState(() => readProjectedJob(jobId), (job) => jobIdentityMatches(job, config) &&
      job.status === "SUBMITTED" && job.deliverable_url === config.deliverable_url &&
      BigInt(job.escrow_balance) === escrowWei && job.ai_verdict === "" && job.ai_reasoning.present === false,
    "SUBMITTED current-run job with exact identity, URL, and escrow", attempts, intervalMs);
    await recordPreVerificationSnapshots({ journal, job: submittedJob, escrowWei,
      readStats: () => read("get_stats"), readProfile: () => read("get_profile", [runtime.freelancerAddress]),
      readBalance: readFreelancerBalance, save });
  } else {
    assertPreVerificationSnapshots({ journal, escrowWei });
  }

  if (journal.steps.client_refund) throw new Error("REFUND_FORBIDDEN: client_refund step exists");
  assertPreVerificationSnapshots({ journal, escrowWei });
  await submitStep({ journal, stepName: "verify_and_release", client, sender: runtime.clientAddress, save, wait, request: {
    address: runtime.contractAddress, functionName: "verify_and_release", args: [jobId], value: 0n,
  }, beforeRawBroadcast: () => assertPreVerificationSnapshots({ journal, escrowWei }) });
  journal.state.verify_success_step = "verify_and_release";
  await save(journal);
  await finishRun({ flow, journal, save, read, waitFinalized, readFreelancerBalance, pollAttempts: attempts, intervalMs, escrowWei });
}

export async function finishRun({ flow, journal, save, read, waitFinalized, readFreelancerBalance, escrowWei }) {
  const config = journal.config;
  const jobId = requireCanonicalPositiveJobId(journal.state.job_id, "JOURNAL_JOB_ID_INVALID");
  const verification = selectVerifySuccessStep(journal);
  const verificationFinalization = await waitFinalized(verification.step.hash, {
    sender: config.client_address, address: config.contract_address, functionName: "verify_and_release", args: [jobId], value: 0n,
  });
  assertFinalizedExecution(verificationFinalization, verification.step.hash);
  const evaluatorEvidence = validateEvaluatorEvidence(verificationFinalization.evaluatorEvidence, verification.step.hash);
  const firstFinalJob = projectJobEvidence(await read("get_job", [jobId]), config);
  const afterStats = projectAccountingStats(await read("get_stats"));
  const afterProfile = projectFreelancerProfile(await read("get_profile", [config.freelancer_address]), config.freelancer_address);
  const afterFreelancerBalance = await readFreelancerBalance();
  const secondFinalJob = projectJobEvidence(await read("get_job", [jobId]), config);
  if (!equalData(firstFinalJob, secondFinalJob)) throw safeError("FINAL_JOB_EVIDENCE_WINDOW_CHANGED");
  const accounting = { journal, job: firstFinalJob, config, jobId, afterStats, afterProfile, escrowWei,
    verificationFinalization, evaluatorEvidence, afterFreelancerBalance };
  if (flow === "approval") assertApprovalAccounting(accounting);
  else assertRejectionAccounting(accounting);
  journal.state.final_job = firstFinalJob;
  journal.state.after_stats = afterStats;
  journal.state.after_freelancer_profile = afterProfile;
  journal.state.evaluator_evidence = evaluatorEvidence;
  journal.state.verify_finalization = {
    transaction_hash: verification.step.hash,
    status_code: Number(verificationFinalization.status), status_name: verificationFinalization.statusName,
    result_name: verificationFinalization.resultName, execution_result_name: verificationFinalization.txExecutionResultName,
    eq_blocks_outputs_sha256: evaluatorEvidence.eq_blocks_outputs_sha256,
    eq_blocks_outputs_byte_length: evaluatorEvidence.eq_blocks_outputs_byte_length,
    structural_selector: evaluatorEvidence.structural_selector,
    selected_output_index: evaluatorEvidence.selected_output_index,
    selected_output_identity: evaluatorEvidence.selected_output_identity,
  };
  journal.state.after_finalization_freelancer_balance = String(afterFreelancerBalance);
  journal.status = "COMPLETED";
  journal.completed_at = new Date().toISOString();
  await save(journal);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) run().catch((error) => {
  console.error(`Smoke flow stopped: ${safeProcessError(error)}`);
  process.exitCode = 1;
});
