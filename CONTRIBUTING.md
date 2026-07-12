# Contributing to FreelanceMarket

FreelanceMarket is a public testnet project. Contributions should keep source, tests, deployment facts, and documentation aligned.

## Setup

1. Install Node.js 20.9 or newer, Python 3, and npm.
2. Run `npm ci` from the repository root.
3. Optionally copy `.env.example` to `.env.local`. The checked-in contract fallback already targets the current Bradbury deployment.
4. Run `npm run dev` for local development.

Never put wallet credentials, private keys, seed phrases, or API secrets in an environment example, issue, pull request, test fixture, or smoke journal.

## Branching and pull requests

Create a focused branch from `main`, keep commits reviewable, and open a pull request using the repository template. Do not mix frontend redesigns, contract behavior changes, deployments, and documentation cleanup into one change without explaining each scope.

## Validation

Run the complete offline validation before requesting review:

```bash
npm run check
git diff --check
```

`npm run check` runs ESLint, a production Next.js build, Node transaction/tooling tests, and Python contract/review tests. Funded-wallet and smoke commands are not part of this command because they can perform blockchain writes.

## Contract safety rules

- Treat `contracts/freelance_market.py` as settlement-critical code.
- Do not change contract behavior, its pinned dependency, deployment address, deployment transaction, network, or chain ID as a side effect of another task.
- Add or update focused tests for any intentional contract change.
- Recompute and document the source hash only after review and deployment verification; a source edit does not update an existing deployment.
- Never run deployment or write-capable smoke scripts without explicit authorization and funded testnet-wallet controls.

## Documentation expectations

Document current behavior from source. Distinguish accepted transaction status, successful structured execution, expected accepted-state synchronization, and finalization. Label historical diagnostics and unverified manual procedures clearly. Avoid guarantees about AI judgment, fairness, payment, security, or mainnet readiness.

## Pull-request checklist

- [ ] Scope is focused and described.
- [ ] `npm run check` passes.
- [ ] `git diff --check` passes.
- [ ] Tests cover behavior changes.
- [ ] Public links, addresses, status names, and commands are accurate.
- [ ] Manual QA is recorded with auditable evidence or remains marked unverified.
- [ ] No secrets, local paths, generated output, or temporary QA artifacts are tracked.
- [ ] No deployment, commit, or push was performed unintentionally.
