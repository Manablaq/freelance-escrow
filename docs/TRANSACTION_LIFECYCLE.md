# Transaction and accepted-state lifecycle

FreelanceMarket does not treat a submitted hash—or accepted status alone—as proof that a contract action succeeded.

```text
Wallet request
→ transaction hash
→ structured receipt processing
→ successful execution result
→ expected accepted-state confirmation
→ dependent data refresh
→ confirmed UI state
```

## Successful path

1. The page validates and, where needed, snapshots state used by its confirmation predicate.
2. `genlayer-js` opens the connected wallet and submits an allowlisted write to the fixed contract.
3. The hash is retained and the client waits for accepted status using structured SDK receipt data.
4. Receipt classification requires `ACCEPTED` or `FINALIZED` together with `FINISHED_WITH_RETURN`. `FINISHED_WITH_ERROR` is an execution failure even if the transaction record is accepted.
5. The page polls an action-specific predicate against accepted contract state—for example, an exact new job record or the expected status and escrow balance.
6. Once the predicate matches, a global refresh event causes affected polling consumers to read again. The UI moves to confirmed without a manual browser reload.

Accepted-state polling uses increasing delays, is bounded by a ten-minute default timeout, and passes an `AbortSignal` to reads. Changing wallet or page scope aborts the old loop and increments a version guard so late responses cannot update the new scope. General page polling has an in-flight guard, preventing overlapping reads for the same hook instance.

## Unresolved and failure states

| State | Meaning | Safe next action |
| --- | --- | --- |
| Processing | The structured status is still nonterminal or execution is not yet voted | Retry the same hash later |
| Unknown receipt | Receipt retrieval and fallback lookup did not establish an outcome | Retry the same hash; do not infer failure or success |
| Execution error | Structured execution is `FINISHED_WITH_ERROR` | Inspect the transaction; no expected state was confirmed |
| Canceled | GenLayer reports `CANCELED` | Treat as not successfully executed |
| Undetermined | GenLayer reports `UNDETERMINED` | Treat as unresolved, not successful |
| Accepted-state synchronization timeout | Structured execution succeeded, but the page predicate did not become visible in time | Retry accepted-state reads using the existing hash |

Wallet rejection and pre-hash submission errors are shown separately because no reusable transaction hash may exist.

## Existing-hash retry

For processing or unknown receipts, retry calls `checkReceipt(hash)` exactly once and never calls `submit`. Expected-state polling begins only if that receipt classifies as executed. For a synchronization timeout after an already executed receipt, retry resumes only the accepted-state confirmation. Scope invalidation makes retry a no-op.

## Action-specific confirmation

- Registration confirms the profile exists with the chosen role.
- Profile update confirms every submitted profile field.
- Job creation finds exactly a new job matching client, freelancer, title, description, and deadline.
- Funding confirms `FUNDED` and the exact escrow amount.
- Submission confirms `SUBMITTED` and the exact deliverable URL.
- Verification confirms `PAID` or `DISPUTED` as expected by the returned contract state.
- Refund confirms `REFUNDED` with zero escrow.
- Cancellation confirms `CANCELLED`.

These checks synchronize the interface with accepted contract state; they do not turn accepted state into protocol finality.
