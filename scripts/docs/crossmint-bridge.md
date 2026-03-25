# Base → Stellar → Defindex: Crossmint Bridge Guide

Complete technical reference for bridging USDC from Base (EVM) to a Defindex vault on
Stellar using the Sodax SDK and Crossmint smart wallets via REST API.

For the Privy-based equivalent see [privy-bridge.md](./privy-bridge.md).

---

## Architecture Overview

```
[Crossmint EVM Smart Wallet — Base]
      │
      │  1. ERC-20 approve (via Crossmint REST)
      │  2. createIntent (via Crossmint REST)
      │     └─ Each tx: POST /transactions → sign approval → POST /approvals → poll
      ▼
[Sodax Spoke Contract — Base]
      │
      │  Relayer picks up intent
      ▼
[Sodax Hub — Sonic Chain]
      │
      │  Solver fills intent, marks SOLVED
      ▼
[Crossmint Stellar Smart Wallet — receives USDC]
      │
      │  No Horizon polling needed — Crossmint handles delivery
      ▼
[Defindex Vault — Soroban contract-call via Crossmint REST]
      │
      │  POST /transactions (type: contract-call)
      │  sign base64 XDR approval with Stellar keypair
      ▼
[Vault shares issued to Stellar wallet]
```

**Chain IDs used:**

| Chain   | SDK Constant               | Value              |
|---------|----------------------------|--------------------|
| Base    | `BASE_MAINNET_CHAIN_ID`    | `"eip155:8453"`    |
| Stellar | `STELLAR_MAINNET_CHAIN_ID` | `"stellar:pubnet"` |
| Sonic   | `SONIC_MAINNET_CHAIN_ID`   | Hub / relay chain  |

---

## Module Architecture

```text
scripts/src/
│
├── bridge/
│   ├── sodax-crossmint.ts       ← Entry point. Orchestrates the full 5-step flow.
│   ├── sodax-swap.ts            ← Standalone: execute swap only (no vault deposit)
│   └── sodax-status.ts          ← Standalone: poll a specific intent hash
│
└── shared/
    ├── config.ts                ← Centralized env config (staging/production)
    ├── bridge-types.ts          ← Shared interfaces: BridgeToken, SwapParams, BridgeQuote,
    │                               BridgeExecutionResult, BridgePollResult, IBridgeService
    ├── crossmint-rest.ts        ← CrossmintRestClient
    │   ├── getOrCreateEvmWallet()       → create/get EVM smart wallet
    │   ├── getStellarWalletAddress()    → create/get Stellar smart wallet
    │   └── sendTransactionAndGetHash()  → create tx + sign + poll (EVM)
    ├── crossmint-adapters.ts    ← CrossmintEvmSodaxAdapter
    │   └── implements IEvmWalletProvider → bridges Sodax ↔ Crossmint REST
    ├── sodax.ts                 ← Sodax SDK init + helpers (handleAllowance, sleep, …)
    ├── sodax-service.ts         ← SodaxBridgeService
    │   ├── getQuote()           → swap quote
    │   ├── executeSwap()        → ERC-20 approve + create intent
    │   └── pollStatus()         → poll until SOLVED on Stellar
    └── defindex-service.ts      ← DefindexService
        └── depositToVault()     → Soroban contract-call via Crossmint REST (Stellar)
```

---

## Prerequisites

### Environment Variables

```bash
# Crossmint
CROSSMINT_SERVER_API_KEY=sk_production_...  # Must start with sk_ (not ck_)
CROSSMINT_WALLET_EMAIL=user@example.com     # Wallet identity (used in locator)
CROSSMINT_ENV=production                    # "staging" or "production"

# Signing keys
EVM_PRIVATE_KEY=0x...           # Controls adminSigner of the EVM smart wallet
STELLAR_SERVER_KEY=S...         # Stellar ed25519 secret key — controls Stellar wallet

# RPC
BASE_RPC_URL=https://mainnet.base.org

# Bridge amount
BRIDGE_AMOUNT=0.1               # In USDC (6 decimals internally)
```

