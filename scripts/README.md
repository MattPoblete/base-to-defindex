# Bridge & Wallet Scripts

CLI tools for managing wallets and interacting with cross-chain bridge protocols from a server-side Node.js environment.

## Prerequisites & Setup

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment variables:**

   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

### Environment Variables

#### Crossmint — required for Crossmint flow

| Variable | Description |
| --- | --- |
| `CROSSMINT_ENV` | `staging` or `production`. Controls which Crossmint API host and which chains are used. |
| `CROSSMINT_SERVER_API_KEY` | Server-side API key. Must start with `sk_staging_` or `sk_production_`. |
| `CROSSMINT_WALLET_EMAIL` | Email used as the owner identity of the Crossmint smart wallets. |
| `EVM_PRIVATE_KEY` | EVM private key (`0x...`). Registered as `adminSigner` on the Base EVM smart wallet. |
| `STELLAR_SERVER_KEY` | Stellar ed25519 secret key (`S...`). Registered as `adminSigner` on the Stellar smart wallet. |

#### Privy — required for Privy flow

| Variable | Description |
| --- | --- |
| `PRIVY_APP_ID` | Privy App ID from the dashboard. |
| `PRIVY_APP_SECRET` | Privy App Secret. |
| `PRIVY_AUTHORIZATION_PRIVATE_KEY` | P-256 private key in `wallet-auth:<base64-PKCS8-DER>` format. |
| `PRIVY_AUTHORIZATION_PUBLIC_KEY` | Matching P-256 public key. Also register in the Privy Dashboard. |

#### RPC endpoints — optional (defaults shown)

| Variable | Default | Description |
| --- | --- | --- |
| `BASE_RPC_URL` | `https://mainnet.base.org` | JSON-RPC endpoint for Base. |
| `SOROBAN_RPC_URL` | `https://rpc.stellar.org:443` | Soroban RPC for Stellar smart contract calls. |
| `STELLAR_HORIZON_URL` | `https://horizon.stellar.org` | Stellar Horizon for account and transaction queries. |

#### Other — optional

| Variable | Description |
| --- | --- |
| `DEFINDEX_API_KEY` | Bearer token for the Defindex API (required for vault deposit). |
| `NEAR_INTENTS_JWT` | JWT for the Near Intents / Defuse 1Click API. Only needed for the `near-intents` script. |

---

## Bridge Scripts

### Sodax + Crossmint (Primary)

Full server-side bridge from Base USDC to Stellar USDC. Uses a Crossmint EVM smart wallet
as the signer on Base, and delivers USDC to a Crossmint Stellar smart wallet via the Sodax
intent protocol.

```bash
# Auto-discover Stellar recipient from Crossmint (same email as CROSSMINT_WALLET_EMAIL)
pnpm sodax-crossmint

# Override Stellar recipient address
pnpm sodax-crossmint -- <STELLAR_ADDRESS>
```

| Command | Description | Status |
| --- | --- | --- |
| `pnpm sodax-crossmint` / `pnpm demo` | Base USDC → Stellar USDC via Sodax + Crossmint wallets | ✅ Operational |
| `pnpm sodax-swap` | Swap-only on Base via Sodax (direct EVM wallet, no bridge) | ✅ Operational |
| `pnpm sodax-status -- <TX_HASH>` | Poll and decode an existing Sodax intent status | ✅ Operational |

### Sodax + Privy

Full server-side bridge using Privy TEE wallets for both EVM and Stellar.

| Command | Description | Status |
| --- | --- | --- |
| `pnpm privy-mainnet` | Base USDC → Stellar USDC via Sodax + Privy wallets | ✅ Operational |

### 🚧 Allbridge Core

Direct SDK integration for EVM → Stellar liquidity transfers.

| Command | Description | Status |
| --- | --- | --- |
| `pnpm allbridge-bridge` | Bridge via Allbridge Core SDK | ⚠️ Operational — no C-address support |

### 🚧 Near Intents (Defuse)

Cross-chain intent messaging via the Near/Defuse protocol.

| Command | Description | Status |
| --- | --- | --- |
| `pnpm near-intents` | Bridge via Near Intents | ⚠️ Operational — no C-address support |

---

## Wallet Utilities

| Command | Description | Status |
| --- | --- | --- |
| `pnpm base-wallet` | Create / fund / inspect Crossmint EVM smart wallet on Base | ✅ Stable |
| `pnpm stellar-wallet` | Create / inspect Crossmint Stellar smart wallet | ✅ Stable |
| `pnpm privy-base` | Create / inspect Privy EVM wallet on Base Sepolia | ✅ Stable |
| `pnpm privy-stellar` | Create / inspect Privy Stellar wallet on testnet | ✅ Stable |
| `pnpm privy-defindex` | Privy Stellar wallet → Defindex vault deposit (testnet) | ✅ Stable |
| `pnpm privy-keygen` | Generate a P-256 Authorization Key pair for Privy | ✅ Stable |

---

## Architecture

```
sodax-crossmint.ts
  ├── CrossmintRestClient          REST client for Crossmint Wallet API v2025-06-09
  │     ├── getOrCreateEvmWallet()
  │     ├── getStellarWalletAddress()
  │     └── sendTransactionAndGetHash()
  ├── CrossmintEvmSodaxAdapter     Implements IEvmWalletProvider for Sodax SDK
  └── SodaxBridgeService           getQuote → executeSwap → pollStatus
```

Key files:

| File | Purpose |
| --- | --- |
| `src/bridge/sodax-crossmint.ts` | Entry point — orchestrates the full bridge flow (Crossmint) |
| `src/privy/privy-mainnet-poc.ts` | Entry point — orchestrates the full bridge flow (Privy) |
| `src/shared/crossmint-rest.ts` | Thin REST client for Crossmint Wallet API |
| `src/shared/crossmint-adapters.ts` | Adapter: Crossmint REST → Sodax `IEvmWalletProvider` |
| `src/shared/privy-client.ts` | PrivyClient singleton + `buildAuthContext()` |
| `src/shared/privy-evm-sodax-adapter.ts` | Adapter: Privy → Sodax `IEvmWalletProvider` |
| `src/shared/sodax-service.ts` | `SodaxBridgeService` — quote / swap / poll |
| `src/shared/sodax.ts` | Sodax SDK init + shared utilities |
| `src/shared/config.ts` | Centralized env config |

---

## Documentation

Detailed guides are in the [`docs/`](./docs/) folder:

| Document | Description |
| --- | --- |
| [docs/index.md](./docs/index.md) | Master index — start here |
| [docs/crossmint-bridge.md](./docs/crossmint-bridge.md) | Full Crossmint bridge guide (step-by-step, sequence diagram, gotchas) |
| [docs/privy-bridge.md](./docs/privy-bridge.md) | Full Privy bridge guide (step-by-step, error log, design decisions) |
| [docs/privy-pocs.md](./docs/privy-pocs.md) | Quickstart for all 4 Privy POCs |
| [docs/custodial-vs-selfcustodial.md](./docs/custodial-vs-selfcustodial.md) | Custodial vs self-custodial architecture comparison |
