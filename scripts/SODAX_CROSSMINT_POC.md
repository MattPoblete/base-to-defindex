# POC: Sodax + Crossmint Bridge — Base → Stellar → DeFindex

> Knowledge dump: design decisions, lessons learned, and documentation references
> for developing the `sodax-crossmint.ts` server-side bridge + vault deposit script.
>
> **Last updated**: 2026-03-11
> **Status**: Full flow functional on mainnet — bridge (ERC-20 approve + intent) + DeFindex vault deposit.

---

## 1. Objective

Execute a **USDC on Base → USDC on Stellar → DeFindex vault deposit** flow entirely
server-side, using:

- **Crossmint** as wallet custodian for both EVM and Stellar smart wallets (key
  infrastructure, gas sponsorship)
- **Sodax SDK** as the bridge protocol (intent-based, hub on Sonic)
- **DeFindex API** for the final vault deposit on Stellar (optional)

The script must run without human interaction: no OTP, no browser, no Fireblocks.

---

## 2. Module Architecture

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
    │   ├── getOrCreateEvmWallet()       → create/get EVM smart wallet (no alias)
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

## 3. Stack and Relevant Versions

| Component | Version / Detail |
| --- | --- |
| Crossmint API | `2025-06-09` (current supported version) |
| Crossmint wallet type | `evm-smart-wallet` (ERC-4337 + ERC-7579) for EVM; `stellar-smart-wallet` for Stellar |
| Sodax SDK | `@sodax/sdk` (mainnet, hub on Sonic) |
| Ethers.js | v6 (approval message signing) |
| Runtime | `tsx` for direct TypeScript execution |
| Source chain | Base Mainnet (`BASE_MAINNET_CHAIN_ID`) |
| Destination chain | Stellar Mainnet |
| Token | USDC on Base → USDC on Stellar |
| Vault | DeFindex Soroswap EARN USDC vault (`CA2FIPJ7U6BG3N7EOZFI74XPJZOEOD4TYWXFVCIO5VDCHTVAGS6F4UKK`) |

---

## 4. The Crossmint Wallet — Design Decisions

### 4.1 Why REST API instead of the Crossmint SDK

The `@crossmint/wallets-sdk` requires **Fireblocks** for server-side custodial wallets.
Crossmint offers `evm-fireblocks-custodial` as a premium feature that is not available on
standard accounts.

**Decision:** Use the REST API directly with `fetch` + `X-API-KEY` header.

**Reference:** <https://docs.crossmint.com/wallets/quickstarts/restapi>

---

### 4.2 EVM Wallet — `external-wallet` as adminSigner

**History of errors that led to this solution:**

| Attempt | Result | Root cause |
| --- | --- | --- |
| `signer: "api-key"` in tx creation | ❌ `Invalid address: api-key` | `api-key` signer deprecated in API 2025-06-09 |
| `external-wallet` as operational signer | ❌ `evm-keypair:0x... awaiting approval` | Email wallet requires OTP to approve new operational signers |
| `owner: "external-wallet:0x..."` | ❌ `Locator prefix 'external-wallet' is not valid` | Wallet locator MUST be email/userId/etc. |
| **`adminSigner: { type: "external-wallet" }` at creation** | ✅ Works | Separates identity (email) from control (private key) |

**The correct EVM wallet creation:**

```json
POST /api/2025-06-09/wallets
{
  "chainType": "evm",
  "type": "smart",
  "owner": "email:user@example.com",
  "config": {
    "adminSigner": {
      "type": "external-wallet",
      "address": "0xYOUR_PRIVATE_KEY_ADDRESS"
    }
  }
}
```

**Result:**

- Wallet locator: `email:user@example.com:evm`
- Admin signer (recovery signer): `external-wallet:0x...` = our EVM private key
- **No email OTP required at any point**

**References:**

- <https://docs.crossmint.com/wallets/quickstarts/restapi>
- <https://docs.crossmint.com/wallets/concepts/wallet-signers>

---

### 4.3 No `alias` — single canonical EVM wallet per email

Earlier versions used `alias: "scripts"` to create a second wallet alongside the dapp
wallet. The current design eliminates the alias: the script uses the primary
`email:{email}:evm` wallet. The wallet locator used for all transaction calls is the
**on-chain address** (always unambiguous).

```text
GET /wallets/email:user@example.com:evm   → { address: "0x..." }
# All subsequent transactions use: /wallets/0x.../transactions
```

---

### 4.4 Stellar Wallet — server-controlled smart wallet via `external-wallet`