**Critical:** `CROSSMINT_SERVER_API_KEY` must start with `sk_`. Keys starting with `ck_`
are client-only and lack wallet transaction signing permissions.

### Token Addresses (Mainnet)

```ts
// Base
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  // 6 decimals

// Stellar
USDC_SAC    = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"  // 7 decimals
USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"

// Defindex vault (Soroswap Earn USDC)
SOROSWAP_EARN_USDC_VAULT = "CA2FIPJ7U6BG3N7EOZFI74XPJZOEOD4TYWXFVCIO5VDCHTVAGS6F4UKK"
```

### Minimum Balances

| Asset | Minimum    | Who funds                             |
|-------|------------|---------------------------------------|
| ETH   | 0.001 ETH  | Manual — send to EVM smart wallet     |
| USDC  | ≥ amount   | Manual — send to EVM smart wallet     |
| XLM   | Auto       | Crossmint sponsors on wallet creation |

### Staging vs Production

| Setting     | Staging                         | Production                       |
|-------------|---------------------------------|----------------------------------|
| Base URL    | `https://staging.crossmint.com` | `https://www.crossmint.com`      |
| Chain       | `base-sepolia`                  | `base`                           |
| Token       | USDXM `0x14196F08...`           | USDC `0x833589fC...`             |
| API key     | `sk_staging_...`                | `sk_production_...`              |
| Sodax SDK   | Always mainnet chain IDs        | Same                             |

**Note:** The Sodax SDK always targets mainnet chain IDs regardless of `CROSSMINT_ENV`.

---

## Step 1 — EVM Wallet Setup

```ts
const restClient = new CrossmintRestClient(
  process.env.CROSSMINT_SERVER_API_KEY,
  "https://www.crossmint.com"       // or staging URL
);

const { address, locator } = await restClient.getOrCreateEvmWallet();
// address  = "0x291d9..."  (on-chain smart wallet address)
// locator  = "0x291d9..."  (same — use address for all tx calls)
```

**Lookup + create logic:**

```
GET /api/2025-06-09/wallets/email:user@example.com:evm
  └─► 200 → return address
  └─► 404 → create:

POST /api/2025-06-09/wallets
{
  "chainType": "evm",
  "type": "smart",
  "owner": "email:user@example.com",
  "config": {
    "adminSigner": { "type": "external-wallet", "address": "0xYOUR_EVM_KEY_ADDRESS" }
  }
}
```

**Why `adminSigner: external-wallet`?**

The `adminSigner` separates wallet identity (email) from wallet control (private key).
The email owner never needs to sign anything — your `EVM_PRIVATE_KEY` is the sole
transaction approver. This enables fully server-side, non-interactive automation.

**No `alias` — single canonical wallet per email:**
The script uses the primary `email:{email}:evm` wallet. The locator used for all
transaction calls is always the **on-chain address** (unambiguous, works everywhere).

**Error history that led to this pattern:**

| Attempt | Error | Root cause |
|---------|-------|-----------|
| `signer: "api-key"` in tx body | `Invalid address: api-key` | `api-key` signer deprecated in API `2025-06-09` |
| `external-wallet` as operational signer (POST-creation) | `evm-keypair:0x... awaiting approval` | Email wallet requires OTP to add new operational signers |
| `owner: "external-wallet:0x..."` | `Locator prefix 'external-wallet' is not valid` | `owner` must be `email:` / `userId:` — `external-wallet` only valid in `adminSigner` |
| `adminSigner: external-wallet` **at creation** | ✅ Works | Correct approach |

---

## Step 2 — Stellar Wallet Setup

```ts
const stellarAddress = await restClient.getStellarWalletAddress();
// Returns the Stellar G-address of the smart wallet
```

**Create body:**

```json
{
  "chainType": "stellar",
  "type": "smart",
  "owner": "email:user@example.com",
  "config": {
    "adminSigner": {
      "type": "external-wallet",
      "address": "GYOUR_STELLAR_PUBLIC_KEY"
    }
  }
}
```

The `adminSigner` address is the Stellar public key derived from `STELLAR_SERVER_KEY`:

```ts
const keypair = Keypair.fromSecret(process.env.STELLAR_SERVER_KEY);
const stellarPublicKey = keypair.publicKey(); // "G..."
```

