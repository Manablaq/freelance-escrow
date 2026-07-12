import assert from "node:assert/strict";
import test from "node:test";
import { retryExistingTransaction } from "../lib/transaction-retry.ts";

const hash = `0x${"9".repeat(64)}`;

function counters(receipt, scopeIsCurrent = () => true) {
  const calls = { submit: 0, checkReceipt: 0, confirm: 0, hash: "" };
  const request = {
    submit: async () => {
      calls.submit += 1;
    },
    checkReceipt: async (receivedHash) => {
      calls.checkReceipt += 1;
      calls.hash = receivedHash;
      return receipt;
    },
  };
  const run = () =>
    retryExistingTransaction({
      hash,
      request,
      scopeIsCurrent,
      onExecuted: async () => {
        calls.confirm += 1;
        return true;
      },
    });
  return { calls, run };
}

test("retry checks the existing hash once and confirms only after execution", async () => {
  const { calls, run } = counters({ kind: "executed", hash, receipt: {} });
  const result = await run();
  assert.equal(result.kind, "receipt");
  assert.equal(result.confirmed, true);
  assert.deepEqual(calls, { submit: 0, checkReceipt: 1, confirm: 1, hash });
});

test("processing retry never submits or starts expected-state confirmation", async () => {
  const { calls, run } = counters({ kind: "processing", hash, status: "PENDING" });
  const result = await run();
  assert.equal(result.kind, "receipt");
  assert.equal(result.confirmed, false);
  assert.deepEqual(calls, { submit: 0, checkReceipt: 1, confirm: 0, hash });
});

test("unknown retry never submits or starts expected-state confirmation", async () => {
  const { calls, run } = counters({ kind: "unknown", hash, message: "Unavailable" });
  await run();
  assert.deepEqual(calls, { submit: 0, checkReceipt: 1, confirm: 0, hash });
});

test("scope invalidation makes retry a complete no-op", async () => {
  const { calls, run } = counters(
    { kind: "executed", hash, receipt: {} },
    () => false,
  );
  const result = await run();
  assert.deepEqual(result, { kind: "invalid_scope" });
  assert.deepEqual(calls, { submit: 0, checkReceipt: 0, confirm: 0, hash: "" });
});
