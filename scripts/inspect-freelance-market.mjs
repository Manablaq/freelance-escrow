import { pathToFileURL } from "node:url";
import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import { SUCCESS_RESULTS } from "./genlayer-transaction-outcomes.mjs";

const TRANSACTION_HASH =
  "0x22bc4de3aec4c628914e6e6fcd18485c0e0e5afd27d0838065e508aa4f58b107";
const CONTRACT_ADDRESS = "0x881880971282774b6d83264d10EDDD8246576b88";

const client = createClient({ chain: testnetBradbury });

function parseJsonView(name, value) {
  if (typeof value !== "string") {
    throw new Error(`${name} returned ${typeof value}, expected a JSON string`);
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} returned invalid JSON: ${error.message}`);
  }
}

function validatorVotes(transaction) {
  const validators = transaction.lastRound?.roundValidators ?? [];
  const votes = transaction.lastRound?.validatorVotesName ?? [];
  return validators.map((validator, index) => ({
    validator,
    vote: votes[index] ?? "UNKNOWN",
  }));
}

export function isSuccessfulDeploymentOutcome(transaction) {
  return (
    (transaction.statusName === TransactionStatus.ACCEPTED ||
      transaction.statusName === TransactionStatus.FINALIZED) &&
    SUCCESS_RESULTS.has(transaction.resultName) &&
    transaction.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN
  );
}

async function main() {
  const transaction = await client.getTransaction({ hash: TRANSACTION_HASH });
  const recipient = transaction.recipient ?? transaction.to_address;

  console.log(`Transaction hash: ${TRANSACTION_HASH}`);
  console.log(`Status name: ${transaction.statusName ?? "UNKNOWN"}`);
  console.log(`Result name: ${transaction.resultName ?? "UNKNOWN"}`);
  console.log(
    `Execution result name: ${transaction.txExecutionResultName ?? "UNKNOWN"}`,
  );
  console.log(`Recipient/contract address: ${recipient ?? "UNKNOWN"}`);
  console.log("Validator votes:");
  console.log(JSON.stringify(validatorVotes(transaction), null, 2));

  if (transaction.statusName === "FINALIZED") {
    console.log("Finality: FINALIZED");
  } else if (transaction.statusName === "ACCEPTED") {
    console.log("Finality: ACCEPTED (not FINALIZED)");
  } else {
    console.log(`Finality: neither ACCEPTED nor FINALIZED (${transaction.statusName})`);
  }

  if (recipient?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error(
      `Deployment recipient mismatch: expected ${CONTRACT_ADDRESS}, received ${recipient}`,
    );
  }
  if (transaction.statusName !== TransactionStatus.ACCEPTED &&
      transaction.statusName !== TransactionStatus.FINALIZED) {
    throw new Error(
      `Deployment status is ${transaction.statusName}, not ACCEPTED or FINALIZED`,
    );
  }
  if (transaction.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
    throw new Error(
      `Deployment execution is ${transaction.txExecutionResultName}, not FINISHED_WITH_RETURN`,
    );
  }
  if (!SUCCESS_RESULTS.has(transaction.resultName)) {
    throw new Error(
      `Deployment consensus is ${transaction.resultName}, not AGREE or MAJORITY_AGREE`,
    );
  }

  const [statsRaw, freelancersRaw] = await Promise.all([
    client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_stats",
      args: [],
    }),
    client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_all_freelancers",
      args: [],
    }),
  ]);

  const stats = parseJsonView("get_stats", statsRaw);
  const freelancers = parseJsonView("get_all_freelancers", freelancersRaw);
  console.log("get_stats:");
  console.log(JSON.stringify(stats, null, 2));
  console.log("get_all_freelancers:");
  console.log(JSON.stringify(freelancers, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
    console.error(`Inspection failed: ${error.message}`);
    process.exitCode = 1;
  });