`getStellarWalletAddress()` now creates a server-controlled Stellar **smart** wallet
(not MPC) using the Stellar public key derived from `STELLAR_SERVER_KEY`. This allows
signing Soroban transactions server-side using the ed25519 keypair.

```json
POST /api/2025-06-09/wallets
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

**Critical difference from EVM approval:** Stellar approval messages are **base64-encoded
XDR**, not hex bytes. Sign with the ed25519 keypair and encode as base64:

```typescript
const messageBytes = Buffer.from(message, "base64");
const signature = keypair.sign(messageBytes).toString("base64");
```

---

### 4.5 Transaction flow with external-wallet signer (EVM)

```text
POST /wallets/{address}/transactions
{
  params: {
    calls: [{ to, data, value }],
    chain: "base",
    signer: "external-wallet:0xYOUR_ADDRESS"
  }
}
→ Response: { id, status: "awaiting-approval", approvals: { pending: [{ message: "0x..." }] } }

↓ status === "awaiting-approval"

const signature = signer.signMessage(ethers.getBytes(message))
  // message is raw hex — sign exactly as returned, NOT as a UTF-8 string

POST /wallets/{address}/transactions/{txId}/approvals
{ approvals: [{ signer: "external-wallet:0xYOUR_ADDRESS", signature }] }

↓ Crossmint broadcasts the tx on-chain

GET /wallets/{address}/transactions/{txId}  (polling every 5s)
→ { onChain: { txId: "0x..." } }  → final hash
```

**Critical note:** The EVM approval message must be signed as **raw hex bytes**, not
as a string. Use `ethers.getBytes(message)` before calling `signMessage()`.

**Reference:** <https://docs.crossmint.com/wallets/guides/send-transaction-evm>

---

### 4.6 DeFindex vault deposit — Soroban contract-call (Stellar)

After the bridge completes, `DefindexService.depositToVault()` issues a Soroban
`contract-call` transaction via Crossmint REST, signed with the Stellar server key:

```json
POST /api/2025-06-09/wallets/{stellarAddress}/transactions
{
  "params": {
    "transaction": {
      "type": "contract-call",
      "contractId": "CA2FIP...",
      "method": "deposit",
      "args": {
        "amounts_desired": ["<stroops>"],
        "amounts_min": ["<stroops_with_slippage>"],
        "from": "<stellarAddress>",
        "invest": true
      }
    },
    "signer": "external-wallet:GYOUR_STELLAR_PUBLIC_KEY"
  }
}
```

The approval message is base64 XDR — sign as described in §4.4.

---

## 5. The Bridge — Sodax Protocol

### 5.1 What Sodax does

Sodax is a **cross-chain intent bridge**. The on-chain flow is:

```text
Base (source)
  └─► ERC-20 approve(SodaxSpoke, amount)    [tx 1]
  └─► SodaxSpoke.createIntent(...)          [tx 2]
          │
          │  Hub chain (Sonic)
          │  └─► Solver picks up the intent
          │  └─► Solver executes the fill
          │
Stellar (destination)
  └─► Solver deposits USDC at the destination address
```

### 5.2 Intent Parameters

```typescript
const intentParams: CreateIntentParams = {
  inputToken:      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC Base
  outputToken:     "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", // USDC Stellar
  inputAmount:     amountIn,                      // BigInt, 6 decimals
  minOutputAmount: quote.amountOut * (10000n - slippageBps) / 10000n,
  deadline:        BigInt(now + 3600),            // 1 hour from now
  allowPartialFill: false,
  srcChain:        BASE_MAINNET_CHAIN_ID,
  dstChain:        STELLAR_MAINNET_CHAIN_ID,
  srcAddress:      "0x291d9...",                  // EVM smart wallet address
  dstAddress:      "G...",                        // Stellar recipient address
  solver:          "0x0000000000000000000000000000000000000000", // 0x0 = any solver
  data:            "0x",
};
```

### 5.3 Intent status codes (polling)

```typescript
-1  → NOT_FOUND           (API still indexing the tx)
 1  → NOT_STARTED_YET     (Pending on the relayer)
 2  → STARTED_NOT_FINISHED (Processing on Hub/Sonic)
 3  → SOLVED              (Funds delivered on Stellar) ✅
 4  → FAILED              (Solver or hub error)
```

**To get the settled output amount and Stellar tx hash:**

```typescript
// Actual amount settled by solver (in Stellar stroops — 7 decimals)
const intentState = await sodax.swaps.getFilledIntent(fillTxHash);
const amountReceived = intentState.receivedOutput;   // bigint, stroops

