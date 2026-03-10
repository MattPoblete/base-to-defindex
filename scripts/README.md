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

   | Variable | Required | Description |
   | --- | --- | --- |
   | `CROSSMINT_ENV` | Yes | `staging` or `production` |
   | `CROSSMINT_SERVER_API_KEY` | Yes | Crossmint server-side API key (`sk_staging_...` or `sk_production_...`) |
   | `CROSSMINT_WALLET_EMAIL` | Yes | Email used as the Crossmint wallet owner identity |
   | `EVM_PRIVATE_KEY` | Yes | EVM private key — acts as `adminSigner` on the Base smart wallet (no OTP) |
   | `STELLAR_SERVER_KEY` | Yes | Stellar ed25519 secret key — acts as `adminSigner` on the Stellar smart wallet |
   | `BASE_RPC_URL` | No | JSON-RPC endpoint for Base mainnet (default: `https://mainnet.base.org`) |
   | `SOROBAN_RPC_URL` | No | Soroban RPC endpoint (default: `https://rpc.stellar.org:443`) |
   | `STELLAR_HORIZON_URL` | No | Stellar Horizon URL (default: `https://horizon.stellar.org`) |
   | `NEAR_INTENTS_JWT` | No | JWT for Near Intents / Defuse — required for `near-intents` script only |

   **Generate keys:**
   ```bash
   # EVM private key
   node -e "const {ethers}=require('ethers'); console.log(ethers.Wallet.createRandom().privateKey)"

   # Stellar keypair
   node -e "import('@stellar/stellar-base').then(({Keypair})=>{ const kp=Keypair.random(); console.log('secret:',kp.secret(),'\\npublic:',kp.publicKey()) })"
   ```

---

## Bridge Scripts

### Sodax + Crossmint (Primary)

Full server-side bridge from Base USDC to Stellar USDC. Uses a Crossmint EVM smart wallet
as the signer on Base, and delivers USDC to a Crossmint Stellar smart wallet via the Sodax intent protocol.

```bash
# Auto-discover Stellar recipient from Crossmint (same email as CROSSMINT_WALLET_EMAIL)
pnpm sodax-crossmint

# Override Stellar recipient address
pnpm sodax-crossmint -- <STELLAR_ADDRESS>
```

**Flow:** ERC-20 approve → Sodax `createIntent` on Base → Sonic hub → Solver fills → USDC on Stellar.

**First run:** If the EVM wallet has insufficient ETH or USDC, the script prints the wallet address
and exits with funding instructions. Fund the address and re-run.

| Command | Description | Status |
| --- | --- | --- |
| `pnpm sodax-crossmint` | Base USDC → Stellar USDC via Sodax intents + Crossmint wallets | ✅ Operational |
| `pnpm sodax-swap` | Swap-only on Base via Sodax (direct EVM wallet, no bridge) | ✅ Operational |
| `pnpm sodax-status -- <TX_HASH>` | Poll and decode an existing Sodax intent status | ✅ Operational |

### Allbridge Core

Direct SDK integration for EVM → Stellar liquidity transfers.

| Command | Description | Status |
| --- | --- | --- |
| `pnpm allbridge-bridge` | Bridge via Allbridge Core SDK | ⚠️ Operational — no C-address support |

### Near Intents (Defuse)

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

---

## Architecture (sodax-crossmint)

```
sodax-crossmint.ts
  ├── CrossmintRestClient          REST client for Crossmint Wallet API v2025-06-09
  │     ├── getOrCreateEvmScriptsWallet()   Creates EVM smart wallet with EVM external-wallet adminSigner
  │     ├── getStellarWalletAddress()       Creates/gets Stellar smart wallet with Stellar external-wallet adminSigner
  │     └── sendTransactionAndGetHash()     Signs + submits EVM txs; polls for receipt
  ├── CrossmintEvmSodaxAdapter     Implements IEvmWalletProvider for Sodax SDK
  └── SodaxBridgeService           getQuote → executeSwap → pollStatus
        └── sodax.swaps.*          Allowance check, approve, createIntent, getStatus
```

Key files:

| File | Purpose |
| --- | --- |
| `src/bridge/sodax-crossmint.ts` | Entry point — orchestrates the full bridge flow |
| `src/shared/crossmint-rest.ts` | Thin REST client for Crossmint Wallet API (no SDK dependency) |
| `src/shared/crossmint-adapters.ts` | Adapter: Crossmint REST → Sodax `IEvmWalletProvider` |
| `src/shared/sodax-service.ts` | `SodaxBridgeService` — quote / swap / poll |
| `src/shared/sodax.ts` | Sodax SDK init + shared utilities |
| `src/shared/config.ts` | Centralized env config |

### Wallet ownership model

Both wallets use the **server-key / external-wallet pattern** — no email OTP ever required:

- **EVM smart wallet** (Base): owned by `CROSSMINT_WALLET_EMAIL`, `adminSigner = EVM_PRIVATE_KEY`
- **Stellar smart wallet** (Soroban): owned by `CROSSMINT_WALLET_EMAIL`, `adminSigner = STELLAR_SERVER_KEY`
