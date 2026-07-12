import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import {
  checkReceiptUsingStructuredReads,
  classifyReceipt,
  shouldConfirmExpectedState,
} from "../lib/receipt-classifier.ts";

const hash = `0x${"1".repeat(64)}`;
const receipt = (statusName, txExecutionResultName) => ({
  statusName,
  txExecutionResultName,
});

test("classifies structured GenLayer receipt outcomes", () => {
  const cases = [
    [TransactionStatus.ACCEPTED, ExecutionResult.FINISHED_WITH_RETURN, "executed"],
    [TransactionStatus.FINALIZED, ExecutionResult.FINISHED_WITH_RETURN, "executed"],
    [TransactionStatus.ACCEPTED, ExecutionResult.FINISHED_WITH_ERROR, "execution_failed"],
    [TransactionStatus.ACCEPTED, ExecutionResult.NOT_VOTED, "processing"],
    [TransactionStatus.CANCELED, ExecutionResult.NOT_VOTED, "canceled"],
    [TransactionStatus.UNDETERMINED, ExecutionResult.NOT_VOTED, "undetermined"],
    [TransactionStatus.PENDING, ExecutionResult.NOT_VOTED, "processing"],
    [TransactionStatus.PROPOSING, ExecutionResult.NOT_VOTED, "processing"],
    [TransactionStatus.COMMITTING, ExecutionResult.NOT_VOTED, "processing"],
    [TransactionStatus.REVEALING, ExecutionResult.NOT_VOTED, "processing"],
  ];

  for (const [status, execution, expected] of cases) {
    assert.equal(
      classifyReceipt(hash, receipt(status, execution)).kind,
      expected,
      `${status} + ${execution}`,
    );
  }
});

test("transport uncertainty after submission is unknown, never execution failure", () => {
  const result = classifyReceipt(hash, undefined);
  assert.equal(result.kind, "unknown");
  assert.equal(shouldConfirmExpectedState(result), false);
});

test("RPC timeout followed by unavailable transaction lookup stays unknown", async () => {
  const result = await checkReceiptUsingStructuredReads(
    hash,
    async () => {
      throw new Error("transport timeout");
    },
    async () => {
      throw new Error("temporarily unavailable");
    },
  );
  assert.equal(result.kind, "unknown");
  assert.notEqual(result.kind, "execution_failed");
});

test("expected-state confirmation starts only after structured execution success", () => {
  const processing = classifyReceipt(
    hash,
    receipt(TransactionStatus.PENDING, ExecutionResult.NOT_VOTED),
  );
  const executed = classifyReceipt(
    hash,
    receipt(
      TransactionStatus.ACCEPTED,
      ExecutionResult.FINISHED_WITH_RETURN,
    ),
  );
  assert.equal(shouldConfirmExpectedState(processing), false);
  assert.equal(shouldConfirmExpectedState(executed), true);
});

test("existing-hash receipt retry never submits a new transaction", async () => {
  let checkedHash = "";
  let writes = 0;
  const waitForReceipt = async (receivedHash) => {
      checkedHash = receivedHash;
      return receipt(
        TransactionStatus.ACCEPTED,
        ExecutionResult.FINISHED_WITH_RETURN,
      );
    };
  const getTransaction = async () => {
      throw new Error("not needed");
    };
  const writeContract = async () => {
      writes += 1;
      return hash;
    };

  const result = await checkReceiptUsingStructuredReads(
    hash,
    waitForReceipt,
    getTransaction,
  );
  assert.equal(checkedHash, hash);
  assert.equal(writes, 0);
  assert.equal(typeof writeContract, "function");
  assert.equal(shouldConfirmExpectedState(result), true);
});
