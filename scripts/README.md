# Bridge & Wallet Scripts

CLI tools for managing wallets and interacting with cross-chain bridge protocols from a server-side Node.js environment.

## Prerequisites & Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Environment variables (`.env`):**

   | Variable | Required | Description |
   | --- | --- | --- |
   | `EVM_PRIVATE_KEY` | Yes | EVM private key — controls the Crossmint smart wallet as `adminSigner` |
   | `BASE_RPC_URL` | Yes | JSON-RPC endpoint for Base mainnet |
   | `CROSSMINT_SERVER_API_KEY` | Yes | Crossmint server-side API key (`sk_...`) |
   | `CROSSMINT_BASE_URL` | Yes | Crossmint API base URL (e.g. `https://www.crossmint.com`) |
   | `WALLET_EMAIL` | Yes | Email identity used to own the Crossmint smart wallet |
   | `BRIDGE_AMOUNT` | Yes | Amount of USDC to bridge (e.g. `1.0`) |
   | `CHAIN` | No | EVM chain name (default: `base`) |
   | `NEAR_INTENTS_JWT` | No | JWT for Near Intents / Defuse protocol only |

---

## Bridge Scripts

### Sodax + Crossmint (Primary)

Full server-side bridge from Base USDC to Stellar USDC. Uses Crossmint smart wallet
as the EVM signer and Sodax intent protocol for cross-chain delivery.

```bash
# Auto-discover Stellar recipient from Crossmint (same email)
npm run sodax-crossmint

# Override Stellar recipient address
npm run sodax-crossmint -- <STELLAR_ADDRESS>
```

**Flow:** ERC-20 approve → Sodax `createIntent` on Base → Sonic hub → Solver fills → USDC on Stellar.

**First run:** If the wallet has insufficient ETH or USDC, the script prints the wallet address
and exits with funding instructions. Fund the displayed address and re-run.

See [`SODAX_CROSSMINT_POC.md`](./SODAX_CROSSMINT_POC.md) for the full architecture breakdown,
design decisions, and troubleshooting guide.

| Command | Description | Status |
| --- | --- | --- |
| `npm run sodax-crossmint` | Base USDC → Stellar USDC via Sodax intents + Crossmint wallet | ✅ Operational |
| `npm run sodax-swap` | Swap-only on Base (no bridge, direct EVM wallet) | ✅ Operational |
| `npm run sodax-status -- <TX_HASH>` | Poll and decode an existing Sodax intent status | ✅ Operational |

### Allbridge Core

Direct SDK integration for EVM → Stellar liquidity transfers.

| Command | Description | Status |
| --- | --- | --- |
| `npm run allbridge-bridge` | Bridge via Allbridge Core SDK | ⚠️ Operational — no C-address support |

### Near Intents (Defuse)

Cross-chain intent messaging via the Near/Defuse protocol.

| Command | Description | Status |
| --- | --- | --- |
| `npm run near-intents` | Bridge via Near Intents | ⚠️ Operational — no C-address support |

---

## Wallet Utilities

| Command | Description | Status |
| --- | --- | --- |
| `npm run base-wallet` | Create / fund / inspect Crossmint smart wallet on Base | ✅ Stable |
| `npm run stellar-wallet` | Create / inspect Crossmint wallet on Stellar | ✅ Stable |

---

## Architecture (sodax-crossmint)

```
sodax-crossmint.ts
  ├── CrossmintRestClient          REST client for Crossmint Wallet API v2025-06-09
  │     ├── getOrCreateEvmScriptsWallet()   Creates wallet with external-wallet adminSigner
  │     ├── getStellarWalletAddress()       Looks up email-linked Stellar wallet
  │     └── sendTransactionAndGetHash()     Signs + submits EVM txs; polls for receipt
  ├── CrossmintEvmSodaxAdapter     Implements IEvmWalletProvider for Sodax SDK
  └── SodaxBridgeService           getQuote → executeSwap → pollStatus
        └── sodax.swaps.*          Allowance check, approve, createIntent, getStatus
```

Key files:

| File | Purpose |
| --- | --- |
| `src/bridge/sodax-crossmint.ts` | Entry point — orchestrates the full bridge flow |
| `src/shared/crossmint-rest.ts` | Thin REST client for Crossmint Wallet API |
| `src/shared/crossmint-adapters.ts` | Adapter: Crossmint REST → Sodax `IEvmWalletProvider` |
| `src/shared/sodax-service.ts` | `SodaxBridgeService` — quote / swap / poll |
| `src/shared/sodax.ts` | Sodax SDK init + shared utilities |
| `src/shared/bridge-types.ts` | Shared interfaces (`IBridgeService`, `SwapParams`, etc.) |
| `src/shared/config.ts` | Centralized env config |
