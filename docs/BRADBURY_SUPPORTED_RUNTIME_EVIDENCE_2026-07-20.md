# Bradbury Supported-Runtime Evidence — 2026-07-20

This record covers the exact-source reviewer deployment at `0x066131dffbE72e27AB40446620792d45a9a6054a` on GenLayer Bradbury, chain ID `4221`, using `genlayer-js@1.1.8`. It is separate from the historical Hosted Studio record and from the public frontend deployment at `0x75af88bfA0592CFA63c06f2F68BfD35C13dDd4EF`.

The deployed reviewer roles were:

- Client: `0x5bB49021001200fE8156a81c7fcF097e535e7181`
- Freelancer: `0x1f87Ae197af539253978d435aD45cCf28Fb95024`
- Escrow: `1000000000000000000` wei
- Deployment transaction: `0x1bd6ac8500d41114afc4e16022fd9fe19f036e7fdb803309f9fc2b0dbd8192cb`
- Repository baseline: `4ffa69be4ed4f5a8122fb57d3d93f29a6056b125`

The pinned Bradbury configuration uses five initial validators. The preserved approval and rejection `getTransactionAllData` responses independently contain `numOfInitialValidators = 5`; this record does not infer a different count from prose.

## Authenticated transaction captures

The byte-for-byte request/response fixtures and controlled manifest are in [`tests/fixtures/bradbury-supported-runtime/`](../tests/fixtures/bradbury-supported-runtime/). The eight expected SHA-256 values and both historical transaction IDs are immutable constants in the test source, independent of filenames, workflow labels, and `manifest.json`. Tests authenticate every raw file against those constants before parsing, then independently validate each closed JSON-RPC request/response envelope, controlled ID, `eth_call` destination, selector, embedded transaction ID, block selector, and timestamp convention. `manifest.json` is descriptive metadata only: it must be a closed plain-data top-level object with the exact fixture-entry set, and every nested fixture value is checked against immutable test anchors. It never defines the expected oracle.

| File | SHA-256 |
| --- | --- |
| `approval-getTransactionData-request.json` | `5b4d6cf4c33938c3350825306b971d07e1b94c26a6d3756177bf87c514c41800` |
| `approval-getTransactionData-response.json` | `7d3db5237dffb19a399a48333959cbeb8c8da47fa0972ba2f96f234062608c12` |
| `approval-getTransactionAllData-request.json` | `f97fe405927ff960c51895867cc85eb7ea790224c4e98aec135c48342b4f0ca4` |
| `approval-getTransactionAllData-response.json` | `af66321c1964fb7cc612d1723e1f2d98836f46ca31e67308c27c2be0f48c9632` |
| `rejection-getTransactionData-request.json` | `e2266e2b870240d7d96dc67cfb67073b4dbeba7fe3b47bc04eecd77033fd774e` |
| `rejection-getTransactionData-response.json` | `4e2a12bfc77916ab05def3b41e3129bf52c8eef5b8774158b6ee7e4d8e9615a2` |
| `rejection-getTransactionAllData-request.json` | `d80f8d95f919afe34f20ddb868be3409f1fc80136559eb864798a7373d25a61c` |
| `rejection-getTransactionAllData-response.json` | `4bd57cb9732767c83916834335bb1bf3e303ebd8622b862770888ffbda656fe5` |

Both SDK contract methods use JSON-RPC `eth_call`. `getTransactionData(bytes32,uint256)` uses `Math.round(Date.now() / 1000)` for its second argument; `getTransactionAllData(bytes32)` takes the transaction ID alone. Within each historical transaction, both methods contain the exact same non-null `eqBlocksOutputs` bytes and independently bind the requested transaction ID.

## Deterministic comparative-output structure

`genlayer-js@1.1.8` ABI-decodes the Solidity `bytes` field only to opaque hex. The runner applies this closed, exact selector:

`eqBlocksOutputs.rlp[0].genvm_return.calldata_string.json`

The observed and required layers are:

1. Canonical, even-length non-empty ABI `bytes` hex.
2. One exactly consumed canonical RLP list with exactly two byte-string items.
3. RLP item `0`, uniquely identified as `rlp_item_0_successful_genvm_return`.
4. A GenVM result envelope whose first byte is exactly `0x00` (`return`).
5. The remaining bytes are one canonical GenLayer calldata value: ULEB128 type tag `4` (string), an exact declared byte length, and no trailing bytes.
6. Strict UTF-8, then one plain JSON object with exactly `approved`, `evidence_summary`, `reason`, and `score`.
7. RLP item `1` is exactly the six-byte marker `padded` (`0x706164646564`); any other or additional sibling is rejected.

