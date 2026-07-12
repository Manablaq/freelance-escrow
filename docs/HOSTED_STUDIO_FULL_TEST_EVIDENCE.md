# Hosted GenLayer Studio Full Test Evidence

## Contract

- Contract address: 0x75af88bfA0592CFA63c06f2F68BfD35C13dDd4EF
- Deployment transaction: 0x27a83352d39feda126c0d122a3e3223c238708c99f75bfddbb3bf280283902b1
- Deployment status: ACCEPTED
- Deployment result: AGREE

## Accounts

- Client: 0x5bB49021001200fE8156a81c7fcF097e535e7181
- Freelancer: 0x1f87Ae197af539253978d435aD45cCf28Fb95024

## Registration Tests

### Freelancer Registration

- Transaction: 0x8947289758ea73993de36cf93b4a5cc8c528bee17837e91d83013e0c89a8d686
- Sender: 0x1f87Ae197af539253978d435aD45cCf28Fb95024
- Role: freelancer
- Execution result: FINISHED_WITH_RETURN

### Client Registration

- Transaction: 0xfd4a0129573b032d0dbb864fc04c7221352b686ccc09c63a488f408cec14eeed
- Sender: 0x5bB49021001200fE8156a81c7fcF097e535e7181
- Role: client
- Execution result: FINISHED_WITH_RETURN

## Job 1: Rejection and Refund Path

- create_job tx: 0xd0aae65e9e557891cef0e18ad13e94545f557979680fed2613fb844c09436402
- fund_job tx: 0xdaa473bc49b398fdd1c24bff55ca6a283a50244be92fa58da25d7d55af6297ef
- submit_work tx: 0x0b70bce09125b9a58e4f2986b08d740db1d342138d1de5697e1afcaad7bb40c1
- verify_and_release tx: 0x4b6c51181b866070cb504f61f19b08beb25135a3373590b2b8b20c49b9d1f30a
- AI verdict: REJECTED
- AI score: 0
- Resulting status: DISPUTED
- client_refund tx: 0xf2614a63494cd9d8d446395b5571c1a3ea287ee6fa3cef4e39dd35af08e97121
- Refund execution result: FINISHED_WITH_RETURN

## Job 2: Approval and Payment Release Path

- create_job tx: 0x4dde4e2d408c404699d70478c923a01e2692ce60ae0bc578ec13f9c619582dd3
- fund_job tx: 0x68414d2deb59ba3231a1c1672a3726c13b2eb207ea9216e29ed18daaaf5a0dcd
- submit_work tx: 0x54dd062cff41a9586dcb4fcb36251df8ee23bd200b73ed38f7372fe947587ff9
- verify_and_release tx: 0x4cb20970791c6f5a49ade7b9d5e37c926b63427adad9c392cee422e02ed4903b
- AI verdict: APPROVED
- AI score: 95
- Final status: PAID
- Final escrow balance: 0
- Payment release execution result: FINISHED_WITH_RETURN

## Final Job 2 State

- job_id: 2
- status: PAID
- ai_verdict: APPROVED
- escrow_balance: 0
- deliverable_url: https://raw.githubusercontent.com/Manablaq/freelance-escrow/93b138fb8c2ac4c71b1dce6fef9b9925ebbfbf48/docs/smoke/approval-deliverable.md

## Final Platform Stats

- total_jobs: 2
- total_paid: 1000000000000000000
- total_freelancers: 1

## Summary

Hosted GenLayer Studio testing verified the full contract flow:

- Deployment succeeded.
- Freelancer and client registration succeeded.
- Job creation succeeded.
- Escrow funding succeeded.
- Work submission succeeded.
- AI rejection path succeeded.
- Client refund path succeeded.
- AI approval path succeeded.
- Payment release path succeeded.
- Final stats matched the expected completed test state.
