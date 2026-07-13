# FreelanceMarket

[![Repository Validation](https://github.com/Manablaq/freelance-escrow/actions/workflows/ci.yml/badge.svg)](https://github.com/Manablaq/freelance-escrow/actions/workflows/ci.yml)
![Network: Bradbury Testnet](https://img.shields.io/badge/network-Bradbury%20testnet-7164ff)

FreelanceMarket is an on-chain freelance escrow application on GenLayer Bradbury for wallet profiles, funded jobs, public deliverables, and AI-assisted deliverable verification.

[Open the live application](https://genmarket-escrow.vercel.app) · [View the deployed contract](https://explorer-bradbury.genlayer.com/address/0x75af88bfA0592CFA63c06f2F68BfD35C13dDd4EF)

> **Testnet warning:** FreelanceMarket runs only on GenLayer Bradbury Testnet. It is not a mainnet product, legal arbitration service, guarantee of fair outcomes, or risk-free custody system. Testnet GEN has no implied mainnet value.

## Features

- One on-chain `client` or `freelancer` profile per wallet, with profile updates that preserve the original role.
- Public freelancer marketplace, public profile pages, role-aware dashboards, and direct job assignment.
- Contract-held GEN funding with explicit `OPEN`, `FUNDED`, `SUBMITTED`, `PAID`, `DISPUTED`, `REFUNDED`, and `CANCELLED` states.
- Public deliverable URLs evaluated through GenLayer's nondeterministic web and prompt facilities.
- Structured receipt classification that separates successful execution from acceptance alone.
- Expected accepted-state polling, existing-hash retry, scope cancellation, and automatic dependent-data refresh without a browser reload.
- Allowlisted frontend writes and an allowlisted, argument-validated server read route fixed to the configured deployment.

## Workflows

### Client

1. Register the wallet as a client.
2. Select a registered freelancer and create a job.
3. Fund the `OPEN` job by attaching GEN to `fund_job`.
4. Review the freelancer's public deliverable after submission.
5. Initiate `verify_and_release`; this action is never triggered automatically by the frontend.
6. After successful structured execution, wait for the expected accepted contract state. An approved result produces `PAID`; a rejected result produces `DISPUTED`.
7. Use `client_refund` for a `FUNDED` or `DISPUTED` job, or `cancel_job` for an unfunded `OPEN` job when appropriate.

### Freelancer

1. Register the wallet as a freelancer and maintain its public profile.
2. Receive jobs assigned by registered clients.
3. After a client funds a job, submit one publicly accessible HTTP(S) deliverable URL.
4. Track the client-initiated verification result and accepted job state from the dashboard or job page.

## Job lifecycle

```mermaid
stateDiagram-v2
  [*] --> OPEN: create_job
  OPEN --> FUNDED: fund_job
  OPEN --> CANCELLED: cancel_job
  FUNDED --> SUBMITTED: submit_work
  FUNDED --> REFUNDED: client_refund
  SUBMITTED --> PAID: verify_and_release / approved
  SUBMITTED --> DISPUTED: verify_and_release / rejected
  DISPUTED --> REFUNDED: client_refund
```

Only the assigned client can fund, verify, refund, or cancel within the contract's status rules. Only the assigned freelancer can submit work. There are no admin methods or admin powers.

## AI-assisted deliverable verification

The client initiates `verify_and_release`. Validators receive explicit serialized job context, fetch bounded content from the public deliverable URL, treat webpage instructions as untrusted, and semantically compare the evidence with the requested work. The evaluator returns a bounded structured approval value, score, reason, and evidence summary; malformed, inaccessible, empty, or insufficient evidence fails closed.

The semantic-consensus review fix requires validator agreement on the settlement-relevant approval value, valid 0–100 scores within ten points, and a score of at least 70 for approval. Reasons and summaries may differ. The closure-serialization review fix moves nondeterministic evaluation to a module-level helper and binds only an explicit serialized JSON context, rather than closing over contract storage, `self`, or a method-local job record.

AI-assisted verification is probabilistic validator judgment over public evidence. It is not objective truth, legal arbitration, or a guarantee of fairness. URL availability, prompt/provider behavior, validator consensus, job specificity, and evidence quality remain trust assumptions.

## Deployed-source verification

**The deployed Bradbury contract at `0x75af88bfA0592CFA63c06f2F68BfD35C13dDd4EF` matches `contracts/freelance_market.py`.**

- Verified source SHA-256: `941104a3374f893c51a60281cdb942272b09bbe433e970e4f86baf3f4b73a08f`
- Deployment transaction: `0x27a83352d39feda126c0d122a3e3223c238708c99f75bfddbb3bf280283902b1`
- Professional frontend baseline commit: `880bce5`
- Network: GenLayer Bradbury Testnet, chain ID `4221`
- RPC: `https://rpc-bradbury.genlayer.com`

See [Deployment reference](docs/DEPLOYMENT.md) and [Hosted Studio full-flow evidence](docs/HOSTED_STUDIO_FULL_TEST_EVIDENCE.md).

## Transaction synchronization

Writes use an optimistic, non-blocking lifecycle. The page owns preparation and
wallet signing only. As soon as a hash exists, a versioned serializable pending
record is stored, the conflicting action is disabled, and the app remains
navigable. A global provider continues receipt checks across route changes and
refreshes with exponential backoff from 2 seconds to a 10-second maximum.

Pending records use `freelance-market:pending-transactions:v1` with the shape
`{ version: 1, transactions: [...] }`. Every entry includes chain ID, deployed
contract, and wallet. Other-wallet entries remain persisted but paused.

Acceptance is not success: processing/timeouts stay pending,
`FINISHED_WITH_ERROR` fails even with `ACCEPTED`, and only
`FINISHED_WITH_RETURN` advances to a method-specific expected-state read.
Registration shows the submitted form as Pending with its hash and explorer
link until the profile read proves the role and existence.

```text
Wallet request
→ transaction hash
→ structured receipt processing
→ successful execution result
→ expected accepted-state confirmation
→ dependent data refresh
→ confirmed UI state
```

The frontend requires an `ACCEPTED` or `FINALIZED` structured receipt together with `FINISHED_WITH_RETURN` before it starts action-specific state confirmation. Acceptance paired with `FINISHED_WITH_ERROR` is an execution failure, not success. Processing, unknown receipt, canceled, undetermined, execution-error, and accepted-state synchronization-timeout states remain distinct.

Confirmation reads accepted contract state and checks the exact expected transition. Scope versioning and `AbortSignal` propagation stop stale wallet/page requests from updating a new scope. Retrying a pending or unknown transaction checks the existing hash and does not resubmit the wallet write. A global refresh event and deduplicated page polling then update affected profile, job, and statistics views without requiring a manual browser reload.

See [Transaction and accepted-state lifecycle](docs/TRANSACTION_LIFECYCLE.md).

## Architecture

The frontend uses the Next.js App Router. Interactive pages submit allowlisted writes client-side with the connected wallet. `app/api/contract/route.ts` performs read-only Bradbury calls with no account, accepts only six known view methods, validates method-specific address/job arguments, targets the configured contract, requests accepted state, disables caching, and exposes no arbitrary contract call surface.

See [Architecture](docs/ARCHITECTURE.md) for routes, roles, allowlists, state transitions, cancellation, polling, and refresh behavior.

### Technology stack

- Next.js 16.2 and React 19
- TypeScript 5
- `genlayer-js` 1.1
- wagmi 3, viem 2, RainbowKit 2, and TanStack Query 5
- GenLayer intelligent contract in Python
- ESLint 9 and Node's built-in test runner
- Python `unittest`, with optional environment-dependent Direct Mode diagnostics

### Repository structure

```text
app/          App Router pages and the allowlisted contract-read Route Handler
components/   Shared shell, navigation, transaction, modal, and status UI
hooks/        Polling and transaction/accepted-state synchronization
lib/          Deployment config, GenLayer client, receipts, retry, and scope guards
contracts/    FreelanceMarket intelligent contract source
scripts/      Read-only deployment inspection and explicitly invoked smoke tooling
tests/        Node and Python offline/review suites plus Direct Mode diagnostics
docs/         Architecture, lifecycle, deployment, QA, diagnostics, and smoke evidence
```

## Local development

### Requirements

- Node.js 24.x (CI also uses Node 24)
- npm
- Python 3 for the standard Python suite
- A browser wallet configured for Bradbury only when manually exercising wallet flows

With `nvm`, run `nvm use` from the repository root to select the Node.js version declared in `.nvmrc`.

Node.js 24 is required because the Node test suites execute erasable TypeScript source directly through Node's native type stripping.

### Installation

```bash
git clone https://github.com/Manablaq/freelance-escrow.git
cd freelance-escrow
npm ci
npm run dev
```

Use the local URL printed by Next.js. Local development does not require private keys in repository files.

### Environment configuration

The application uses these public build-time variables:

```bash
NEXT_PUBLIC_FREELANCE_MARKET_ADDRESS=0x75af88bfA0592CFA63c06f2F68BfD35C13dDd4EF
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_from_walletconnect_cloud
```

The WalletConnect value above is an example label, not a literal valid project ID; replace it with the real value from WalletConnect Cloud. `NEXT_PUBLIC_FREELANCE_MARKET_ADDRESS` is optional: if omitted, `lib/config.ts` uses the same verified address. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is required to enable WalletConnect-based connectors. Vercel must receive it for both preview and production deployments.

Both variables are browser-visible and fixed at build time; neither is a private secret. If the WalletConnect value is absent, the application deliberately configures only an injected browser-wallet connector so local and CI builds remain usable without a fake project ID. WalletConnect production reliability is not verified until a real value is configured in Vercel and tested.

Never store private keys, seed phrases, wallet credentials, Vercel tokens, GitHub tokens, or API secrets in `.env.example` or tracked files.

## npm scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Next.js development server |
| `npm run build` | Create a production Next.js build |
| `npm run start` | Serve an existing production build |
| `npm run lint` | Run ESLint |
| `npm run test:node` | Run all `tests/*.test.mjs` suites |
| `npm run test:python` | Discover and run Python `unittest` suites |
| `npm test` | Run Node and Python suites |
| `npm run check:frontend` | Run lint and production build |
| `npm run check` | Run lint, build, Node tests, and Python tests |
| `npm run inspect:deployment` | Read deployment receipt and accepted contract state |
| `npm run smoke:approval` | Run the write-capable, resumable approval smoke tool |
| `npm run smoke:rejection` | Run the write-capable, resumable rejection smoke tool |

The smoke commands can load wallet keys and write to Bradbury. They are intentionally excluded from `npm test`, `npm run check`, and CI; do not run them without explicit authorization and controlled testnet credentials.

## Testing and QA

```bash
npm run test:node
npm run test:python
npm run lint
npm run build
npm run check
```

The Node suites cover structured receipt outcomes, the rule that accepted status alone is insufficient, RPC fallback/unknown classification, expected-state gating, existing-hash retry without resubmission, scope invalidation, and extensive resumable smoke-tool safety/accounting checks.

The standard Python discovery suite covers semantic evaluation, fail-closed evidence handling, closure serialization structure, repeated-verification protection, semantic consensus wording, bounded smoke evidence, secret/local-reference exclusion, and the offline smoke tooling suite.

`tests/test_verify_and_release_diagnostics.py` contains additional pytest/`genlayer-test` Direct Mode diagnostics. Standard `unittest` discovery reports it as skipped unless Python 3.12+, pytest, and the compatible Direct Mode plugin are installed. The recorded environment limitation also prevents the pinned SDK's comparative validator template from being treated as a passing consensus diagnostic. A skip is not a pass.

### Browser QA

A local Chromium QA pass was completed on 2026-07-12 with Playwright 1.55.0 and Chromium 140.0.7339.16. It covered 40 route/viewport combinations, interaction/accessibility checks, transaction UI states, and contract API behavior with no recorded overflow, console errors/warnings, uncaught exceptions, or failed requests. See [Completed local browser QA](docs/BROWSER_QA.md) for the exact scope and evidence boundary.

This was not a committed or continuously running browser automation suite. Its screenshots and reports remained under ignored `.qa/` storage and are not tracked repository evidence. No funded-wallet blockchain transaction was performed.

### Manual Bradbury wallet QA

Funded-wallet browser scenarios remain **UNVERIFIED** until transaction hashes and observed results are recorded in [the Bradbury manual QA checklist](docs/BRADBURY_MANUAL_QA.md). Do not infer browser-wallet completion from the separate [Hosted Studio contract evidence](docs/HOSTED_STUDIO_FULL_TEST_EVIDENCE.md).

## Security and trust assumptions

- Contract assertions—not role-aware rendering—enforce wallet permissions.
- The read API limits methods, arguments, address, and state status, but does not implement authentication or rate limiting.
- Wallet writes depend on the connected wallet, Bradbury RPC, GenLayer consensus, and `genlayer-js` behavior.
- Escrow release follows validator consensus over publicly fetchable evidence after the client initiates verification.
- Rejected verification moves escrow to `DISPUTED`; the client has the implemented refund path. There is no neutral human arbitrator or admin override.
- Public deliverable content may disappear or change, and inaccessible/login-gated evidence fails closed during evaluation.
- Accepted state is not described as finalized state, and successful execution is confirmed separately from transaction acceptance.

See [Security Policy](SECURITY.md) for private reporting instructions.

## Deployment

The public frontend is hosted at [genmarket-escrow.vercel.app](https://genmarket-escrow.vercel.app). Repository CI performs no Vercel deployment, blockchain write, or contract deployment and uses no secrets. Deployment details and configuration boundaries are documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Current limitations

- Bradbury testnet only; no mainnet deployment is documented.
- Funded real-wallet browser QA is still unverified in the repository; the completed local browser-only pass performed no blockchain writes.
- AI-assisted results depend on public URL access, evidence quality, validator/provider behavior, and semantic consensus.
- Refund handling is client-controlled for `FUNDED` and `DISPUTED` jobs; no third-party arbitration or admin recovery path exists.
- Freelancer listings and per-role job queries return at most 100 records.
- Accepted-state visibility and protocol finalization can lag, and receipt retrieval can remain unknown or undetermined.
- WalletConnect-based connectors require a real public project ID in Vercel preview and production; their production reliability remains unverified until configured and tested.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Security reports should follow [SECURITY.md](SECURITY.md), not a public issue.

## License

No license file is currently included. Copyright defaults therefore apply; public source availability does not grant a general license to use, modify, or redistribute the project. Maintainer approval is required before adding a license.
