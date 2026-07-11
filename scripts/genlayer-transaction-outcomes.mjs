import { TransactionResult } from "genlayer-js/types";

export const SUCCESS_RESULTS = new Set([
  TransactionResult.AGREE,
  TransactionResult.MAJORITY_AGREE,
]);
