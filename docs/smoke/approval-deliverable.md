# Document GenLayer escrow verification

FreelanceMarket implements a GenLayer freelance escrow workflow. A wallet registers once as either a `client` or `freelancer`. A registered client can create a job for a registered freelancer; the new job has `OPEN` status and a zero escrow balance. The client funds it by attaching GEN to `fund_job`, which records the value in escrow and changes the status to `FUNDED`.

The assigned freelancer submits completed work as a public deliverable URL. `submit_work` records that URL and changes the job to `SUBMITTED`. The client can then call `verify_and_release`. Each evaluator receives the job title, description, stored requirements, deliverable URL, and any stored submission description. It fetches the actual URL content and semantically compares that fetched evidence with the job requirements. Inaccessible, empty, login-gated, unrelated, placeholder-only, insufficient, or malformed evidence fails closed.

FreelanceMarket uses GenLayer's Equivalence Principle through `prompt_comparative`. For consensus, the evaluators' `approved` fields must match exactly, their integer scores must be from 0 to 100 and differ by no more than 10 points, and approval requires a score of at least 70. Reasons and evidence summaries may differ because they are not settlement fields.

When the accepted result is approved at or above that threshold, the contract records the `APPROVED` verdict, changes the job status to `PAID`, sets its escrow balance to zero, adds the released balance to marketplace `total_paid`, increments the freelancer's `jobs_completed`, adds the balance to the freelancer's `total_earned`, and transfers the escrowed GEN to the freelancer.

Rejection remains a separate branch. A non-approved result records `REJECTED` and changes the job to `DISPUTED`; it does not execute the approval payment or approval accounting updates. The client may separately call `client_refund` for a `DISPUTED` job, which changes it to `REFUNDED`, sets the escrow balance to zero, and transfers the balance to the client.

Source: the current `FreelanceMarket` contract implementation and its repository documentation.
