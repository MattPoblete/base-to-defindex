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

#### Crossmint — required

| Variable | Description |
| --- | --- |
| `CROSSMINT_ENV` | `staging` or `production`. Controls which Crossmint API host and which chains are used (staging → Base Sepolia / testnet; production → Base mainnet / Stellar mainnet). |
| `CROSSMINT_SERVER_API_KEY` | Server-side API key from the [Crossmint console](https://www.crossmint.com/console/projects/apiKeys). Must start with `sk_staging_` or `sk_production_`. |
| `CROSSMINT_WALLET_EMAIL` | Email used as the **owner identity** of the Crossmint smart wallets. Crossmint requires an owner identity; we use email, but actual transaction signing is delegated to the keys below — no email OTP is ever sent. |
| `EVM_PRIVATE_KEY` | EVM private key (hex, `0x...`). Registered as the `adminSigner` on the Base EVM smart wallet. See [Why external-wallet?](#why-external-wallet) below. |
| `STELLAR_SERVER_KEY` | Stellar ed25519 secret key (`S...`). Its public key is registered as the `adminSigner` on the Stellar smart wallet. Same rationale as `EVM_PRIVATE_KEY`. |

#### RPC endpoints — optional (defaults shown)

| Variable | Default | Description |
| --- | --- | --- |
| `BASE_RPC_URL` | `https://mainnet.base.org` | JSON-RPC endpoint for Base (or Base Sepolia when staging). |
| `SOROBAN_RPC_URL` | `https://rpc.stellar.org:443` | Soroban RPC for Stellar smart contract calls. |
| `STELLAR_HORIZON_URL` | `https://horizon.stellar.org` | Stellar Horizon for account and transaction queries. |

#### DeFindex vault — optional

| Variable | Description |
| --- | --- |
| `DEFINDEX_VAULT_ADDRESS` | Soroban contract address of the DeFindex vault. If set, USDC received on Stellar is automatically deposited after bridging. |
| `DEFINDEX_API_URL` | DeFindex API base URL (defaults to `https://api.defindex.io`). |
| `DEFINDEX_API_KEY` | DeFindex API key, if required by the target vault. |

#### Near Intents — optional

| Variable | Description |
| --- | --- |
| `NEAR_INTENTS_JWT` | JWT for the Near Intents / Defuse 1Click API. Only needed for the `near-intents` script. |

### Generate keys

```bash
# EVM private key
node -e "const {ethers}=require('ethers'); console.log(ethers.Wallet.createRandom().privateKey)"

# Stellar keypair (secret + public)
node -e "import('@stellar/stellar-base').then(({Keypair})=>{ const kp=Keypair.random(); console.log('secret:',kp.secret(),'\npublic:',kp.publicKey()) })"
```

---

## Why external-wallet?

Crossmint smart wallets have two separate roles:

- **Owner** — the identity the wallet is associated with (we use email).
- **adminSigner** — the key that actually authorizes transactions.

By default, authorizing a transaction triggers an OTP to the owner's email. For server-side automation that is unusable.

Setting `adminSigner` to `type: "external-wallet"` with a local private key overrides that: **the private key becomes the sole transaction signer**, and no email interaction is ever required. The ownership identity (email) is kept only because Crossmint requires it for wallet creation.

This pattern works for both chains:
- **EVM (Base):** `EVM_PRIVATE_KEY` → Ethereum wallet → adminSigner on the Base smart wallet.
- **Stellar (Soroban):** `STELLAR_SERVER_KEY` → ed25519 keypair → adminSigner on the Stellar smart wallet.

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

**Flow:** ERC-20 approve → Sodax `createIntent` on Base → Sonic hub → Solver fills → USDC on Stellar → (optional) DeFindex vault deposit.

**First run:** The script checks that the EVM wallet holds at least `0.001 ETH` (gas) and the configured USDC amount. If either is short, it prints the wallet address and exits with funding instructions. Fund the address and re-run.

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
  │     ├── getOrCreateEvmWallet()         GET email:{email}:evm; creates with EVM external-wallet adminSigner if missing
  │     ├── getStellarWalletAddress()      GET email:{email}:stellar; creates with Stellar external-wallet adminSigner if missing
  │     └── sendTransactionAndGetHash()    Signs + submits EVM txs via approval flow; polls for receipt
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

Both wallets use the **external-wallet / adminSigner pattern** — no email OTP ever required:

| Wallet | Owner (identity) | adminSigner (signs txs) |
| --- | --- | --- |
| EVM smart wallet (Base) | `CROSSMINT_WALLET_EMAIL` | `EVM_PRIVATE_KEY` |
| Stellar smart wallet (Soroban) | `CROSSMINT_WALLET_EMAIL` | `STELLAR_SERVER_KEY` (ed25519 public key) |

See [Why external-wallet?](#why-external-wallet) for the full rationale.