// Stellar destination tx hash
const packetResult = await sodax.swaps.getSolvedIntentPacket({
  chainId: SONIC_MAINNET_CHAIN_ID,
  fillTxHash,
});
const destTxHash = packetResult.value.dst_tx_hash;
```

### 5.4 Allowance handling

Sodax requires the smart wallet to approve the SodaxSpoke contract before the intent.
`handleAllowance()` in `sodax.ts` checks if the current allowance is sufficient; if not,
it calls `sodax.swaps.approve()` and waits for the on-chain confirmation via
`waitForTransactionReceipt()` on the Base RPC (not via Crossmint) before proceeding.

---

## 6. Required Environment Variables

```env
# Crossmint
CROSSMINT_SERVER_API_KEY=sk_...     # Server API key (must start with sk_)
CROSSMINT_WALLET_EMAIL=user@...     # Wallet identity (used in locator)
CROSSMINT_ENV=production            # "staging" or "production"

# EVM Private Key — controls the adminSigner of the EVM smart wallet
EVM_PRIVATE_KEY=0x...               # Without this, transactions cannot be signed

# Stellar Server Key — controls the adminSigner of the Stellar smart wallet
STELLAR_SERVER_KEY=S...             # Stellar ed25519 secret key

# RPC
BASE_RPC_URL=https://mainnet.base.org

# Bridge amount
BRIDGE_AMOUNT=0.1                   # In USDC (6 decimals internally)

# DeFindex (optional — omit to skip vault deposit)
DEFINDEX_VAULT_ADDRESS=CA2FIP...    # Soroban vault contract address
DEFINDEX_API_URL=https://api.defindex.io
DEFINDEX_API_KEY=...
```

**Important:** `CROSSMINT_SERVER_API_KEY` must start with `sk_` to be recognized as a
server key by Crossmint. Keys starting with `ck_` are client keys and lack wallet signing
permissions.

---

## 7. Wallet Locator — Full Format Reference

```text
email:<email>:<chainType>[:<walletType>][:alias:<alias>]

Examples:
  email:user@example.com:evm                        ← main EVM wallet (server-controlled)
  email:user@example.com:stellar                    ← Stellar wallet (server-controlled)
  0x291d9Cd5150888eC475EF9A362A40B580Dc4a953        ← by address (always valid, used for txs)
  G...                                              ← Stellar address (used for Stellar txs)
```

---

## 8. Full Sequence Diagram

```text
Script                  Crossmint API          Base RPC         Sodax SDK        Stellar/DeFindex
  │                          │                    │                 │                    │
  │── GET EVM wallet ──────►│                    │                 │                    │
  │◄─ 404 ─────────────────│                    │                 │                    │
  │── POST create EVM w. ──►│                    │                 │                    │
  │   (adminSigner=ext-w)   │                    │                 │                    │
  │◄─ { address: 0x291d } ─│                    │                 │                    │
  │                          │                    │                 │                    │
  │── GET stellar wallet ──►│                    │                 │                    │
  │◄─ 404 ─────────────────│                    │                 │                    │
  │── POST create stellar w.►│                   │                 │                    │
  │   (adminSigner=GKEY)    │                    │                 │                    │
  │◄─ { address: G... } ───│                    │                 │                    │
  │                          │                    │                 │                    │
  │── balanceOf(0x291d) ────────────────────────►│                 │                    │
  │◄─ USDC balance ─────────────────────────────│                 │                    │
  │                          │                    │                 │                    │
  │── getQuote() ────────────────────────────────────────────────►│                    │
  │◄─ { amountOut } ────────────────────────────────────────────│                    │
  │                          │                    │                 │                    │
  │── isAllowanceValid() ────────────────────────────────────────►│                    │
  │◄─ false ────────────────────────────────────────────────────│                    │
  │                          │                    │                 │                    │
  │── POST /transactions ──►│                    │                 │                    │
  │   (ERC-20 approve)       │                    │                 │                    │
  │◄─ { id, awaiting } ────│                    │                 │                    │
  │── signMessage(hex bytes)  │                    │                 │                    │
  │── POST /approvals ─────►│                    │                 │                    │
  │                          │── broadcast tx ───►│                 │                    │
  │── GET /transactions ───►│                    │                 │                    │
  │◄─ { onChain.txId } ────│                    │                 │                    │
  │── waitForReceipt ────────────────────────────►│                 │                    │
  │                          │                    │                 │                    │
  │── POST /transactions ──►│                    │                 │                    │
  │   (createIntent)         │                    │                 │                    │
  │◄─ { id, awaiting } ────│                    │                 │                    │
  │── signMessage(hex bytes)  │                    │                 │                    │
  │── POST /approvals ─────►│                    │                 │                    │
  │◄─ confirmed ───────────│                    │                 │                    │
  │                          │                    │                 │                    │
  │── getStatus(intentHash) ─────────────────────────────────────►│                    │
  │   (polling every 10s)    │                    │   Sonic hub     │                    │
  │◄─ SOLVED ───────────────────────────────────────────────────│                    │
  │── getFilledIntent(fillTxHash) ───────────────────────────────►│                    │
  │◄─ { receivedOutput } ───────────────────────────────────────│                    │
  │── getSolvedIntentPacket() ───────────────────────────────────►│                    │
  │◄─ { dst_tx_hash } ──────────────────────────────────────────│                    │
  │                          │                    │                 │                    │
  │── POST /transactions ──►│                    │                 │                    │
  │   (contract-call deposit)│                    │                 │                    │
  │◄─ { id, awaiting } ────│                    │                 │                    │
  │── sign(base64 XDR)        │                    │                 │                    │
  │── POST /approvals ─────►│                    │                 │                    │
  │                          │─── submit to ──────────────────────────────────────────►│
  │                          │    Soroban         │                 │                    │
  │◄─ { onChain.txId } ────────────────────────────────────────────────────────────────│