**XLM funding:** Crossmint automatically funds newly created Stellar wallets with enough
XLM for the base reserve and fees. No manual sponsoring required.

**Wallet locator for Stellar transactions:** use the Stellar G-address directly.

---

## Step 3 — Sodax SDK Init + Quote

```ts
import { Sodax } from "@sodax/sdk";

const sodax = new Sodax();
const result = await sodax.initialize();
if (!result.ok) throw new Error(`Init failed: ${result.error}`);

// Quote
const quoteResult = await sodax.swaps.getQuote({
  token_src: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  token_src_blockchain_id: BASE_MAINNET_CHAIN_ID as SpokeChainId,
  token_dst: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  token_dst_blockchain_id: STELLAR_MAINNET_CHAIN_ID as SpokeChainId,
  amount: amountIn,           // bigint, 6 decimals (USDC on Base)
  quote_type: "exact_input",
});
// quoteResult.value.quoted_amount → bigint output in Stellar stroops (7 decimals)
```

**Gotcha — transient -999 errors:** Retry up to 5 times with a 5-second delay.

---

## Step 4 — EVM Transaction Flow (Allowance + Swap)

Both the ERC-20 approval and the intent creation go through the same Crossmint transaction
flow. `CrossmintEvmSodaxAdapter` implements `IEvmWalletProvider` and delegates every
`sendTransaction` call to `CrossmintRestClient.sendTransactionAndGetHash()`.

### Transaction lifecycle

```
POST /api/2025-06-09/wallets/{evmAddress}/transactions
{
  "params": {
    "calls": [{ "to": "0x...", "data": "0x...", "value": "0x0" }],
    "chain": "base",
    "signer": "external-wallet:0xYOUR_EVM_KEY_ADDRESS"
  }
}
→ { "id": "tx_...", "status": "awaiting-approval",
    "approvals": { "pending": [{ "signer": {...}, "message": "0x..." }] } }

↓ status === "awaiting-approval"

// Sign the raw hex approval message
const signature = await signer.signMessage(ethers.getBytes(message));

POST /api/2025-06-09/wallets/{evmAddress}/transactions/{txId}/approvals
{ "approvals": [{ "signer": "external-wallet:0x...", "signature": "0x..." }] }

↓ Crossmint broadcasts on-chain

GET /api/2025-06-09/wallets/{evmAddress}/transactions/{txId}  (poll every 5s)
→ { "onChain": { "txId": "0x..." } }   ← final on-chain hash
```

**Critical — EVM message signing:**
The approval message is **raw hex bytes**, not a UTF-8 string. Always use:

```ts
const signature = await signer.signMessage(ethers.getBytes(message));
//                                          ^^^^^^^^^^^^^^^^^^^^^^^^
//                                          converts hex string to Uint8Array first
```

Using `signer.signMessage(message)` directly would double-hash it and produce an invalid signature.

---

## Step 5 — Poll Bridge Status

```ts
// Status codes
// -1 = NOT_FOUND (API still indexing)
//  1 = NOT_STARTED_YET
//  2 = STARTED_NOT_FINISHED (processing on Hub/Sonic)
//  3 = SOLVED ✅
//  4 = FAILED ❌

const { destTxHash, amountReceived } = await bridgeService.pollStatus(statusHash);
// amountReceived → bigint, Stellar stroops (7 decimals)
// destTxHash     → Stellar transaction hash
```

**Getting settled amount and Stellar tx hash (inside `pollStatus`):**

```ts
// Actual settled amount (not the quote)
const intentState = await sodax.swaps.getFilledIntent(fillTxHash);
const amountReceived = intentState.receivedOutput;

// Stellar tx hash via packet relay
const packetResult = await sodax.swaps.getSolvedIntentPacket({
  chainId: SONIC_MAINNET_CHAIN_ID,
  fillTxHash,
});
const destTxHash = packetResult.value.dst_tx_hash;
```

**No Horizon polling needed.** Unlike the Privy flow, Crossmint abstracts Stellar
transaction submission and handles confirmation internally.

---

