import {
  ExecutionResult,
  TransactionStatus,
  type GenLayerTransaction,
} from "genlayer-js/types";

export type ReceiptCheckResult =
  | { kind: "executed"; hash: string; receipt: GenLayerTransaction }
  | { kind: "processing"; hash: string; status?: TransactionStatus }
  | {
      kind: "execution_failed";
      hash: string;
      message: string;
      receipt: GenLayerTransaction;
    }
  | { kind: "canceled"; hash: string; receipt: GenLayerTransaction }
  | { kind: "undetermined"; hash: string; receipt: GenLayerTransaction }
  | { kind: "unknown"; hash: string; message: string };

const PROCESSING_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.UNINITIALIZED,
  TransactionStatus.PENDING,
  TransactionStatus.PROPOSING,
  TransactionStatus.COMMITTING,
  TransactionStatus.REVEALING,
  TransactionStatus.APPEAL_REVEALING,
  TransactionStatus.APPEAL_COMMITTING,
  TransactionStatus.READY_TO_FINALIZE,
  TransactionStatus.VALIDATORS_TIMEOUT,
  TransactionStatus.LEADER_TIMEOUT,
]);

function executionMessage(receipt: GenLayerTransaction) {
  const structuredError = receipt.consensus_data?.leader_receipt?.find(
    (leaderReceipt) => leaderReceipt.error,
  )?.error;
  return structuredError
    ? `Contract execution error: ${structuredError.slice(0, 240)}`
    : "GenLayer accepted the transaction record, but contract execution finished with an error. No expected state change was confirmed.";
}

export function classifyReceipt(
  hash: string,
  receipt: GenLayerTransaction | null | undefined,
): ReceiptCheckResult {
  if (!receipt) {
    return {
      kind: "unknown",
      hash,
      message:
        "Your transaction was submitted, but its current status could not be retrieved. It was not reported as failed.",
    };
  }

  const status = receipt.statusName;
  const execution = receipt.txExecutionResultName;

  if (status === TransactionStatus.CANCELED) {
    return { kind: "canceled", hash, receipt };
  }
  if (status === TransactionStatus.UNDETERMINED) {
    return { kind: "undetermined", hash, receipt };
  }
  if (status && PROCESSING_STATUSES.has(status)) {
    return { kind: "processing", hash, status };
  }
  if (execution === ExecutionResult.FINISHED_WITH_ERROR) {
    return {
      kind: "execution_failed",
      hash,
      message: executionMessage(receipt),
      receipt,
    };
  }
  if (
    (status === TransactionStatus.ACCEPTED ||
      status === TransactionStatus.FINALIZED) &&
    execution === ExecutionResult.FINISHED_WITH_RETURN
  ) {
    return { kind: "executed", hash, receipt };
  }

  return execution === ExecutionResult.NOT_VOTED || !execution
    ? { kind: "processing", hash, status }
    : {
        kind: "unknown",
        hash,
        message:
          "Your transaction was submitted, but its current status could not be retrieved. It was not reported as failed.",
      };
}

export function shouldConfirmExpectedState(
  result: ReceiptCheckResult,
): result is Extract<ReceiptCheckResult, { kind: "executed" }> {
  return result.kind === "executed";
}

export async function checkReceiptUsingStructuredReads(
  hash: string,
  waitForReceipt: (hash: string) => Promise<GenLayerTransaction>,
  getTransaction: (hash: string) => Promise<GenLayerTransaction>,
): Promise<ReceiptCheckResult> {
  try {
    return classifyReceipt(hash, await waitForReceipt(hash));
  } catch {
    try {
      return classifyReceipt(hash, await getTransaction(hash));
    } catch {
      return classifyReceipt(hash, undefined);
    }
  }
}
