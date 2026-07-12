# `verify_and_release` timeout diagnosis

Date: 2026-07-12
Scope: diagnosis only; no Bradbury write, deployment, key loading, frontend change, or smoke execution.

## Executive finding

The deterministic parsing and both settlement branches behave as written in Direct Mode. Controlled approval reaches `PAID`, clears exactly 1 GEN of escrow, updates payment/reputation accounting, and transfers exactly 1 GEN in the test-only balance harness. Controlled rejection reaches `DISPUTED`, preserves escrow, and performs no approval accounting or transfer.

The live evidence does **not** identify a contract exception, web failure, LLM failure, validator disagreement, or settlement failure. Both live transactions stopped with `resultName: IDLE`, `txExecutionResultName: NOT_VOTED`, and empty leader public data while all contract state remained pre-verification. That places the observed stop before a leader result and before settlement. This is consistent with a leader/provider execution timeout, but Bradbury infrastructure responsibility remains **inferred, not confirmed**, because Studio is unavailable locally and `genlayer-test` 0.29.2 cannot execute the pinned SDK's `ExecPromptTemplate` comparative validator in Direct Mode.

## Preserved Bradbury evidence

- Contract: legacy pre-hosted deployment (retired; not used by the frontend)
- Job: `1`
- Original: `0x65084e3149c7cfa380f3282590fbfe737489dc530ac43918ad65bb62ae3a387b`
- Retry 1: `0xd4f3eff1af3f3e8b6693a135d6912417b58756462c42d2b35935ed5f8c2d6277`
- Both observed outcomes: `IDLE`, `NOT_VOTED`, empty leader public data.
- Confirmed unchanged state supplied for both observations: job `SUBMITTED`; escrow `1`; verdict, reasoning, and `resolved_at` empty.
- The journal was not modified. Its diagnostic SHA-256 before and after work was `ec59da1694964cbc5cf35a1814d596b75cdf0bb8dfae666472d76f64f83365f4`.

## Exact production path

### Deterministic work before nondeterminism

`verify_and_release("1")` reads `jobs["1"]`, asserts that it exists, JSON-decodes it, converts the sender to text, asserts the sender is the client, and asserts status is `SUBMITTED`. It reads the freelancer and constructs a sorted JSON `evaluation_context` from title, description, requirements (falling back to description), deliverable URL, and optional submission description.

Possible exceptions here are missing job, malformed stored JSON, missing required record keys, wrong caller, wrong status, or a non-serializable context value. None would be expected for the confirmed submitted job.

### Leader nondeterminism

The contract calls:

```python
gl.eq_principle.prompt_comparative(
    partial(_evaluate_submitted_work, evaluation_context),
    principle=...,
)
```

The pinned `py-genlayer` implementation uses `gl.vm.run_nondet`. The leader return type is a JSON **string** returned by `_evaluate_submitted_work`; protocol-side, validators receive it as `gl.vm.Return[str].calldata` if leader execution succeeds.

The evaluator deterministically decodes/truncates context fields and rejects a non-HTTP URL. Its first nondeterministic operation is `gl.nondet.web.get(deliverable_url)`, an HTTP GET alias over `gl.nondet.web.request(method="GET")`. The installed response type is `genlayer.gl.nondet.web.Response(status: int, headers: dict[str, bytes], body: bytes | None)`. The contract reads only `body`, UTF-8 decodes it, and truncates it to 12,000 characters; it does not inspect `status`.

Fetch/request/decode exceptions return a canonical rejected JSON string. Empty decoded content also returns canonical rejection. Thus routine inaccessible, missing-body, or invalid-UTF-8 cases should still produce leader public data rather than escape the leader function.

For nonempty text, the second nondeterministic operation is `gl.nondet.exec_prompt(prompt)` with default `response_format="text"`, so the installed API returns `str`. The contract strips optional JSON fences, parses JSON, and requires:

- `approved`: exact `bool`;
- `score`: exact non-boolean `int` in 0..100;
- nonempty string `reason` and `evidence_summary`;
- an approval score of at least 70.