## Step 6 — Defindex Deposit (Soroban contract-call)

`DefindexService.depositToVault()` issues a Soroban `contract-call` transaction via the
Crossmint REST API, signed with the Stellar server key.

### Transaction body

```json
POST /api/2025-06-09/wallets/{stellarAddress}/transactions
{
  "params": {
    "transaction": {
      "type": "contract-call",
      "contractId": "CA2FIPJ7U6BG3N7EOZFI74XPJZOEOD4TYWXFVCIO5VDCHTVAGS6F4UKK",
      "method": "deposit",
      "args": {
        "amounts_desired": ["926719"],
        "amounts_min":     ["921926"],
        "from":            "G...",
        "invest":          true
      }
    },
    "signer": "external-wallet:GYOUR_STELLAR_PUBLIC_KEY"
  }
}
```

`amounts_desired` and `amounts_min` are string representations of stroops (7 decimals).
`amounts_min` applies 0.5% slippage: `floor(amounts_desired * 0.995)`.

### Stellar approval signing

The approval message for Stellar transactions is **base64-encoded XDR**, not hex bytes.

```ts
const pending = tx.approvals.pending[0];
const messageBytes = Buffer.from(pending.message, "base64");
const signature = keypair.sign(messageBytes).toString("base64");

// Submit
await fetch(`.../transactions/${tx.id}/approvals`, {
  method: "POST",
  body: JSON.stringify({
    approvals: [{ signer: "external-wallet:G...", signature }]
  })
});
```

**Critical difference from EVM:** Using `ethers.getBytes()` here would fail — the
Stellar message is base64, not hex. The signing algorithm is also different (Ed25519 vs
ECDSA secp256k1).

---

## Full Flow at a Glance

```ts
// 1. Init clients
const restClient    = new CrossmintRestClient(apiKey, baseUrl);
const provider      = new ethers.JsonRpcProvider(BASE_RPC_URL);
const sodax         = await initializeSodax();
const bridgeService = new SodaxBridgeService(sodax);

// 2. Wallets
const { address: evmAddress, locator } = await restClient.getOrCreateEvmWallet();
const stellarAddress = await restClient.getStellarWalletAddress();

// 3. Check balances — exit if insufficient
const [ethBalance, usdcBalance] = await Promise.all([
  provider.getBalance(evmAddress),
  usdcContract.balanceOf(evmAddress),
]);

// 4. Bridge
const crossmintAdapter = new CrossmintEvmSodaxAdapter(
  restClient, evmAddress, locator, "base", provider
);
const quote = await bridgeService.getQuote(swapParams);
const { srcTxHash, statusHash } = await bridgeService.executeSwap(
  crossmintAdapter, swapParams, quote
);
const { destTxHash, amountReceived } = await bridgeService.pollStatus(statusHash);

// 5. Defindex deposit (no Horizon poll needed)
const defindexService = new DefindexService(stellarAddress);
const depositTxHash = await defindexService.depositToVault(
  SOROSWAP_EARN_USDC_VAULT,
  amountReceived,
  stellarAddress
);
```

---

## Decimal Reference

| Token              | Decimals | 1 unit in base units  |
|--------------------|----------|-----------------------|
| USDC (Base)        | 6        | `1_000_000`           |
| USDC (Stellar SAC) | 7        | `10_000_000` (stroops)|
| XLM                | 7        | `10_000_000` (stroops)|

---

## Wallet Locator Format Reference

```
email:<email>:<chainType>[:<walletType>][:alias:<alias>]

Examples:
  email:user@example.com:evm                        ← main EVM wallet (server-controlled)
  email:user@example.com:stellar                    ← Stellar wallet (server-controlled)
  0x291d9Cd5150888eC475EF9A362A40B580Dc4a953        ← by address (always valid, used for txs)
  G...                                              ← Stellar address (used for Stellar txs)
```

**Rule:** Always use the on-chain address (`0x...` or `G...`) as the locator for transaction calls.

---

## Full Sequence Diagram

