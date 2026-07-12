import assert from "node:assert/strict";
import test from "node:test";
import { canApplyScopeResult } from "../lib/transaction-scope.mjs";

test("a delayed confirmation cannot apply after wallet scope changes", async () => {
  const controller = new AbortController();
  const walletAVersion = 1;
  let currentVersion = walletAVersion;
  let refreshed = false;
  let confirmed = false;

  let resolveWalletA;
  const walletARead = new Promise((resolve) => {
    resolveWalletA = resolve;
  });

  const completion = walletARead.then((matches) => {
    if (
      matches &&
      canApplyScopeResult(
        walletAVersion,
        currentVersion,
        controller.signal,
      )
    ) {
      confirmed = true;
      refreshed = true;
    }
  });

  currentVersion = 2;
  controller.abort();
  resolveWalletA(true);
  await completion;

  assert.equal(confirmed, false);
  assert.equal(refreshed, false);
});