Malformed output, missing/wrong fields, out-of-range scores, below-threshold approval, surrounding prose, empty output, or provider exceptions all become canonical rejection strings. Reasons and evidence summaries are truncated to 500 characters.

Remaining pre-public-data failure opportunities are GenVM/runner startup failure, serialization/closure failure around `partial`, web or LLM calls that hang until the transaction leader deadline rather than raising, provider/template infrastructure failure, VM resource exhaustion, or protocol/node failure before `run_nondet` publishes the returned string.

### Validator comparison

Each validator reruns the same evaluator. `prompt_comparative` then calls the installed `ExecPromptTemplate` named `EqComparative`, passing formatted leader answer, validator answer, and the contract's natural-language principle. The template's LLM returns a boolean vote.

The intended criteria in that principle are exact equality of `approved`, integer scores within 0..100 and no more than 10 apart, approval only at 70+, and no required equality for reasoning/evidence summary. These criteria are **not deterministic Python comparisons**: their enforcement depends on the validator's comparative LLM/template. A non-`Return` leader result votes false; an unhandled validator/template exception is disagreement. Disagreement occurs after a leader result exists, unlike the observed empty leader public data/`NOT_VOTED` state.

### Deterministic settlement

The accepted string is parsed again by `_parse_consensus_result`. Invalid accepted data becomes canonical rejection. The contract reads escrow and timestamp.

- Approval: assert positive escrow; write `PAID`, `APPROVED`, reason and `resolved_at`; clear escrow; increment `total_paid`; increment freelancer `jobs_completed` and `total_earned`; call `_EOARecipient(Address(freelancer)).emit_transfer(value=u256(balance))`.
- Rejection: write `DISPUTED`, `REJECTED`, reason and `resolved_at`; preserve escrow; do not update payment/reputation; emit no transfer.

`emit_transfer` schedules the native-value transfer through the contract interface. Transaction execution is atomic on-chain, so an execution error does not commit earlier writes. The installed Direct Mode does not model payable/native transfers or the EOA post-message itself, so the diagnostic tests use a clearly isolated test-only balance/transfer harness and assert exact debits/credits.

## Toolchain and APIs verified

- `genlayer-test` installed temporarily under `/private/tmp`: version `0.29.2`.
- Required runtime: Python 3.12+; run used Python `3.12.13`.
- Direct fixtures: `direct_vm`, `direct_deploy`, `direct_alice`, `direct_bob`, `direct_charlie`, `direct_owner`, `direct_accounts`.
- Direct APIs used/inspected: `sender`, `value`, `deal`, `prank`, `snapshot`, `revert`, `mock_web(regex, response)`, `mock_llm(regex, text)`, `clear_mocks`, `run_validator`, `strict_mocks`, `check_pickling`.
- Exact web mock shape: `{"method": "GET", "status": int, "body": str|bytes|None}`.
- Contract-pinned runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`, present in the framework's `v0.2.12` fallback GenVM bundle.
- Framework issues observed: automatic latest release `v0.3.0-rc7` asset URL returned 404; explicit installed fallback `v0.2.12` was required. JSON-looking LLM mocks are auto-parsed even for text-mode prompts, so fenced JSON was used to preserve the API's text response. `check_pickling` warns because `cloudpickle` is not included in this temporary environment. Direct Mode reports unknown `ExecPromptTemplate` and returns `None` for every comparative validator case.
- `genlayer-js`: installed version `1.1.8`; receipt fields documented/available include `resultName`, `txExecutionResultName`, and debug tracing. `NOT_VOTED` means execution has not completed.

## Direct Mode results

Command (isolated temporary dependency/cache):

```sh
HOME=/private/tmp/genmarket-home PYTHONPATH=/private/tmp/genmarket-gltest \
  /opt/homebrew/bin/python3.12 -m pytest tests/test_verify_and_release_diagnostics.py -v
