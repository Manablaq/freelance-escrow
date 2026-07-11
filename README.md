# FreelanceMarket Escrow

FreelanceMarket Escrow is a GenLayer Bradbury testnet app for client/freelancer profiles, job creation, escrow funding, public work submission, and contract-mediated release or refund.

## Links

- Live app: https://genmarket-escrow.vercel.app/
- GitHub repo: https://github.com/Manablaq/freelance-escrow
- Contract source: `contracts/freelance_market.py`
- Deployed contract: `0x6d7e8fE1195919146f1cD7B4e1E1965af4Da101f`
- Explorer: https://explorer-bradbury.genlayer.com/address/0x6d7e8fE1195919146f1cD7B4e1E1965af4Da101f

## Network

- Network: GenLayer Bradbury
- Chain ID: `4221`
- RPC URL: https://rpc-bradbury.genlayer.com
- Explorer root: https://explorer-bradbury.genlayer.com
- Native token: GEN

## Contract Methods

Write methods:

- `register(role, name, bio, skills, rate, rate_type, portfolio, twitter, github)`
- `update_profile(name, bio, skills, rate, rate_type, portfolio, twitter, github)`
- `create_job(title, description, freelancer, deadline)`
- `submit_work(job_id, deliverable_url)`
- `verify_and_release(job_id)`
- `client_refund(job_id)`
- `cancel_job(job_id)`

Payable method:

- `fund_job(job_id)` locks the client's attached GEN value in the contract escrow balance.

View methods:

- `get_profile(address)`
- `get_all_freelancers()`
- `get_job(job_id)`
- `get_jobs_by_client(client)`
- `get_jobs_by_freelancer(freelancer)`
- `get_stats()`

Admin methods:

- None.

## Escrow Flow

1. A wallet registers as either `client` or `freelancer`.
2. A registered client creates a job assigned to a registered freelancer.
3. The client funds the job with `fund_job`; the job moves from `OPEN` to `FUNDED`.
4. The assigned freelancer submits a public deliverable URL; the job moves to `SUBMITTED`.
5. The client can call `verify_and_release`.
6. If the accepted contract result approves the deliverable, the job becomes `PAID`, escrow balance becomes zero, and GEN is transferred to the freelancer.
7. If rejected, the job becomes `DISPUTED`; the client can call `client_refund`.
8. A client can also refund a still-`FUNDED` job or cancel an unfunded `OPEN` job.

Bradbury transactions are shown after accepted state. GenExplorer may show accepted or undetermined while the Bradbury finalization window is still pending.

## AI Evaluation

`verify_and_release` uses GenLayer nondeterminism and the equivalence principle:

- A module-level nondeterministic helper receives job context as an explicit serialized JSON value. It does not close over contract storage, `self`, the job record, or method-local values.
- Each validator fetches bounded content from the submitted URL with `gl.nondet.web.get` and independently evaluates it with `gl.nondet.exec_prompt`.
- `gl.eq_principle.prompt_comparative` compares the stable settlement fields: `approved` must match exactly, scores must be bounded from 0–100 and differ by no more than 10 points, and approval requires a score of at least 70. Explanations may differ.
- Evaluation covers the job title, job description, stored requirements (the description for records created by the current ABI), deliverable URL, an optional stored submission description, and the fetched page evidence.
- Page instructions are treated as untrusted. Inaccessible, empty, login-gated, unrelated, placeholder-only, insufficient, or malformed evidence fails closed and cannot release escrow.
- Only the bounded verdict, score, reason, and evidence summary are returned; fetched webpage content is not persisted.

These source changes address semantic-consensus and closure-serialization review findings. The deployed address listed above predates these source changes and does not contain them; a new contract deployment is required before they can be used on-chain. The frontend contract address has intentionally not been changed.

This is an AI-assisted escrow decision, not a legal ruling, guarantee of fairness, or proof of objective truth. Clear job descriptions and accessible deliverable URLs matter.

## Frontend And API Behavior

- All app reads go through `app/api/contract/route.ts`.
- The API route reads only the deployed FreelanceMarket contract address.
- The API route allowlists view methods and validates address/job-id arguments.
- The API route does not execute arbitrary methods from request data.
- The API route does not use a private key and does not provide fake fallback data.
- Wallet writes happen client-side through `genlayer-js` using the connected wallet.
- Client writes are limited in the frontend helper to known FreelanceMarket write methods.

## Local Setup

```bash
npm install
npm run dev
```

Open the local URL printed by Next.js and connect a wallet configured for GenLayer Bradbury.

## Testing

```bash
python3 -m unittest discover -s tests -v
npm run lint
npm run build
npm audit
git diff --check
```

## Deployment Proof

- Live deployment: https://genmarket-escrow.vercel.app/
- Deployed contract: `0x6d7e8fE1195919146f1cD7B4e1E1965af4Da101f`
- Explorer proof: https://explorer-bradbury.genlayer.com/address/0x6d7e8fE1195919146f1cD7B4e1E1965af4Da101f
- Frontend config uses Bradbury chain ID `4221`, RPC `https://rpc-bradbury.genlayer.com`, and explorer `https://explorer-bradbury.genlayer.com`.

## Limitations

- This is a Bradbury testnet app.
- Contract state changes are reflected after accepted reads; finalization can lag accepted state.
- Dispute handling is limited to the contract's `DISPUTED` state and client refund path.
- The AI-assisted review depends on public URL accessibility and the specificity of the job description.
- GNS display lookup is disabled in this build so reads stay scoped to the deployed FreelanceMarket contract.
