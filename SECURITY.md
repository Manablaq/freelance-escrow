# Security Policy

## Supported status

This repository and its deployed application are an experimental GenLayer Bradbury testnet project. There is no mainnet release or production financial-security guarantee. The current `main` branch is the only version considered for security review.

## Reporting a vulnerability

Use **Report a vulnerability** in the repository's GitHub **Security** tab when GitHub private vulnerability reporting is enabled. External reporters should not be told to create a draft security advisory, because that capability is not generally available to every reporter. Do not open a public issue for an unpatched vulnerability. Include affected files or routes, impact, reproducible steps, and a minimal proof of concept when safe.

Before this policy is published as the repository's only private reporting route, the maintainer must manually enable GitHub private vulnerability reporting in the repository security settings.

Never include private keys, seed phrases, wallet credentials, or other live secrets in a report. Maintainers should never ask a reporter to provide them.

## Scope

Reports may cover:

- the Next.js frontend and wallet transaction flow;
- the allowlisted `/api/contract` read route;
- the GenLayer intelligent contract in `contracts/freelance_market.py`;
- transaction receipt classification and accepted-state synchronization;
- repository automation or dependency issues with a demonstrated impact.

AI-assisted verification, public URL availability, testnet validator/provider behavior, wallet software, RPC availability, and user-supplied job terms are trust boundaries. Reports should distinguish an implementation vulnerability from those external or protocol-level assumptions.