```

---

## 9. Known Issues and Fixes

| Error | Root cause | Fix applied |
| --- | --- | --- |
| `Invalid address: api-key` | `api-key` signer deprecated in API 2025-06-09 | Use `external-wallet` + manual signing |
| `evm-keypair:0x... awaiting approval` | Email wallet requires OTP to approve operational signers | Create new wallet with `adminSigner: external-wallet` from the start |
| `Locator prefix 'external-wallet' is not valid` | `external-wallet` is not a valid wallet owner prefix | Owner is always email/userId — `external-wallet` only goes in `adminSigner` |
| `Wallet not found` | Mismatch between short and canonical locator forms | Use on-chain address (`0x...` or `G...`) as the locator for all transaction calls |
| Stellar approval fails silently | EVM hex-bytes signing used for Stellar | Stellar messages are base64 XDR — use `Buffer.from(msg, "base64")` + `keypair.sign()` |
| `amountReceived` is 0 | `getSolvedIntentPacket` does not return amount | Fetch from `getFilledIntent(fillTxHash).receivedOutput` instead |

---

## 10. Staging vs Production Differences

| | Staging | Production |
| --- | --- | --- |
| Base URL | `https://staging.crossmint.com` | `https://www.crossmint.com` |
| Chain | `base-sepolia` | `base` |
| Token | USDXM `0x14196F08...` | USDC `0x833589fC...` |
| API Key prefix | `sk_staging_...` | `sk_production_...` |
| Sodax chain IDs | `BASE_MAINNET_CHAIN_ID` (SDK always mainnet) | same |

**Important note:** The Sodax SDK always targets mainnet chain IDs, regardless of the
`CROSSMINT_ENV` value. Full testnet support would require using staging Sodax endpoints,
which is not yet implemented in this POC.

---

## 11. Documentation References

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

- SDK types: `SolverIntentQuoteRequest`, `CreateIntentParams`, `SolverIntentStatusCode`
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

---

## 12. Integration Checklist for New Crossmint Accounts

To connect this script to a different Crossmint account, update the following:

- `CROSSMINT_SERVER_API_KEY` — server key from the target Crossmint project
- `CROSSMINT_WALLET_EMAIL` — email identity used as the wallet locator
- `EVM_PRIVATE_KEY` — key that acts as `adminSigner` for the EVM smart wallet
- `STELLAR_SERVER_KEY` — Stellar ed25519 secret key that acts as `adminSigner` for the
  Stellar smart wallet (and signs DeFindex vault deposits)
- `DEFINDEX_VAULT_ADDRESS` — optional; omit to skip the vault deposit step

**Wallets that will be created (or reused if they exist):**

- EVM — Locator: `email:<CROSSMINT_WALLET_EMAIL>:evm`
  - Admin signer: `external-wallet:<EVM_PRIVATE_KEY address>`
  - Required balance: ETH for gas + USDC >= `BRIDGE_AMOUNT`
- Stellar — Locator: `email:<CROSSMINT_WALLET_EMAIL>:stellar`
  - Admin signer: `external-wallet:<STELLAR_SERVER_KEY public key>`
  - Required balance: XLM for fees (funded automatically by Crossmint on creation)
