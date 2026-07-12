# Bradbury real-wallet acceptance checklist

All scenarios below are **UNVERIFIED** until completed with interactive funded GenLayer Bradbury wallets and recorded in this file. Hosted Studio contract evidence does not establish browser-wallet behavior. Never reload the browser during a scenario.

For each scenario, replace `UNVERIFIED` only when every field below has evidence. Never record private keys or seed phrases.

| Field | Record |
| --- | --- |
| Status | UNVERIFIED |
| Date tested (UTC) | — |
| Tester | — |
| Wallet role | — |
| Job ID | — / not applicable |
| Transaction hash | — |
| Expected result | See scenario |
| Observed result | — |
| Pass/fail | UNVERIFIED |
| Notes | — |

## Register client

**Status: UNVERIFIED**

- Start: `/register`, unregistered wallet selected as Client.
- Progress: Preparing → wallet confirmation → submitted → ACCEPTED → synchronizing → confirmed.
- Accepted state: `get_profile(client)` returns `found` and role `client`.
- Disappears: registration form and create-profile navigation prompt.
- Appears: accepted-profile success and client next action; navigation shows name and role.
- Cross-check: `/dashboard` recognizes the client without reload.

## Register freelancer

**Status: UNVERIFIED**

- Start: `/register`, a different unregistered wallet selected as Freelancer.
- Progress: same lifecycle as client registration.
- Accepted state: `get_profile(freelancer)` returns `found`, role `freelancer`, and submitted fields.
- Disappears: registration form and create-profile navigation prompt.
- Appears: freelancer success, navigation identity, dashboard, and marketplace card.
- Cross-check: marketplace/profile data update without reload.

## Create job

**Status: UNVERIFIED**

- Start: `/post-job`, registered client wallet, registered freelancer selected.
- Progress: Preparing → wallet → submitted → ACCEPTED → synchronizing → confirmed.
- Accepted state: a new ID in `get_jobs_by_client(client)` whose client, freelancer, title, description, and deadline all match the form.
- Disappears: review transaction action after confirmation/navigation.
- Appears: the exact new `/job/[id]` in `OPEN` with funding and cancellation actions.
- Cross-check: dashboard job count and platform total refresh without reload.

## Fund job

**Status: UNVERIFIED**

- Start: `/job/[id]` in `OPEN`, assigned client wallet.
- Expected state: `FUNDED` and `escrow_balance` exactly equals submitted GEN value.
- Disappears: funding and cancellation controls.
- Appears: funded lifecycle state; assigned freelancer sees submission action.
- Cross-check: client/freelancer dashboards and active escrow refresh without reload.

## Submit work

**Status: UNVERIFIED**

- Start: funded job, assigned freelancer wallet, public deliverable URL entered.
- Expected state: `SUBMITTED` and stored `deliverable_url` exactly matches input.
- Disappears: submission form.
- Appears: public deliverable link and client verification action.
- Cross-check: both dashboards refresh without reload.

## Approve and release

**Status: UNVERIFIED**

- Start: submitted job, assigned client wallet, approval-quality public evidence.
- Expected state: `PAID`, zero escrow, and persisted `ai_verdict` and `ai_reasoning` fields. The current contract does not persist the evaluator score or evidence summary.
- Disappears: verification and settlement actions.
- Appears: paid terminal state and AI-assisted result.
- Cross-check: freelancer work totals and platform paid statistics refresh without reload.

## Reject and dispute

**Status: UNVERIFIED**

- Start: submitted job, assigned client wallet, evidence expected to fail the stored scope.
- Expected state: `DISPUTED` with escrow retained according to the contract.
- Disappears: verification action.
- Appears: disputed lifecycle state and client refund action.
- Cross-check: both dashboards refresh without reload.

## Refund

**Status: UNVERIFIED**

- Start: `FUNDED` or `DISPUTED` job, assigned client wallet.
- Expected state: `REFUNDED` and zero escrow.
- Disappears: refund and all other write actions.
- Appears: refunded terminal state.
- Cross-check: dashboards and active escrow refresh without reload.

## Cancel

**Status: UNVERIFIED**

- Start: unfunded `OPEN` job, assigned client wallet.
- Expected state: `CANCELLED`.
- Disappears: funding and cancellation controls.
- Appears: cancelled terminal state.
- Cross-check: dashboard status refreshes without reload.

For every scenario also test wallet rejection, RPC submission failure where safely reproducible, navigation during accepted-state polling, timeout retry, mobile layout, explorer access, and preservation of all entered fields. A timeout retry must perform reads only and must never open the wallet or submit another transaction.
