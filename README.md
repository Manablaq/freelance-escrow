# FreelanceMarket — AI-Powered Freelance Marketplace on GenLayer

Register as a client or freelancer, browse talent, post jobs, lock GEN in escrow, and get paid automatically after AI verification.

## Live App
https://genmarket-escrow.vercel.app

## Contract
- **FreelanceMarket:** `0x6d7e8fE1195919146f1cD7B4e1E1965af4Da101f` (Bradbury Testnet)
- **File:** `contracts/freelance_market.py`

## How It Works
1. **Register** — Connect wallet, choose Client or Freelancer role, fill your profile
2. **Browse** — Clients browse the freelancer marketplace, filter by skill and rate
3. **Hire** — Click Hire on a freelancer profile, job form pre-fills their address
4. **Escrow** — Client locks GEN into the smart contract
5. **Submit** — Freelancer submits a public deliverable URL (GitHub, Google Drive, deployed app)
6. **AI Verify** — 5 independent GenLayer validators fetch the URL and verify it meets the job description
7. **Pay** — Approved → GEN auto-released to freelancer. Rejected → client gets refund

## Features
- On-chain profiles with skills, rate, bio, and reputation
- Freelancer marketplace with search
- AI-verified escrow using `gl.eq_principle.prompt_non_comparative`
- GNS (.gen name) integration for human-readable identities
- Real-time 5-second polling
- Dark/light mode
- Animated Mochi mascot

## Stack
- GenLayer Bradbury Testnet (Python Intelligent Contract)
- Next.js 16 + TypeScript
- genlayer-js + wagmi + RainbowKit
- Vercel
