import type { ReceiptCheckResult } from "./receipt-classifier";

export type RetryTransactionRequest = {
  submit: unknown;
  checkReceipt: (hash: string) => Promise<ReceiptCheckResult>;
};

export type RetryTransactionResult =
  | { kind: "invalid_scope" }
  | { kind: "receipt"; receipt: ReceiptCheckResult; confirmed: false }
  | {
      kind: "receipt";
      receipt: Extract<ReceiptCheckResult, { kind: "executed" }>;
      confirmed: boolean;
    };

export async function retryExistingTransaction({
  hash,
  request,
  scopeIsCurrent,
  onExecuted,
}: {
  hash: string;
  request: RetryTransactionRequest;
  scopeIsCurrent: () => boolean;
  onExecuted: () => Promise<boolean>;
}): Promise<RetryTransactionResult> {
  if (!scopeIsCurrent()) return { kind: "invalid_scope" };
  const receipt = await request.checkReceipt(hash);
  if (!scopeIsCurrent()) return { kind: "invalid_scope" };
  if (receipt.kind !== "executed") {
    return { kind: "receipt", receipt, confirmed: false };
  }
  return {
    kind: "receipt",
    receipt,
    confirmed: await onExecuted(),
  };
}
