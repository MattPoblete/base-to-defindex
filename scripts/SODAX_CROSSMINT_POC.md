# POC: Sodax + Crossmint Bridge — Base → Stellar

> Knowledge dump: design decisions, lessons learned, and documentation references
> for developing the `sodax-crossmint.ts` server-side bridge script.
>
> **Last updated**: 2026-03-09
> **Status**: Bridge functional on mainnet — ERC-20 approve + intent creation working.

---

## 1. Objective

Execute a **USDC on Base → USDC on Stellar** bridge entirely server-side, using:

- **Crossmint** as the EVM smart wallet custodian (key infrastructure, gas sponsorship)
- **Sodax SDK** as the bridge protocol (intent-based, hub on Sonic)

The script must run without human interaction: no OTP, no browser, no Fireblocks.

---

## 2. Module Architecture

```text
sodax-crossmint.ts           ← Entry point. Orchestrates the full flow.
│
├── CrossmintRestClient       crossmint-rest.ts
│   ├── getOrCreateEvmScriptsWallet()   → create/get EVM smart wallet
│   ├── getStellarWalletAddress()       → read user's Stellar address
│   └── sendTransactionAndGetHash()     → create tx + sign + poll
│
├── CrossmintEvmSodaxAdapter  crossmint-adapters.ts
│   └── implements IEvmWalletProvider   → bridges Sodax ↔ Crossmint REST
│
├── SodaxBridgeService        sodax-service.ts
│   ├── getQuote()            → swap quote
│   ├── executeSwap()         → ERC-20 approve + create intent
│   └── pollStatus()          → poll until SOLVED on Stellar
│
└── initializeSodax()         sodax.ts
    └── Sodax SDK init + handleAllowance helper
```

---

## 3. Stack and Relevant Versions

| Component | Version / Detail |
| --- | --- |
| Crossmint API | `2025-06-09` (current supported version) |
| Crossmint wallet type | `evm-smart-wallet` (ERC-4337 + ERC-7579) |
| Sodax SDK | `@sodax/sdk` (mainnet, hub on Sonic) |
| Ethers.js | v6 (approval message signing) |
| Runtime | `tsx` for direct TypeScript execution |
| Source chain | Base Mainnet (`BASE_MAINNET_CHAIN_ID`) |
| Destination chain | Stellar Mainnet |
| Token | USDC on Base → USDC on Stellar |

---

## 4. The Crossmint Wallet — Design Decisions

### 4.1 Why REST API instead of the Crossmint SDK

The `@crossmint/wallets-sdk` requires **Fireblocks** for server-side custodial wallets.
Crossmint offers `evm-fireblocks-custodial` as a premium feature that is not available on
standard accounts.

**Decision:** Use the REST API directly with `fetch` + `X-API-KEY` header.

**Reference:** <https://docs.crossmint.com/wallets/quickstarts/restapi>

---

### 4.2 Why `external-wallet` as adminSigner

**History of errors that led to this solution:**

| Attempt | Result | Root cause |
| --- | --- | --- |
| `signer: "api-key"` in tx creation | ❌ `Invalid address: api-key` | `api-key` signer deprecated in API 2025-06-09 |
| `external-wallet` as operational signer | ❌ `evm-keypair:0x... awaiting approval` | Email wallet requires OTP to approve new operational signers |
| `owner: "external-wallet:0x..."` | ❌ `Locator prefix 'external-wallet' is not valid` | Wallet locator MUST be email/userId/etc. |
| **`adminSigner: { type: "external-wallet" }` at creation** | ✅ Works | Separates identity (email) from control (private key) |

**The correct solution:**

```json
POST /api/2025-06-09/wallets
{
  "chainType": "evm",
  "type": "smart",
  "owner": "email:user@example.com",
  "alias": "scripts",
  "config": {
    "adminSigner": {
      "type": "external-wallet",
      "address": "0xYOUR_PRIVATE_KEY_ADDRESS"
    }
  }
}
```

**Result:**

- Wallet locator: `email:user@example.com:evm:alias:scripts`
- Admin signer (recovery signer): `external-wallet:0x...` = our private key
- **No email OTP required at any point**

**References:**

- <https://docs.crossmint.com/wallets/quickstarts/restapi>
- <https://docs.crossmint.com/wallets/concepts/wallet-signers>

