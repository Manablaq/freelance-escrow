# Deployment reference

## Current production deployment

| Item | Value |
| --- | --- |
| Application | https://genmarket-escrow.vercel.app |
| Professional frontend baseline commit | `880bce5` |
| Network | GenLayer Bradbury Testnet |
| Chain ID | `4221` |
| RPC | https://rpc-bradbury.genlayer.com |
| Contract | `0x75af88bfA0592CFA63c06f2F68BfD35C13dDd4EF` |
| Deployment transaction | `0x27a83352d39feda126c0d122a3e3223c238708c99f75bfddbb3bf280283902b1` |
| Explorer | https://explorer-bradbury.genlayer.com/address/0x75af88bfA0592CFA63c06f2F68BfD35C13dDd4EF |
| Contract source | `contracts/freelance_market.py` |
| Source SHA-256 | `941104a3374f893c51a60281cdb942272b09bbe433e970e4f86baf3f4b73a08f` |

The deployed Bradbury contract at `0x75af88bfA0592CFA63c06f2F68BfD35C13dDd4EF` matches `contracts/freelance_market.py`.

## Frontend configuration

`lib/config.ts` defines the Bradbury chain, RPC, explorer, deployment transaction, and verified fallback contract. `NEXT_PUBLIC_FREELANCE_MARKET_ADDRESS` is an optional build-time override. Omit it to use the verified fallback, or set it explicitly to the same current address.

WalletConnect-based connectors require this public browser configuration:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_from_walletconnect_cloud
```

The value shown is an example label, not a literal valid project ID and should not be pasted unchanged. Create the real value in WalletConnect Cloud and configure it in Vercel for both preview and production deployments. Do not put a user-specific value in the repository. Like every `NEXT_PUBLIC_` value, it is browser-visible and frozen into the Next.js build; it is configuration rather than a private key, wallet credential, or private API secret.

When the value is present, RainbowKit uses `getDefaultConfig` with WalletConnect and injected browser-wallet support. When it is absent, `app/providers.tsx` deliberately creates an injected-wallet-only wagmi configuration. This keeps local and CI builds functional without substituting a fake project ID. WalletConnect production reliability remains unverified until the real Vercel value is configured and tested.

## Validation and release discipline

Before a frontend release, run `npm ci`, `npm run check`, the requested dependency audit, and `git diff --check`. The CI workflow performs only dependency installation, linting, building, and offline tests. It has no secrets and performs no contract writes or deployment.

Contract deployment and Vercel deployment are intentionally outside repository CI. A future contract change requires a new source hash and deployment record; it must never be described as matching the existing address without independent verification. Do not place deployer keys or wallet credentials in repository files or CI secrets used by pull-request workflows.