```
Script                  Crossmint API          Base RPC         Sodax SDK        Stellar/DeFindex
  │                          │                    │                 │                    │
  │── GET EVM wallet ───────►│                    │                 │                    │
  │◄─ 404 ───────────────────│                    │                 │                    │
  │── POST create EVM w. ───►│                    │                 │                    │
  │   (adminSigner=ext-w)    │                    │                 │                    │
  │◄─ { address: 0x291d } ───│                    │                 │                    │
  │                          │                    │                 │                    │
  │── GET stellar wallet ───►│                    │                 │                    │
  │◄─ 404 ───────────────────│                    │                 │                    │
  │── POST create stellar w.►│                    │                 │                    │
  │   (adminSigner=GKEY)     │                    │                 │                    │
  │◄─ { address: G... } ─────│                    │                 │                    │
  │                          │                    │                 │                    │
  │── balanceOf(0x291d) ─────────────────────────►│                 │                    │
  │◄─ USDC balance ───────────────────────────────│                 │                    │
  │                          │                    │                 │                    │
  │── getQuote() ──────────────────────────────────────────────────►│                    │
  │◄─ { amountOut } ────────────────────────────────────────────────│                    │
  │                          │                    │                 │                    │
  │── isAllowanceValid() ──────────────────────────────────────────►│                    │
  │◄─ false ────────────────────────────────────────────────────────│                    │
  │                          │                    │                 │                    │
  │── POST /transactions ───►│                    │                 │                    │
  │   (ERC-20 approve)       │                    │                 │                    │
  │◄─ { id, awaiting } ──────│                    │                 │                    │
  │── signMessage(hex bytes) │                    │                 │                    │
  │── POST /approvals ──────►│                    │                 │                    │
  │                          │── broadcast tx ───►│                 │                    │
  │── GET /transactions ────►│                    │                 │                    │
  │◄─ { onChain.txId } ──────│                    │                 │                    │
  │── waitForReceipt ────────────────────────────►│                 │                    │
  │                          │                    │                 │                    │
  │── POST /transactions ───►│                    │                 │                    │
  │   (createIntent)         │                    │                 │                    │
  │◄─ { id, awaiting } ──────│                    │                 │                    │
  │── signMessage(hex bytes) │                    │                 │                    │
  │── POST /approvals ──────►│                    │                 │                    │
  │◄─ confirmed ─────────────│                    │                 │                    │
  │                          │                    │                 │                    │
  │── getStatus(intentHash) ───────────────────────────────────────►│                    │
  │   (polling every 10s)    │                    │   Sonic hub     │                    │
  │◄─ SOLVED ───────────────────────────────────────────────────────│                    │
  │── getFilledIntent(fillTxHash) ─────────────────────────────────►│                    │
  │◄─ { receivedOutput } ───────────────────────────────────────────│                    │
  │── getSolvedIntentPacket() ─────────────────────────────────────►│                    │
  │◄─ { dst_tx_hash } ──────────────────────────────────────────────│                    │
  │                          │                    │                 │                    │
  │── POST /transactions ───►│                    │                 │                    │
  │   (contract-call deposit)│                    │                 │                    │
  │◄─ { id, awaiting } ──────│                    │                 │                    │
  │── sign(base64 XDR)       │                    │                 │                    │
  │── POST /approvals ──────►│                    │                 │                    │
  │                          │─── submit to ────────────────────────────────────────────►│
  │                          │    Soroban         │                 │                    │
  │◄─ { onChain.txId } ──────────────────────────────────────────────────────────────────│
```

---

## Known Gotchas

| Error | Root cause | Fix |
|-------|-----------|-----|
| `Invalid address: api-key` | `api-key` signer deprecated in API `2025-06-09` | Use `external-wallet` + manual signing |
| `evm-keypair:0x... awaiting approval` | Email wallet requires OTP to approve new signers added post-creation | Create wallet with `adminSigner: external-wallet` from the start |
| `Locator prefix 'external-wallet' is not valid` | `external-wallet` not valid as wallet owner | Only valid in `adminSigner`; `owner` must be `email:` or `userId:` |
| Wallet not found after creation | Using `email:...:evm` locator in tx calls | Always use on-chain address for transactions |
| Stellar approval signature rejected | EVM hex-byte signing used for Stellar | Stellar messages are base64 XDR — use `Buffer.from(msg, "base64")` + `keypair.sign()` |
| `amountReceived` is `0n` | `getSolvedIntentPacket` doesn't return the amount | Fetch from `sodax.swaps.getFilledIntent(fillTxHash).receivedOutput` |
| Quote returns -999 error | Transient solver unavailability | Retry up to 5× with 5s backoff |