---

### 4.3 Why `alias: "scripts"`

The dapp wallet uses `email:user@example.com:evm` (no alias).
Without an alias, the API would return the existing dapp wallet (which has `email` as admin
signer and cannot be controlled server-side).

The alias creates a **completely separate wallet** under the same email identity.

**Reference:** <https://docs.crossmint.com/api-reference/wallets/create-wallet>

---

### 4.4 Why use the on-chain address as the transaction locator

The API 2025-06-09 accepts the full canonical locator:
`email:user@example.com:evm:smart:alias:scripts`

However, the wallet may have been created with the short form:
`email:user@example.com:evm:alias:scripts`

Rather than guessing which form Crossmint stores internally, we use the **on-chain address**
(`0x291d9...`) directly as the locator for all transaction calls.
The API always accepts `<walletAddress>` as a valid locator.

**Reference:** <https://docs.crossmint.com/api-reference/wallets/create-transaction>

```text
walletLocator accepted formats:
- <walletAddress>
- email:<email>:<chainType>[:<walletType>][:alias:<alias>]
- userId:<userId>:<chainType>...
```

---

### 4.5 Transaction flow with external-wallet signer

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

**Critical note:** The approval message must be signed as **raw hex bytes**, not as a string.
Use `ethers.getBytes(message)` before calling `signMessage()`.

**Reference:** <https://docs.crossmint.com/wallets/guides/send-transaction-evm>

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
  minOutputAmount: quote * (1 - slippage),        // 1% slippage default
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

**To get the final Stellar tx hash:**

```typescript
sodax.swaps.getSolvedIntentPacket({
  chainId: SONIC_MAINNET_CHAIN_ID,
  fillTxHash: statusResult.value.fill_tx_hash,
})
→ deliveryPacketResult.value.dst_tx_hash  // Stellar transaction hash
```

### 5.4 Allowance handling

Sodax requires the smart wallet to approve the SodaxSpoke contract before the intent.
`sodax.swaps.approve()` returns a tx hash that must be mined before the swap can proceed.
`CrossmintEvmSodaxAdapter` calls `waitForTransactionReceipt()` via direct RPC (not via
Crossmint) to confirm the approval.

---

## 6. Required Environment Variables

```env
# Crossmint
CROSSMINT_SERVER_API_KEY=sk_...     # Server API key (must start with sk_)
CROSSMINT_WALLET_EMAIL=user@...     # Wallet identity (used in locator)
CROSSMINT_ENV=production            # "staging" or "production"

# EVM Private Key — controls the adminSigner of the smart wallet
EVM_PRIVATE_KEY=0x...               # Without this, transactions cannot be signed

# RPC
BASE_RPC_URL=https://mainnet.base.org

# Bridge amount
BRIDGE_AMOUNT=0.1                   # In USDC (6 decimals internally)
```

**Important:** `CROSSMINT_SERVER_API_KEY` must start with `sk_` to be recognized as a server
key by Crossmint. Keys starting with `ck_` are client keys and lack wallet signing permissions.

---

## 7. Wallet Locator — Full Format Reference

```text
email:<email>:<chainType>[:<walletType>][:alias:<alias>]

Examples:
  email:user@example.com:evm                        ← dapp main wallet
  email:user@example.com:evm:smart:alias:scripts    ← scripts wallet (server-side)
  email:user@example.com:stellar                    ← Stellar wallet (recipient)
  0x291d9Cd5150888eC475EF9A362A40B580Dc4a953        ← by address (always valid)
```

**Note on `chainType` in wallet creation (API 2025-06-09):**

- `"evm"` — Supported with `type: "smart"`
- `"stellar"` — Only with `type: "mpc"` (requires Crossmint MPC access — "Contact us")
- `"solana"` — Supported with `type: "mpc"`

---

## 8. Full Sequence Diagram