```

Result: **18 passed**, with 34 pickling-environment warnings.

- Approval: passed, exact `PAID`/`APPROVED`, zero escrow, 1 GEN transfer/accounting, reputation increment, nonempty resolution timestamp.
- Semantic gardening rejection: passed, exact `DISPUTED`/`REJECTED`, escrow preserved, no approval accounting/payment.
- Web: empty, inaccessible (`body=None`), and invalid UTF-8 reject safely. Oversized content is truncated and evaluated. Important source finding: nonempty 404 and 503 bodies are evaluated and can approve because status is ignored.
- LLM: malformed JSON, missing fields, wrong types, scores -1/101, approval score 69, surrounding text, and empty output all reject safely without approval settlement.
- Parsing isolation: valid approval parses; empty/malformed/incomplete/boolean-score accepted values fail closed.
- No partial approval settlement was observed for any rejection/error case.
- Comparative consensus: leader value is captured, but all four validator scenarios return `None` because Direct Mode 0.29.2 lacks `ExecPromptTemplate` dispatch. Therefore same-decision tolerance, differing decision, score delta >10, and malformed validator output remain unconfirmed locally. In a consensus runner, falsey votes would be disagreement/undetermined; this is a framework limitation, not proof of production disagreement.

## Layer isolation

| Layer | Result | Evidence |
|---|---|---|
| Web fetch/body handling | Passed with caveat | GET/body/decode/empty/truncation paths exercised; HTTP status is ignored. |
| Evaluator LLM prompt | Passed under strict mock | Valid approval/rejection text and malformed matrix exercised. Real provider availability was not tested. |
| JSON/evaluation parsing | Passed | All required type/range/threshold cases exercised. |
| Comparative consensus | Blocked locally | Installed Direct Mode cannot dispatch `ExecPromptTemplate`; Studio required. |
| Settlement logic | Passed with test-only transfer harness | Exact state/account balance changes checked; no production code changed. |
| Bradbury leader/provider infrastructure | Inferred only | Empty leader data + `NOT_VOTED` on two attempts is consistent, but no Studio reproduction/log comparison exists. |

## Studio preparation and availability

GenLayer CLI `0.39.1` and Python 3.12 are installed. Docker is not installed/on `PATH`, so Studio is unavailable and was not started or reset.

The official start command would be:

```sh
genlayer up
```

It was not run. It must be reported and explicitly approved first. The prepared integration sequence is local/studionet only: deploy the repository contract to the new local Studio instance; use Studio test accounts to register client/freelancer; create job 1; fund exactly 1 GEN; submit the commit-pinned URL; invoke verification once; inspect the receipt's transaction and execution status; then filter Studio logs by transaction hash and RPC, GenVM, and Consensus scopes. Webrequest and LLM/provider details must be taken from expandable GenVM/provider entries actually exposed by that Studio version, not assumed commands. Empty/failed leader execution indicates leader/provider failure; a completed leader result followed by false validator votes indicates comparative disagreement.

No Bradbury address, account, or key belongs in that test.

## Conclusion and next safe action

Confirmed contract findings: evaluator/parser/branch logic works under controlled inputs; malformed web/LLM data normally fails closed with a rejection value; settlement is not reached before an accepted consensus result; HTTP status codes are not checked; comparative criteria are LLM-enforced rather than deterministic.

Likely live failure layer (**inferred**): leader-side GenVM web/LLM/provider execution or Bradbury node/provider orchestration before publication of leader data. JSON parsing and settlement are unlikely explanations for the observed `NOT_VOTED`/empty-leader signature because their caught failures produce a rejection string and their uncaught deterministic failures would normally produce an execution error, while settlement occurs later. Validator disagreement is also unlikely for this exact signature because comparison requires a leader result first.

Exact next safe action: install/enable Docker, obtain approval to run `genlayer up`, execute the prepared local-only Studio reproduction once, and capture the transaction-filtered RPC/GenVM/Consensus plus visible Webrequest/LLM-provider log entries. Only that evidence can promote the infrastructure inference to a confirmed conclusion.

## Official references used

- https://sdk.genlayer.com/main/api/genlayer.html
- https://docs.genlayer.com/api-references/genlayer-js
- https://docs.genlayer.com/developers/intelligent-contracts/features
- https://docs.genlayer.com/developers/intelligent-contracts/features/web-access
- https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle
- https://docs.genlayer.com/developers/intelligent-contracts/testing
- https://docs.genlayer.com/developers/intelligent-contracts/debugging
- https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/monitoring-node-logs
