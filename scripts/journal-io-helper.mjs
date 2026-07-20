import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename } from "node:path";

const [visibleParent, canonicalParent, journalBasename, lockBasename, expectedDev, expectedIno] = process.argv.slice(2);
const noFollow = constants.O_NOFOLLOW ?? 0;
const transactionBasename = `${journalBasename}.transaction`;
let lockHandle;
let lockIdentity;
let lockMetadata;
let running = Promise.resolve();
const stageWaiters = new Map();
const commitWaiters = new Map();

function fixedFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validBasename(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && value === basename(value) &&
    value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\") && !value.includes("\0") &&
    /^[A-Za-z0-9._-]+$/.test(value);
}

function validHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validTransactionId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function sameIdentity(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function checkVisibleParent() {
  const cwdIdentity = await stat(".");
  const visibleLink = await lstat(visibleParent);
  const visibleIdentity = await stat(visibleParent);
  const visibleCanonical = await realpath(visibleParent);
  if (!cwdIdentity.isDirectory() || !visibleLink.isDirectory() || visibleLink.isSymbolicLink() ||
      !visibleIdentity.isDirectory() || visibleCanonical !== canonicalParent ||
      String(cwdIdentity.dev) !== expectedDev || String(cwdIdentity.ino) !== expectedIno ||
      !sameIdentity(cwdIdentity, visibleIdentity)) throw fixedFailure("JOURNAL_PARENT_IDENTITY_INVALID");
}

async function syncDirectory() {
  let directory;
  try {
    directory = await open(".", constants.O_RDONLY);
    await directory.sync();
  } finally {
    await directory?.close().catch(() => {});
  }
}

async function readRegular(name, { mode0600 = false } = {}) {
  if (!validBasename(name)) throw fixedFailure("JOURNAL_BASENAME_INVALID");
  let handle;
  try {
    const pathIdentity = await lstat(name);
    if (!pathIdentity.isFile() || pathIdentity.isSymbolicLink() || (mode0600 && (pathIdentity.mode & 0o777) !== 0o600)) {
      throw fixedFailure("JOURNAL_FILE_INVALID");
    }
    handle = await open(name, constants.O_RDONLY | noFollow);
    const descriptorIdentity = await handle.stat();
    if (!descriptorIdentity.isFile() || !sameIdentity(pathIdentity, descriptorIdentity) ||
        (mode0600 && (descriptorIdentity.mode & 0o777) !== 0o600)) throw fixedFailure("JOURNAL_FILE_INVALID");
    return { bytes: await handle.readFile(), identity: descriptorIdentity };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readOptional(name, options) {
  try {
    return await readRegular(name, options);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function removeKnown(name, expectedHash) {
  const current = await readOptional(name, { mode0600: true });
  if (!current) return;
  if (sha256(current.bytes) !== expectedHash) throw fixedFailure("JOURNAL_TRANSACTION_OWNERSHIP_INVALID");
  await unlink(name);
}

async function verifyBoundLock() {
  const cwdIdentity = await stat(".");
  if (!cwdIdentity.isDirectory() || String(cwdIdentity.dev) !== expectedDev || String(cwdIdentity.ino) !== expectedIno) {
    throw fixedFailure("JOURNAL_PARENT_IDENTITY_INVALID");
  }
  if (!lockHandle || !lockIdentity || !lockMetadata) throw fixedFailure("JOURNAL_LOCK_OWNERSHIP_INVALID");
  let verificationHandle;
  try {
    const descriptorIdentity = await lockHandle.stat();
    const pathIdentity = await lstat(lockBasename);
    verificationHandle = await open(lockBasename, constants.O_RDONLY | noFollow);
    const verificationIdentity = await verificationHandle.stat();
    const stored = JSON.parse(await verificationHandle.readFile("utf8"));
    if (!descriptorIdentity.isFile() || !pathIdentity.isFile() || pathIdentity.isSymbolicLink() ||
        (descriptorIdentity.mode & 0o777) !== 0o600 || (pathIdentity.mode & 0o777) !== 0o600 ||
        !sameIdentity(descriptorIdentity, lockIdentity) || !sameIdentity(pathIdentity, lockIdentity) ||
        !sameIdentity(verificationIdentity, lockIdentity) || JSON.stringify(stored) !== JSON.stringify(lockMetadata)) {
      throw fixedFailure("JOURNAL_LOCK_OWNERSHIP_INVALID");
    }
  } finally {
    await verificationHandle?.close().catch(() => {});
  }
}

async function verifyLock() {
  await checkVisibleParent();
  await verifyBoundLock();
}

function validateLockMetadata(metadata) {
  if (!exactKeys(metadata, ["created_at", "instance_id", "pid"]) || !Number.isSafeInteger(metadata.pid) ||
      metadata.pid <= 0 || typeof metadata.instance_id !== "string" || typeof metadata.created_at !== "string") {
    throw fixedFailure("JOURNAL_LOCK_METADATA_INVALID");
  }
}

async function acquireLock(metadata, adopt = false) {
  validateLockMetadata(metadata);
  await checkVisibleParent();
  let handle;
  try {
    handle = await open(lockBasename, (adopt ? constants.O_RDONLY : constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY) |
      noFollow, 0o600);
    const identity = await handle.stat();
    if (!identity.isFile() || (identity.mode & 0o777) !== 0o600) throw fixedFailure("JOURNAL_LOCK_METADATA_INVALID");
    if (adopt) {
      const stored = JSON.parse(await handle.readFile("utf8"));
      if (JSON.stringify(stored) !== JSON.stringify(metadata)) throw fixedFailure("JOURNAL_LOCK_OWNERSHIP_INVALID");
    } else {
      await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
      await handle.sync();
      await syncDirectory();
    }
    lockHandle = handle;
    lockIdentity = identity;
    lockMetadata = metadata;
    return { dev: String(identity.dev), ino: String(identity.ino) };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (!adopt && error?.code === "EEXIST") throw fixedFailure("JOURNAL_LOCK_HELD_MANUAL_INVESTIGATION_REQUIRED");
    throw error;
  }
}

function send(message) {
  if (process.connected) process.send(message);
}

async function stage(requestId, name, pauseStages) {
  if (!pauseStages.includes(name)) return;
  const key = `${requestId}:${name}`;
  const proceed = await new Promise((resolve) => {
    stageWaiters.set(key, resolve);
    send({ type: "stage", request_id: requestId, stage: name });
  });
  if (!proceed) throw fixedFailure("JOURNAL_SAVE_ABORTED");
}

async function createExclusiveFile(name, bytes) {
  let handle;
  try {
    handle = await open(name, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function replaceTransactionRecord(record) {
  const encoded = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
  const temporary = `${transactionBasename}.${record.transaction_id}.tmp`;
  await createExclusiveFile(temporary, encoded);
  await rename(temporary, transactionBasename);
  await syncDirectory();
}

function transactionNames(transactionId) {
  return {
    journalTemporary: `${journalBasename}.${transactionId}.journal.tmp`,
    journalBackup: `${journalBasename}.${transactionId}.journal.rollback`,
    sidecarTemporary: `${journalBasename}.${transactionId}.sidecar.tmp`,
    sidecarBackup: `${journalBasename}.${transactionId}.sidecar.rollback`,
  };
}

function validateTransactionRecord(record) {
  if (!exactKeys(record, ["schema_version", "transaction_id", "state", "journal", "sidecar"]) ||
      record.schema_version !== 1 || !validTransactionId(record.transaction_id) ||
      !new Set(["PREPARING", "PREPARED_AFTER_RENAME", "COMMIT_ACKNOWLEDGED"]).has(record.state)) {
    throw fixedFailure("JOURNAL_TRANSACTION_RECORD_INVALID");
  }
  const names = transactionNames(record.transaction_id);
  if (!exactKeys(record.journal, ["canonical", "prior_backup", "new_temporary", "prior_sha256", "new_sha256"]) ||
      record.journal.canonical !== journalBasename || record.journal.prior_backup !== names.journalBackup ||
      record.journal.new_temporary !== names.journalTemporary || !validHash(record.journal.new_sha256) ||
      !(record.journal.prior_sha256 === null || validHash(record.journal.prior_sha256))) {
    throw fixedFailure("JOURNAL_TRANSACTION_RECORD_INVALID");
  }
  if (record.sidecar !== null) {
    if (!exactKeys(record.sidecar, ["canonical", "prior_canonical", "prior_backup", "new_temporary", "prior_sha256", "new_sha256"]) ||
        !validBasename(record.sidecar.canonical) ||
        !(record.sidecar.prior_canonical === null || validBasename(record.sidecar.prior_canonical)) ||
        record.sidecar.prior_backup !== names.sidecarBackup || record.sidecar.new_temporary !== names.sidecarTemporary ||
        !validHash(record.sidecar.new_sha256) ||
        ((record.sidecar.prior_canonical === null) !== (record.sidecar.prior_sha256 === null)) ||
        !(record.sidecar.prior_sha256 === null || validHash(record.sidecar.prior_sha256))) {
      throw fixedFailure("JOURNAL_TRANSACTION_RECORD_INVALID");
    }
  }
  return record;
}

async function readTransactionRecord() {
  const stored = await readOptional(transactionBasename, { mode0600: true });
  if (!stored) return null;
  let record;
  try {
    record = JSON.parse(stored.bytes.toString("utf8"));
  } catch {
    throw fixedFailure("JOURNAL_TRANSACTION_RECORD_INVALID");
  }
  return validateTransactionRecord(record);
}

function priorSidecarFromJournal(bytes) {
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    const evaluator = parsed?.status === "COMPLETED" ? parsed?.state?.evaluator_evidence : null;
    if (evaluator && validBasename(evaluator.sidecar_basename) && validHash(evaluator.sidecar_sha256) &&
        Number.isSafeInteger(evaluator.sidecar_byte_length) && evaluator.sidecar_byte_length > 0) {
      return { basename: evaluator.sidecar_basename, sha256: evaluator.sidecar_sha256,
        byteLength: evaluator.sidecar_byte_length };
    }
  } catch {}
  return null;
}

async function restoreEntry(entry) {
  const canonical = await readOptional(entry.canonical, { mode0600: true });
  const backup = await readOptional(entry.prior_backup, { mode0600: true });
  if (entry.prior_sha256 === null) {
    if (backup) throw fixedFailure("JOURNAL_TRANSACTION_OWNERSHIP_INVALID");
    if (canonical) {
      if (sha256(canonical.bytes) !== entry.new_sha256) throw fixedFailure("JOURNAL_TRANSACTION_OWNERSHIP_INVALID");
      await unlink(entry.canonical);
    }
    return;
  }
  if (canonical && sha256(canonical.bytes) === entry.prior_sha256) {
    if (backup) await removeKnown(entry.prior_backup, entry.prior_sha256);
    return;
  }
  if (!backup || sha256(backup.bytes) !== entry.prior_sha256 ||
      (canonical && sha256(canonical.bytes) !== entry.new_sha256)) {
    throw fixedFailure("JOURNAL_TRANSACTION_OWNERSHIP_INVALID");
  }
  await rename(entry.prior_backup, entry.canonical);
}

async function recoverTransaction({ boundOnly = false } = {}) {
  if (boundOnly) await verifyBoundLock();
  else await verifyLock();
  const record = await readTransactionRecord();
  if (!record) return { outcome: "none" };
  const names = transactionNames(record.transaction_id);
  if (record.state === "COMMIT_ACKNOWLEDGED") {
    const journal = await readRegular(record.journal.canonical, { mode0600: true });
    if (sha256(journal.bytes) !== record.journal.new_sha256) throw fixedFailure("JOURNAL_TRANSACTION_OWNERSHIP_INVALID");
    if (record.sidecar) {
      const sidecar = await readRegular(record.sidecar.canonical, { mode0600: true });
      if (sha256(sidecar.bytes) !== record.sidecar.new_sha256) throw fixedFailure("JOURNAL_TRANSACTION_OWNERSHIP_INVALID");
      if (record.sidecar.prior_canonical && record.sidecar.prior_canonical !== record.sidecar.canonical) {
        await removeKnown(record.sidecar.prior_canonical, record.sidecar.prior_sha256);
      }
      if (record.sidecar.prior_sha256) await removeKnown(record.sidecar.prior_backup, record.sidecar.prior_sha256);
    }
    if (record.journal.prior_sha256) await removeKnown(record.journal.prior_backup, record.journal.prior_sha256);
    await removeKnown(names.journalTemporary, record.journal.new_sha256);
    if (record.sidecar) await removeKnown(names.sidecarTemporary, record.sidecar.new_sha256);
    await unlink(transactionBasename);
    await syncDirectory();
    return { outcome: "committed", transaction_id: record.transaction_id };
  }

  await restoreEntry(record.journal);
  if (record.sidecar) {
    if (record.sidecar.prior_canonical && record.sidecar.prior_canonical !== record.sidecar.canonical) {
      const newCanonical = await readOptional(record.sidecar.canonical, { mode0600: true });
      if (newCanonical) {
        if (sha256(newCanonical.bytes) !== record.sidecar.new_sha256) {
          throw fixedFailure("JOURNAL_TRANSACTION_OWNERSHIP_INVALID");
        }
        await unlink(record.sidecar.canonical);
      }
      const prior = await readRegular(record.sidecar.prior_canonical, { mode0600: true });
      if (sha256(prior.bytes) !== record.sidecar.prior_sha256) throw fixedFailure("JOURNAL_TRANSACTION_OWNERSHIP_INVALID");
      if (await readOptional(record.sidecar.prior_backup, { mode0600: true })) {
        await removeKnown(record.sidecar.prior_backup, record.sidecar.prior_sha256);
      }
    } else {
      await restoreEntry({ canonical: record.sidecar.canonical, prior_backup: record.sidecar.prior_backup,
        prior_sha256: record.sidecar.prior_sha256, new_sha256: record.sidecar.new_sha256 });
    }
    await removeKnown(names.sidecarTemporary, record.sidecar.new_sha256);
  }
  await removeKnown(names.journalTemporary, record.journal.new_sha256);
  await unlink(transactionBasename);
  await syncDirectory();
  return { outcome: "rolled_back", transaction_id: record.transaction_id };
}

async function readJournal() {
  await verifyLock();
  await recoverTransaction();
  const stored = await readOptional(journalBasename, { mode0600: true });
  return stored ? { exists: true, contents: stored.bytes.toString("utf8") } : { exists: false, contents: null };
}

async function readSidecar(name) {
  await verifyLock();
  const stored = await readRegular(name, { mode0600: true });
  return { hex: stored.bytes.toString("hex"), byte_length: stored.bytes.length, sha256: sha256(stored.bytes) };
}

async function saveJournal(requestId, transactionId, journal, sidecar, pauseStages) {
  await verifyLock();
  if (!validTransactionId(transactionId)) throw fixedFailure("JOURNAL_TRANSACTION_ID_INVALID");
  if (await readTransactionRecord()) throw fixedFailure("JOURNAL_TRANSACTION_INCOMPLETE");
  let journalBytes;
  try {
    journalBytes = Buffer.from(`${JSON.stringify(journal, null, 2)}\n`, "utf8");
  } catch {
    throw fixedFailure("JOURNAL_SERIALIZATION_FAILED");
  }
  let sidecarBytes = null;
  if (sidecar !== null && sidecar !== undefined) {
    if (!exactKeys(sidecar, ["basename", "hex", "sha256", "byte_length"]) || !validBasename(sidecar.basename) ||
        typeof sidecar.hex !== "string" || !/^(?:[0-9a-f]{2})+$/.test(sidecar.hex) || !validHash(sidecar.sha256) ||
        !Number.isSafeInteger(sidecar.byte_length) || sidecar.byte_length <= 0) throw fixedFailure("EVALUATOR_SIDECAR_INVALID");
    sidecarBytes = Buffer.from(sidecar.hex, "hex");
    if (sidecarBytes.length !== sidecar.byte_length || sha256(sidecarBytes) !== sidecar.sha256) {
      throw fixedFailure("EVALUATOR_SIDECAR_INVALID");
    }
  }
  const currentJournal = await readOptional(journalBasename, { mode0600: true });
  const priorSidecarMetadata = currentJournal ? priorSidecarFromJournal(currentJournal.bytes) : null;
  let priorSidecar = null;
  if (priorSidecarMetadata) {
    priorSidecar = await readRegular(priorSidecarMetadata.basename, { mode0600: true });
    if (priorSidecar.bytes.length !== priorSidecarMetadata.byteLength ||
        sha256(priorSidecar.bytes) !== priorSidecarMetadata.sha256) throw fixedFailure("EVALUATOR_SIDECAR_INVALID");
  }
  const names = transactionNames(transactionId);
  const record = validateTransactionRecord({
    schema_version: 1,
    transaction_id: transactionId,
    state: "PREPARING",
    journal: { canonical: journalBasename, prior_backup: names.journalBackup,
      new_temporary: names.journalTemporary, prior_sha256: currentJournal ? sha256(currentJournal.bytes) : null,
      new_sha256: sha256(journalBytes) },
    sidecar: sidecarBytes ? { canonical: sidecar.basename,
      prior_canonical: priorSidecarMetadata?.basename ?? null, prior_backup: names.sidecarBackup,
      new_temporary: names.sidecarTemporary, prior_sha256: priorSidecar ? sha256(priorSidecar.bytes) : null,
      new_sha256: sha256(sidecarBytes) } : null,
  });
  const transactionRecordTemporary = `${transactionBasename}.${transactionId}.tmp`;
  await createExclusiveFile(transactionRecordTemporary, Buffer.from(`${JSON.stringify(record)}\n`, "utf8"));
  await rename(transactionRecordTemporary, transactionBasename);
  await syncDirectory();
  await stage(requestId, "after_transaction_record", pauseStages);
  await verifyLock();
  await createExclusiveFile(names.journalTemporary, journalBytes);
  if (sidecarBytes) await createExclusiveFile(names.sidecarTemporary, sidecarBytes);
  if (currentJournal) await link(journalBasename, names.journalBackup);
  if (priorSidecar) await link(priorSidecarMetadata.basename, names.sidecarBackup);
  await syncDirectory();
  await stage(requestId, "after_backup_creation", pauseStages);
  await verifyLock();
  if (sidecarBytes) {
    await rename(names.sidecarTemporary, sidecar.basename);
    await syncDirectory();
    await stage(requestId, "after_sidecar_rename", pauseStages);
    await verifyLock();
  }
  await rename(names.journalTemporary, journalBasename);
  await syncDirectory();
  await stage(requestId, "after_journal_rename", pauseStages);
  await verifyLock();
  record.state = "PREPARED_AFTER_RENAME";
  await replaceTransactionRecord(record);
  const commitPromise = new Promise((resolve) => commitWaiters.set(`${requestId}:${transactionId}`, resolve));
  send({ type: "prepared_after_rename", request_id: requestId, transaction_id: transactionId,
    helper_pid: process.pid, parent_dev: expectedDev, parent_ino: expectedIno,
    lock_dev: String(lockIdentity.dev), lock_ino: String(lockIdentity.ino) });
  await stage(requestId, "after_prepared_notification", pauseStages);
  await verifyLock();
  const committed = await commitPromise;
  if (!committed) throw fixedFailure("JOURNAL_COMMIT_ACK_INVALID");
  record.state = "COMMIT_ACKNOWLEDGED";
  await replaceTransactionRecord(record);
  await stage(requestId, "after_commit_acknowledged", pauseStages);
  if (record.sidecar?.prior_canonical && record.sidecar.prior_canonical !== record.sidecar.canonical) {
    await removeKnown(record.sidecar.prior_canonical, record.sidecar.prior_sha256);
  }
  if (currentJournal) await removeKnown(names.journalBackup, record.journal.prior_sha256);
  if (priorSidecar) await removeKnown(names.sidecarBackup, record.sidecar.prior_sha256);
  await unlink(transactionBasename);
  await syncDirectory();
  return { transaction_id: transactionId };
}

async function releaseLock() {
  await verifyLock();
  if (await readTransactionRecord()) throw fixedFailure("JOURNAL_TRANSACTION_INCOMPLETE");
  const current = await lstat(lockBasename);
  if (!sameIdentity(current, lockIdentity)) throw fixedFailure("JOURNAL_LOCK_RELEASE_FAILED");
  await unlink(lockBasename);
  await syncDirectory();
  await lockHandle.close();
  lockHandle = undefined;
  lockIdentity = undefined;
  lockMetadata = undefined;
}

async function dispatch(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || !Number.isSafeInteger(message.request_id)) {
    throw fixedFailure("JOURNAL_HELPER_IPC_INVALID");
  }
  if (message.type === "acquire") return acquireLock(message.metadata, false);
  if (message.type === "adopt") return acquireLock(message.metadata, true);
  if (message.type === "verify") return verifyLock().then(() => true);
  if (message.type === "recover") return recoverTransaction();
  if (message.type === "recover_bound") return recoverTransaction({ boundOnly: true });
  if (message.type === "read") return readJournal();
  if (message.type === "read_sidecar") return readSidecar(message.basename);
  if (message.type === "save") return saveJournal(message.request_id, message.transaction_id, message.journal,
    message.sidecar, message.pause_stages ?? []);
  if (message.type === "release") return releaseLock().then(() => true);
  throw fixedFailure("JOURNAL_HELPER_IPC_INVALID");
}

process.on("message", (message) => {
  if (message?.type === "continue" || message?.type === "abort") {
    const waiter = stageWaiters.get(`${message.request_id}:${message.stage}`);
    if (waiter) {
      stageWaiters.delete(`${message.request_id}:${message.stage}`);
      waiter(message.type === "continue");
    }
    return;
  }
  if (message?.type === "commit" && validTransactionId(message.transaction_id)) {
    const waiter = commitWaiters.get(`${message.request_id}:${message.transaction_id}`);
    if (waiter) {
      commitWaiters.delete(`${message.request_id}:${message.transaction_id}`);
      waiter(true);
    }
    return;
  }
  running = running.then(async () => {
    try {
      const result = await dispatch(message);
      send({ type: "response", request_id: message.request_id, ok: true, result });
    } catch (error) {
      send({ type: "response", request_id: message?.request_id, ok: false,
        code: typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "JOURNAL_HELPER_OPERATION_FAILED" });
    }
  });
});

try {
  if (!validBasename(journalBasename) || !validBasename(lockBasename) || !validBasename(transactionBasename) ||
      lockBasename !== `${journalBasename}.lock` || typeof visibleParent !== "string" ||
      typeof canonicalParent !== "string" || !/^\d+$/.test(expectedDev) || !/^\d+$/.test(expectedIno)) {
    throw fixedFailure("JOURNAL_HELPER_CONFIG_INVALID");
  }
  await checkVisibleParent();
  send({ type: "ready" });
} catch {
  send({ type: "startup_failed", code: "JOURNAL_HELPER_STARTUP_FAILED" });
  process.exitCode = 1;
}
