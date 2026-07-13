import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/pending-transactions.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const commonJs = { exports: {} };
vm.runInNewContext(`(function(exports,module){${js}})(commonJs.exports,commonJs)`, { commonJs, JSON, Date, Math, Set });
const pending = commonJs.exports;
const input = (hash = "0xABC", walletAddress = "0xWallet", chainId = 4221) => ({ hash, walletAddress, chainId, contractAddress: "0xContract", method: "register", label: "Register profile", entityType: "profile", entityKey: walletAddress, optimisticData: { name: "Ada" }, confirmation: { kind: "register", role: "freelancer" } });

test("entries survive versioned serialization and rehydration", () => {
  const tx = pending.makePendingTransaction(input(), 100);
  assert.equal(JSON.stringify(pending.deserializePendingTransactions(pending.serializePendingTransactions([tx]))), JSON.stringify([tx]));
});
test("wallet and network scopes never mix", () => {
  const all = [pending.makePendingTransaction(input("0xa", "0xAlice", 4221)), pending.makePendingTransaction(input("0xb", "0xBob", 4221)), pending.makePendingTransaction(input("0xc", "0xAlice", 1))];
  assert.deepEqual(pending.scopedTransactions(all, 4221, "0xContract", "0xAlice").map((x) => x.hash), ["0xa"]);
});
test("duplicate hashes are deduplicated", () => {
  const first = pending.makePendingTransaction(input("0xDUP"), 1);
  const second = pending.makePendingTransaction(input("0xdup"), 2);
  assert.equal(pending.mergeTransaction([first], second).length, 1);
});
test("identical hashes in different namespaces do not collide", () => {
  const a = pending.makePendingTransaction(input("0xsame", "0xAlice", 4221));
  const b = pending.makePendingTransaction(input("0xsame", "0xAlice", 1));
  assert.equal(pending.mergeTransaction([a], b).length, 2);
});
test("backoff starts at two seconds and is bounded", () => {
  assert.equal(pending.pollingBackoffMs(0), 2000);
  assert.equal(pending.pollingBackoffMs(99), 10000);
});
test("submitted and confirmation reads remain unfinished", () => {
  const tx = pending.makePendingTransaction(input());
  assert.equal(pending.isUnfinished(tx), true);
  assert.equal(pending.isUnfinished({ ...tx, phase: "confirming" }), true);
  assert.equal(pending.isUnfinished({ ...tx, phase: "failed" }), false);
});

test("corrupt persisted records are rejected without throwing", () => {
  assert.equal(pending.deserializePendingTransactions("not-json").length, 0);
  assert.equal(pending.deserializePendingTransactions(JSON.stringify({ version: 1, transactions: [{ hash: "0xbroken" }] })).length, 0);
});

test("cross-tab merge keeps the newest record and completed records expire", () => {
  const old = pending.makePendingTransaction(input(), 100);
  const newer = { ...old, phase: "failed", updatedAt: 200 };
  assert.equal(pending.mergeTransactionCollections([old], [newer])[0].phase, "failed");
  const confirmed = { ...newer, phase: "confirmed", updatedAt: 1 };
  assert.deepEqual(pending.pruneTransactions([confirmed], pending.CONFIRMED_RETENTION_MS + 2), []);
  assert.equal(pending.pruneTransactions([newer], Number.MAX_SAFE_INTEGER).length, 1);
});

test("expected-state descriptors gate exact profile and job identity", () => {
  assert.equal(pending.matchesProfileConfirmation({ kind: "register", role: "client" }, { found: true, role: "freelancer" }), false);
  const descriptor = { kind: "create_job", knownJobIds: ["7"], expected: { client: "0xAbC", title: "Exact" } };
  assert.equal(pending.matchesJobConfirmation(descriptor, { found: true, job_id: "7", client: "0xabc", title: "Exact" }), false);
  assert.equal(pending.matchesJobConfirmation(descriptor, { found: true, job_id: "8", client: "0xabc", title: "Exact" }), true);
  assert.equal(pending.matchesCreateJobConfirmation(descriptor, [
    { found: true, job_id: "8", client: "0xabc", title: "Exact" },
    { found: true, job_id: "9", client: "0xabc", title: "Exact" },
  ]), false);
  assert.equal(pending.matchesJobConfirmation({ kind: "job_state", jobId: "8", statuses: ["FUNDED"], balance: "10" }, { job_id: "8", status: "FUNDED", escrow_balance: "9" }), false);
});

test("submission releases at onSubmitted even if submit promise stays unresolved", async () => {
  const submissionSource = fs.readFileSync(new URL("../lib/transaction-submission.ts", import.meta.url), "utf8");
  const submissionJs = ts.transpileModule(submissionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const submissionModule = { exports: {} };
  vm.runInNewContext(`(function(exports,module){${submissionJs}})(submissionModule.exports,submissionModule)`, { submissionModule, Promise });
  let handedHash = "";
  const result = submissionModule.exports.submitUntilHash(
    async (lifecycle) => {
      lifecycle.onSubmitted("0xhash");
      return new Promise(() => {});
    },
    { onSubmitted: (hash) => { handedHash = hash; } },
  );
  assert.equal(await result, "0xhash");
  assert.equal(handedHash, "0xhash");
});

test("architecture has one provider receipt owner and no page-local receipt calls", () => {
  const provider = fs.readFileSync(new URL("../components/TransactionProvider.tsx", import.meta.url), "utf8");
  assert.match(provider, /checkTransactionReceiptOnce/);
  assert.match(provider, /window\.setInterval/);
  for (const file of ["../app/dashboard/page.tsx", "../app/post-job/page.tsx", "../app/register/page.tsx", "../app/job/[id]/page.tsx"]) {
    assert.doesNotMatch(fs.readFileSync(new URL(file, import.meta.url), "utf8"), /checkTransactionReceipt/);
  }
});