---

## Crossmint vs Privy — Key Differences

| Aspect | Crossmint | Privy |
|---|---|---|
| EVM wallet type | Smart wallet (ERC-4337) | EOA (TEE) |
| EVM signing | `CrossmintRestClient` handles tx + approval | `privy.sendTransaction` (BigInt→hex needed) |
| Stellar deposit | Soroban `contract-call` via Crossmint REST | Manual XDR build + `rawSign` + Horizon POST |
| Horizon balance poll | Not needed | Required before Defindex deposit |
| XLM funding | Auto on wallet creation | Manual (`STELLAR_SERVER_KEY` sponsors) |
| Auth primitive | `EVM_PRIVATE_KEY` (adminSigner) | P-256 Authorization Key |
| Approval messages | EVM = raw hex; Stellar = base64 XDR | N/A (Privy signs hash directly) |

---

## Integration Checklist (New Crossmint Account)

- [ ] `CROSSMINT_SERVER_API_KEY` — server key from the target Crossmint project
- [ ] `CROSSMINT_WALLET_EMAIL` — email identity used as the wallet locator
- [ ] `EVM_PRIVATE_KEY` — key that acts as `adminSigner` for the EVM smart wallet
- [ ] `STELLAR_SERVER_KEY` — Stellar ed25519 secret key that acts as `adminSigner` for the Stellar smart wallet
- [ ] `DEFINDEX_VAULT_ADDRESS` — optional; omit to skip the vault deposit step

**Wallets that will be created (or reused if they exist):**

- EVM — Locator: `email:<CROSSMINT_WALLET_EMAIL>:evm`
  - Admin signer: `external-wallet:<EVM_PRIVATE_KEY address>`
  - Required balance: ETH for gas + USDC >= `BRIDGE_AMOUNT`
- Stellar — Locator: `email:<CROSSMINT_WALLET_EMAIL>:stellar`
  - Admin signer: `external-wallet:<STELLAR_SERVER_KEY public key>`
  - Required balance: XLM for fees (funded automatically by Crossmint on creation)

---

## Documentation References

### Crossmint

- **REST API Quickstart:** <https://docs.crossmint.com/wallets/quickstarts/restapi>
- **Wallet Signers (concept):** <https://docs.crossmint.com/wallets/concepts/wallet-signers>
- **Create Wallet API:** <https://docs.crossmint.com/api-reference/wallets/create-wallet>
- **Send Transaction EVM:** <https://docs.crossmint.com/wallets/guides/send-transaction-evm>
- **External Wallet Signer:** <https://docs.crossmint.com/wallets/guides/signers/external-wallet>
- **Registering a Signer:** <https://docs.crossmint.com/wallets/guides/signers/registering-a-signer>
- **API Key Signer (Deprecated):** <https://docs.crossmint.com/wallets/guides/signers/api-key>
- **Migration Guide v2:** <https://docs.crossmint.com/wallets/guides/migrate-to-v2>

### Sodax

- `Sodax.swaps.getQuote()` — returns quoted output amount
- `Sodax.swaps.swap()` — executes approve + createIntent
- `Sodax.swaps.getStatus()` — polls intent status on Sonic hub
- `Sodax.swaps.getFilledIntent()` — retrieves actual settled output amount (stroops)
- `Sodax.swaps.getSolvedIntentPacket()` — retrieves Stellar destination tx hash

### Ethers.js v6

- Sign raw hex message (EVM): `signer.signMessage(ethers.getBytes(hexMessage))`
- Derive wallet from key: `new ethers.Wallet(privateKey)`

### Stellar

- Sign base64 XDR message: `keypair.sign(Buffer.from(msg, "base64")).toString("base64")`
- Derive keypair: `Keypair.fromSecret(stellarServerKey)`