Approval is 580 outer bytes: RLP prefix `f9 0241`, a 567-byte first item (`b9 0237`), then the fixed marker. Its calldata header is `a4 23`, which canonically encodes string tag `4` and 564 UTF-8 bytes. Rejection is 313 outer bytes: RLP prefix `f9 0136`, a 300-byte first item (`b9 012c`), then the marker. Its calldata header is `cc 12`, encoding tag `4` and 297 UTF-8 bytes.

The decoder rejects empty/null output, truncation, noncanonical or invalid RLP, the wrong GenVM result tag, invalid calldata tag/length, trailing bytes, invalid UTF-8/JSON, missing or extra evaluator keys, non-boolean approval, non-integer/out-of-range score, empty/overlong prose, and zero/multiple/extra structural candidates. The parser does not use a regular expression, substring search, brace scanning, or “first JSON-looking object” logic to locate or select the comparative output. That output is selected only through the closed RLP → GenVM → calldata structural path. After structural extraction, a narrowly scoped check may inspect the extracted JSON source to reject duplicate evaluator keys; that duplicate-key check is not used to discover or choose the output. Debug tracing is not required.

## Historical decoded results

Approval transaction `0xed2e2b341793ec3a1fd48fa096e6ada5c8ed4b83b6ec9fc4d446a20c4c946eb6` proves:

- `approved: true`
- `score: 95`
- `eqBlocksOutputs` SHA-256: `12c8bffd0d788908f2ab04dbbce5e1fac3955590247925bbb50f3b696c46819e`
- Reason: 225 UTF-8 bytes, SHA-256 `3a0d8c90da22f477104b7a1b2e2a036bdcb9bbf1b42ac797d6796c17b1e01108`
- Evidence summary: 270 UTF-8 bytes, SHA-256 `b1e9fb5a5dd4b48e516b9aaae16ec7bb39592e4b21c60ed0bc236181de89c027`

Rejection transaction `0x3113ee6d3bfbb4c911ed2c9b72b090ab081cf8edfcd068be8bcb90a53f0880fa` proves:

- `approved: false`
- `score: 0`
- `eqBlocksOutputs` SHA-256: `4b942ab906ddb4309599ab192962bed72a223f4e124daf305655f29c51287487`
- Reason: 83 UTF-8 bytes, SHA-256 `26aa745ed23495c1aff8cc7e5de850fd5478ed1f86f617d621bcab63397fd728`
- Evidence summary: 145 UTF-8 bytes, SHA-256 `849504364d612e4e8fac8d2f491e5a54bf560451ebd46e37b0ff1b06ee59f04f`

These values come exclusively from the captured `eqBlocksOutputs`, not the final job state, workflow label, fixture filename, historical narrative, or accounting. They prove score `95` only for the approval transaction above and score `0` only for the rejection transaction above; they do not predict a future validator result. Raw reason, evidence summary, and job `ai_reasoning` are not journaled; only presence, UTF-8 byte length, and SHA-256 are retained. `resolved_at` is omitted.

The historical final states were approval `PAID`/`APPROVED` with zero escrow and rejection `DISPUTED`/`REJECTED` with 1 GEN escrow. Approval recorded a 1 GEN increase in `total_paid`, `total_earned`, freelancer `jobs_completed +1`, and finalized freelancer EOA balance. Rejection recorded no counter or freelancer-balance delta. No `client_refund` preceded the preserved rejection evidence.

These aggregate contract counters and the freelancer EOA delta are strong evidence for the dedicated reviewer setup, but the available interface cannot mathematically exclude perfectly compensating unrelated concurrent transfers. This is not cryptographic attribution. Dedicated accounts, exact job identity, immutable pre-verification baselines, finalization gating, and bracketing reads reduce the residual limitation.

The captures did not preserve the exact historical title and description, so this record does not claim them. The current commands use:

- Approval title `Document GenLayer escrow verification`; description `Provide a public page that clearly and specifically documents this GenLayer freelance escrow verification workflow and its approval behavior.`; fixture [`docs/smoke/approval-deliverable.md`](smoke/approval-deliverable.md).
- Rejection title `Summarize GenLayer escrow requirements`; description `Provide a public page that clearly and specifically summarizes this GenLayer freelance escrow contract and its semantic verification requirements.`; fixture [`docs/smoke/rejection-deliverable.txt`](smoke/rejection-deliverable.txt).

## Finalization and persistence controls

The canonical GenLayer ID is durably recorded before verification polling. Terminal reads cannot start until the exact transaction is `FINALIZED`, status code `7`, `AGREE` or `MAJORITY_AGREE`, `FINISHED_WITH_RETURN`, and carries valid non-null evaluator evidence. Only then does the runner read: job, stats, freelancer profile, finalized freelancer EOA balance, and job again. Both projected job reads must be identical. A rejection fails if a refund step exists, refund/escrow changes occur in the window, or accounting/profile/balance counters change unexpectedly.