```text
Script                  Crossmint API          Base RPC         Sodax SDK
  │                          │                    │                 │
  │── GET wallet (alias) ──►│                    │                 │
  │◄─ 404 ─────────────────│                    │                 │
  │── POST create wallet ──►│                    │                 │
  │   (adminSigner=ext-w)   │                    │                 │
  │◄─ { address: 0x291d } ─│                    │                 │
  │                          │                    │                 │
  │── GET stellar wallet ──►│                    │                 │
  │◄─ { address: G... } ───│                    │                 │
  │                          │                    │                 │
  │── balanceOf(0x291d) ────────────────────────►│                 │
  │◄─ USDC balance ─────────────────────────────│                 │
  │                          │                    │                 │
  │── getQuote() ────────────────────────────────────────────────►│
  │◄─ { amountOut } ────────────────────────────────────────────│
  │                          │                    │                 │
  │── isAllowanceValid() ────────────────────────────────────────►│
  │◄─ false ────────────────────────────────────────────────────│
  │                          │                    │                 │
  │── POST /transactions ──►│                    │                 │
  │   (ERC-20 approve)       │                    │                 │
  │◄─ { id, awaiting } ────│                    │                 │
  │── signMessage(msg)  [local, ethers.getBytes]  │                 │
  │── POST /approvals ─────►│                    │                 │
  │                          │── broadcast tx ───►│                 │
  │── GET /transactions ───►│                    │                 │
  │◄─ { onChain.txId } ────│                    │                 │
  │── waitForReceipt ────────────────────────────►│                 │
  │                          │                    │                 │
  │── POST /transactions ──►│                    │                 │
  │   (createIntent)         │                    │                 │
  │◄─ { id, awaiting } ────│                    │                 │
  │── signMessage(msg)        │                    │                 │
  │── POST /approvals ─────►│                    │                 │
  │◄─ confirmed ───────────│                    │                 │
  │                          │                    │                 │
  │── getStatus(intentHash) ─────────────────────────────────────►│
  │   (polling every 10s)    │                    │   Sonic hub     │
  │◄─ SOLVED ───────────────────────────────────────────────────│
  │── getSolvedIntentPacket() ───────────────────────────────────►│
  │◄─ { dst_tx_hash } ──────────────────────────────────────────│
```

---

## 9. Known Issues and Fixes

| Error | Root cause | Fix applied |
| --- | --- | --- |
| `Invalid address: api-key` | `api-key` signer deprecated in API 2025-06-09 | Use `external-wallet` + manual signing |
| `evm-keypair:0x... awaiting approval` | Email wallet requires OTP to approve operational signers | Create new wallet with `adminSigner: external-wallet` from the start |
| `Locator prefix 'external-wallet' is not valid` | `external-wallet` is not a valid wallet owner prefix | Owner is always email/userId — `external-wallet` only goes in `adminSigner` |
| `Wallet not found: 'evm:smart:alias:scripts'` | Mismatch between short and canonical locator forms | Use on-chain address (`0x...`) as the locator for all transaction calls |
| `chainType: Invalid literal value, expected 'evm'` | API 2025-06-09 only accepts `evm` without explicit `type` | For Stellar: `{ chainType: "stellar", type: "mpc" }` (requires MPC access) |
| `Approval failed: tx 404` | Inconsistent wallet locator format | Always use the `0x...` address after wallet creation |

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
- `Sodax.swaps.getSolvedIntentPacket()` — retrieves Stellar destination tx hash

### Ethers.js v6

- Sign raw hex message: `signer.signMessage(ethers.getBytes(hexMessage))`
- Derive wallet from key: `new ethers.Wallet(privateKey)`

---

## 12. Integration Checklist for New Crossmint Accounts

To connect this script to a different Crossmint account, update the following:

- `CROSSMINT_SERVER_API_KEY` — server key from the target Crossmint project
- `CROSSMINT_WALLET_EMAIL` — email identity used as the wallet locator
- `EVM_PRIVATE_KEY` — key that acts as `adminSigner` for the scripts wallet
- `alias: "scripts"` in `getOrCreateEvmScriptsWallet()` — change if a different alias convention is needed
- `getStellarWalletAddress()` — resolves the Stellar recipient from the same email; override by passing a Stellar address as a CLI argument: `npm run sodax-crossmint -- G...`

**Wallet that will be created (or reused if it exists):**

- On-chain address: determined at first run
- Locator: `email:<CROSSMINT_WALLET_EMAIL>:evm:alias:scripts`
- Admin signer: `external-wallet:<EVM_PRIVATE_KEY address>`
- Required balance: ETH for gas + USDC >= `BRIDGE_AMOUNT`