Snapshot freshness begins before the first awaited snapshot read and is capped at an inclusive ten minutes. Signing preparation cannot reset that persisted start time; freshness is synchronously rechecked immediately before raw broadcast.

A completed journal binds the successful verification step and finalization transaction ID to the output digest/length, fixed selector/index/identity, approval/score, and hashed prose metadata. It references, but does not embed, a deterministic-basename same-directory sidecar containing the exact canonical `eqBlocksOutputs` bytes. The sidecar must be a regular mode-`0600` file and is read without following symlinks. It is never printed, included in errors or lock metadata, or copied into this evidence record. Completed-journal validation verifies its exact byte length and SHA-256, re-decodes it with the production deterministic parser, and recomputes approval, score, output digest, selector metadata, and reason/evidence-summary presence, lengths, and hashes before checking finalization identity and accounting. A stored evaluator summary alone is never trusted. Raw validator prose never enters the journal or ordinary output.

The parent remains the invocation owner and retains an open descriptor for the mode-`0600` lock while an inode-bound helper performs relative journal I/O. Before replacing a journal or evaluator sidecar, the helper fsyncs a mode-`0600` durable transaction record containing only a controlled transaction ID, basenames, hashes, and state. It writes and fsyncs all temporaries, retains prior files under transaction-owned rollback basenames, installs the sidecar before the completed journal, fsyncs the directory, and reports `PREPARED_AFTER_RENAME`. The parent checks helper PID, lock identity, directory device/inode, and transaction ID before sending the exact commit acknowledgment. Rollback files and the transaction record are not removed merely because rename succeeded.

Genuine helper `SIGKILL` tests pause after durable transaction-record creation, after prior journal/sidecar backup creation, after sidecar canonical rename, after journal canonical rename, and after `PREPARED_AFTER_RENAME` is sent. At each of those exact pre-commit windows, the parent observes the helper's `SIGKILL` exit, recovers under the still-held original invocation lock, restores the prior pair byte-for-byte, and only then returns save failure. A sixth genuine helper `SIGKILL` test pauses after `COMMIT_ACKNOWLEDGED` is durably written and fsynced but before final helper success; recovery verifies the new canonical hashes and rolls that pair forward exactly once.

Genuine parent `SIGKILL` tests exercise two exact windows. If the parent dies after validating `PREPARED_AFTER_RENAME` but before durable `COMMIT_ACKNOWLEDGED`, the next authorized invocation follows the test environment's proven crash-left-lock procedure and rolls the prior pair back before journal use. If the parent dies after durable `COMMIT_ACKNOWLEDGED` but before receiving final helper success, the next authorized invocation uses that durable state to roll the new pair forward exactly once. Both next-invocation cases run recovery again to prove idempotence. Files are not removed when transaction ownership or hashes cannot be proven. Parent replacement, symlinks, traversal, malformed IPC, and identity mismatch still fail closed. These statements describe only the exact tested recovery protocol and do not claim safety beyond it.

## Authorized reproduction and remaining closure

Install with `npm ci`, use chain ID `4221`, the exact contract and reviewer-role addresses above, the exact 1 GEN escrow, and the public fixture URLs documented in [README](../README.md#bradbury-supported-runtime-reproduction). Real client/freelancer keys must derive to their configured role addresses and must never be committed. The client must be funded for escrow plus fees; both roles need transaction fees. Enable only with `SMOKE_LIVE_BRADBURY=I_UNDERSTAND_THIS_WRITES_TO_BRADBURY`, then use `npm run smoke:approval` or `npm run smoke:rejection` from the repository root.

The flow safely resumes the same journal. An ambiguous broadcast requires manual investigation and a proven GenLayer ID. `SMOKE_RETRY_VERIFY_FROM_HASH` is permitted only for the exact latest journaled verification ID after independent proof of terminal failure and unchanged fresh pre-verification state; it is forbidden for uncertainty, pending/accepted/successful execution, stale evidence, changed escrow/job, or any refund. Locks never expire: prove no process owns a stale lock and inspect all recorded transactions before manual removal.

Validator outcomes are real and nondeterministic. The offline fixtures authenticate and validate the runner but do not replace fresh authorized Bradbury execution. Before submission to the GenLayer reviewer, final closure still requires one fresh authorized Bradbury approval run and one fresh authorized Bradbury rejection run, both reaching status code `7`, recording real non-null comparative evaluator evidence, and producing complete post-finalization journal/sidecar pairs.
