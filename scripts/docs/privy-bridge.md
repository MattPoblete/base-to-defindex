# Base → Stellar → Defindex: Privy Bridge Guide

Complete technical reference for bridging USDC from Base (EVM) to a Defindex vault on
Stellar using the Sodax SDK and Privy server wallets.

For the Crossmint-based equivalent see [crossmint-bridge.md](./crossmint-bridge.md).

---

## Architecture Overview

```
[Base EVM Wallet — Privy TEE]
      │
      │  1. Approve USDC allowance
      │  2. Create swap intent
      ▼
[Sodax Spoke Contract — Base]
      │
      │  Relayer picks up intent
      ▼
[Sodax Hub — Sonic Chain]
      │
      │  Solver fills intent, marks SOLVED
      │  (⚠️ SOLVED fires BEFORE Stellar tx confirms)
      ▼
[Stellar Network — USDC SAC]
      │
      │  Wait for Horizon to confirm balance
      ▼
[Defindex Vault — Soroban]
      │
      │  API builds unsigned XDR
      │  Privy raw-signs hash
      │  Submit to Defindex /send
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

## Prerequisites

### Environment Variables

```bash
# Privy (server wallets)
PRIVY_APP_ID=
PRIVY_APP_SECRET=
PRIVY_AUTHORIZATION_PRIVATE_KEY=   # "wallet-auth:<base64-PKCS8-DER>" format
PRIVY_AUTHORIZATION_PUBLIC_KEY=    # Matching public key (also register in Privy Dashboard)

# Stellar (XLM sponsor for new wallets)
STELLAR_SERVER_KEY=                # Stellar secret key with XLM to fund wallets

# RPC
BASE_RPC_URL=https://mainnet.base.org

# Defindex
DEFINDEX_API_KEY=
```

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

| Asset | Minimum     | Purpose                         |
|-------|-------------|---------------------------------|
| ETH   | 0.0005 ETH  | Gas for allowance + swap tx     |
| USDC  | ≥ amount    | Bridge amount                   |
| XLM   | 3 XLM       | Stellar account reserve + fees  |

---

## Step 1 — Sodax SDK Initialization

```ts
import { Sodax } from "@sodax/sdk";

const sodax = new Sodax();
const result = await sodax.initialize();
if (!result.ok) throw new Error(`Init failed: ${result.error}`);
```

`Sodax` reads chain configs automatically on `initialize()`. No manual chain config needed.

---

## Step 2 — Get a Quote

```ts
import { SolverIntentQuoteRequest } from "@sodax/sdk";
import { SpokeChainId } from "@sodax/types";

const request: SolverIntentQuoteRequest = {
  token_src: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  token_src_blockchain_id: BASE_MAINNET_CHAIN_ID as SpokeChainId,
  token_dst: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  token_dst_blockchain_id: STELLAR_MAINNET_CHAIN_ID as SpokeChainId,
  amount: amountIn,          // bigint, in USDC base units (6 decimals)
  quote_type: "exact_input",
};

const result = await sodax.swaps.getQuote(request);
// result.value.quoted_amount → bigint output in Stellar stroops (7 decimals)
```

**Gotcha — transient -999 errors:** The Sodax quote endpoint occasionally returns error
code `-999`. Retry up to 5 times with a 5-second delay before giving up.

---

## Step 3 — EVM Wallet Adapter (Privy)

Sodax requires an `IEvmWalletProvider` to sign and send EVM transactions. For Privy
server wallets, implement the adapter using Privy's `sendTransaction` (Tier 3):

```ts
// Key fields from IEvmWalletProvider
getWalletAddress(): Promise<Address>
sendTransaction(tx: EvmRawTransaction): Promise<Hash>
waitForTransactionReceipt(hash: Hash): Promise<EvmRawTransactionReceipt>
```

**Gotcha — BigInt serialization:** Privy cannot serialize `BigInt` in JSON. Convert
`tx.value` to a `0x`-prefixed hex string before passing to Privy:

```ts
const valueHex = evmRawTx.value != null
  ? "0x" + BigInt(evmRawTx.value as any).toString(16)
  : undefined;
```

**Privy Authorization Key pattern:** Register a P-256 keypair in the Privy dashboard as
the wallet owner. This enables zero-OTP server automation — no email confirmation required.

---

## Step 4 — Check & Approve Allowance

Before creating an intent, the USDC allowance for the Sodax spoke contract must be sufficient:

```ts
const allowanceResult = await sodax.swaps.isAllowanceValid({
  intentParams,
  spokeProvider,
});

if (!allowanceResult.value) {
  const approveResult = await sodax.swaps.approve({
    intentParams,
    spokeProvider,
  });
  // Wait for approval tx to be mined before proceeding
  await wallet.waitForTransactionReceipt(approveResult.value);
}
```

---

## Step 5 — Execute the Swap

```ts
import { CreateIntentParams } from "@sodax/sdk";

const slippageBps = 100; // 1%
const minOutputAmount = (quote.amountOut * BigInt(10000 - slippageBps)) / 10000n;

const intentParams: CreateIntentParams = {
  inputToken:       srcToken.address,
  outputToken:      dstToken.address,
  inputAmount:      amountIn,
  minOutputAmount,
  deadline:         BigInt(Math.floor(Date.now() / 1000) + 3600),
  allowPartialFill: false,
  srcChain:         BASE_MAINNET_CHAIN_ID as SpokeChainId,
  dstChain:         STELLAR_MAINNET_CHAIN_ID as SpokeChainId,
  srcAddress:       evmAddress,
  dstAddress:       stellarAddress,   // Stellar G-address as destination
  solver:           "0x0000000000000000000000000000000000000000",
  data:             "0x",
};

const swapResult = await sodax.swaps.swap({ intentParams, spokeProvider });
// swapResult.value = [solverResponse, intent, deliveryInfo]
const srcTxHash   = deliveryInfo.srcTxHash;
const statusHash  = solverResponse.intent_hash || deliveryInfo.srcTxHash;
```

---

## Step 6 — Poll Bridge Status

```ts
// Status codes
// -1 = NOT_FOUND (API still indexing)
//  1 = NOT_STARTED_YET
//  2 = STARTED_NOT_FINISHED (processing on Hub/Sonic)
//  3 = SOLVED ✅
//  4 = FAILED ❌

const statusResult = await sodax.swaps.getStatus({
  intent_tx_hash: statusHash as `0x${string}`,
});

if (statusResult.value.status === SolverIntentStatusCode.SOLVED) {
  const fillTxHash = statusResult.value.fill_tx_hash;

  // Get actual settled amount from Hub chain
  const intentState = await sodax.swaps.getFilledIntent(fillTxHash);
  const amountReceived = intentState.receivedOutput; // bigint, Stellar stroops

  // Resolve Stellar destination tx hash via packet relay
  const packetResult = await sodax.swaps.getSolvedIntentPacket({
    chainId: SONIC_MAINNET_CHAIN_ID,
    fillTxHash,
  });
  const destTxHash = packetResult.value.dst_tx_hash;
}
```

**Gotcha — SOLVED ≠ Stellar confirmed:** Sodax marks `SOLVED` on the Hub (Sonic)
**before** the Stellar transaction is included in a ledger. Do not proceed to Defindex
deposit until Horizon confirms the USDC balance (see Step 7).

---

## Step 7 — Wait for USDC on Stellar

**Use Horizon, not Soroban RPC.** The Soroban RPC `simulateTransaction` approach
requires constructing XDR manually and is unreliable. Horizon's account endpoint returns
USDC balance directly:

```ts
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

async function getHorizonUsdcBalance(address: string): Promise<bigint> {
  const res = await fetch(`https://horizon.stellar.org/accounts/${address}`);
  if (res.status === 404) return 0n;
  const data = await res.json();
  const entry = data.balances.find(
    (b: any) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
  );
  if (!entry) return 0n;
  return BigInt(Math.round(parseFloat(entry.balance) * 10_000_000));
}

// Poll every 10s, up to 36 attempts (6 minutes total)
for (let i = 1; i <= 36; i++) {
  const balance = await getHorizonUsdcBalance(stellarAddress);
  if (balance >= amountReceived) break;
  await new Promise(r => setTimeout(r, 10_000));
}
```

**Decimal conversion:**
- Horizon returns: `"0.0926719"` (7-decimal float string)
- Stroops formula: `Math.round(parseFloat(balance) * 10_000_000)`

---

## Step 8 — Stellar Wallet Setup

Privy Stellar wallets are Tier 2 — only `rawSign(walletId, { params: { hash } })` is
available, no contract call abstraction.

```ts
// Create wallet (idempotent via idempotency_key)
const wallet = await privy.wallets().create({
  chain_type: "stellar",
  owner: { public_key: authorizationPublicKey },
  idempotency_key: "my-app-stellar-wallet-v1",
});
```

**USDC Trustline:** The Stellar wallet must have a trustline for USDC before the bridge
can deliver funds. Build a `changeTrust` operation, hash the tx, raw-sign via Privy, and
submit to Horizon.

**XLM Funding:** New accounts need at least 1 XLM base reserve plus fees (~3 XLM safe
minimum). Fund from a server-controlled Stellar key using `createAccount` or `payment`.

---

## Step 9 — Defindex Deposit

The Defindex API handles XDR construction. The Privy wallet only needs to raw-sign
the transaction hash.

### 9a. Build unsigned XDR

```ts
const response = await fetch(
  `https://api.defindex.io/vault/${vaultAddress}/deposit?network=mainnet`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${defindexApiKey}`,
    },
    body: JSON.stringify({
      amounts: [Number(amountStroops)],  // ⚠️ Must be Number, NOT string
      caller: stellarAddress,
      invest: true,
      slippageBps: 50,
    }),
  }
);
const { xdr: unsignedXdr } = await response.json();
```

**Gotcha — `amounts` must be `Number`:** The Defindex API rejects string values in the
`amounts` array. Always pass `[Number(amountStroops)]`.

### 9b. Sign with Privy

```ts
import { TransactionBuilder, Networks } from "@stellar/stellar-base";

const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.PUBLIC);
const txHashHex = "0x" + Buffer.from((tx as any).hash()).toString("hex");

const signResult = await privy.wallets().rawSign(walletId, {
  params: { hash: txHashHex },
  authorization_context: buildAuthContext(),
});

// Handle all Privy response shapes
const signatureHex: string =
  signResult?.data?.signature ?? signResult?.signature ?? signResult;
```

### 9c. Attach signature and submit

```ts
import { Keypair, xdr } from "@stellar/stellar-base";

const keypair = Keypair.fromPublicKey(stellarAddress);
const signatureBytes = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");

(tx as any).signatures.push(
  new xdr.DecoratedSignature({
    hint: keypair.signatureHint(),
    signature: signatureBytes,
  })
);

const signedXdr = (tx as any).toEnvelope().toXDR("base64");

const submitRes = await fetch(`https://api.defindex.io/send?network=mainnet`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({ xdr: signedXdr }),
});
const { txHash } = await submitRes.json();
```

---

## Full Flow at a Glance

```ts
// 1. Init
const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
const sodax    = await initializeSodax();

// 2. Wallets
const evmWallet     = await getOrCreateEvmWallet();
const stellarWallet = await getOrCreateStellarWallet();
await ensureXlmFunding(stellarWallet.address, 3);
await ensureUsdcTrustline(stellarWallet.id, stellarWallet.address);

// 3. Bridge
const bridgeService = new SodaxBridgeService(sodax);
const privyAdapter  = new PrivyEvmSodaxAdapter(
  evmWallet.id, evmWallet.address, "eip155:8453", provider
);
const quote                      = await bridgeService.getQuote(swapParams);
const { srcTxHash, statusHash }  = await bridgeService.executeSwap(privyAdapter, swapParams, quote);
const { destTxHash, amountReceived } = await bridgeService.pollStatus(statusHash);

// 4. Wait for USDC on Stellar (Horizon)
await waitForUsdcBalance(stellarWallet.address, amountReceived);

// 5. Deposit into Defindex
const depositTxHash = await depositToDefindexVault(
  stellarWallet.id,
  stellarWallet.address,
  SOROSWAP_EARN_USDC_VAULT,
  amountReceived,
  DEFINDEX_API_KEY,
  "mainnet"
);
```

---

## Decimal Reference

| Token              | Decimals | 1 unit in base units |
|--------------------|----------|----------------------|
| USDC (Base)        | 6        | `1_000_000`          |
| USDC (Stellar SAC) | 7        | `10_000_000`         |
| XLM                | 7        | `10_000_000` (stroops) |

Bridge input uses 6-decimal USDC. Everything on Stellar uses 7-decimal stroops.

---

## Known Gotchas Summary

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| `fetch failed` on Soroban RPC | `xdr.AccountId` missing in SDK + RPC URL unreliable | Use Horizon API for balance polling |
| `SOLVED` but funds not arrived | Hub marks SOLVED before Stellar tx confirms | Poll Horizon USDC balance before Defindex deposit |
| Quote returns -999 error | Transient solver unavailability | Retry up to 5× with 5s backoff |
| Privy `sendTransaction` fails | `BigInt` not JSON-serializable | Convert `value` to `0x`-prefixed hex string |
| Defindex API rejects `amounts` | Expects `Number[]` not `string[]` | Pass `[Number(amountStroops)]` |
| `amountReceived` is 0 | `pollStatus` alone doesn't return settled amount | Fetch via `sodax.swaps.getFilledIntent(fillTxHash)` |
| No `fill_tx_hash` on status | Packet relay not yet indexed | Add polling tolerance; retry packet lookup |

---

## File Map

```
scripts/src/
├── privy/
│   └── privy-mainnet-poc.ts        ← Entry point (full flow)
├── shared/
│   ├── config.ts                   ← All env vars + token addresses
│   ├── sodax.ts                    ← Sodax init, allowance, status helpers
│   ├── sodax-service.ts            ← SodaxBridgeService (quote/swap/poll)
│   ├── bridge-types.ts             ← SwapParams, BridgeQuote, etc.
│   └── privy-evm-sodax-adapter.ts  ← IEvmWalletProvider impl for Privy
├── wallets/
│   ├── privy-base-wallet.ts        ← EVM wallet creation
│   ├── privy-stellar-wallet.ts     ← Stellar wallet, XLM funding, trustline
│   └── privy-defindex-wallet.ts    ← Defindex deposit (build XDR, sign, submit)
```

---

## Error Log

Chronological record of bugs encountered during development and their solutions.

---

### E1 — Script exits as "insufficiently funded" with 0.0006 ETH

**Symptom:** Script prints "ETH: need ≥ 0.001 (have 0.0006)" and exits at step 1,
even though 0.0006 ETH is enough to cover Base gas for the allowance + intent transactions.

**Root cause:** The initial ETH minimum was set to 0.001 ETH following the Crossmint
guide, but actual gas consumption for two Base transactions (ERC-20 approve +
createIntent) is well under 0.0005 ETH on mainnet.

**Fix:** Lowered `MIN_ETH` constant from `0.001` to `0.0005` ETH.

```ts
const MIN_ETH = ethers.parseEther("0.0005");
```

---

### E2 — Sodax quote fails intermittently with error code -999

**Symptom:** `bridgeService.getQuote()` throws `"Quote failed: -999"` on the first
attempt, causing the script to abort even though the bridge infrastructure is healthy.

**Root cause:** Transient unavailability in the Sodax solver network.

**Fix:** Added retry logic with 5-second backoff (up to 5 attempts) inside
`SodaxBridgeService.getQuote()`:

```ts
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const result = await this.sodax.swaps.getQuote(request);
  if (result.ok) return { ... };
  if (attempt < maxAttempts) await sleep(5000);
}
```

**Commit:** `f4da6c6`

---

### E3 — Privy `sendTransaction` throws JSON serialization error

**Symptom:** Privy rejects the `sendTransaction` call with a JSON serialization error.
The `value` field from `EvmRawTransaction` is a `bigint`.

**Root cause:** `JSON.stringify` cannot serialize `BigInt`.

**Fix:** Convert `value` to a `0x`-prefixed hex string before passing to Privy:

```ts
const valueHex = evmRawTx.value != null
  ? "0x" + BigInt(evmRawTx.value as any).toString(16)
  : undefined;
```

**File:** `scripts/src/shared/privy-evm-sodax-adapter.ts`

---

### E4 — `amountReceived` is `0n` after bridge completes

**Symptom:** `bridgeService.pollStatus()` returns `{ destTxHash, amountReceived: 0n }`,
causing the Defindex deposit to be called with 0 USDC.

**Root cause:** `getSolvedIntentPacket()` returns the Stellar tx hash but does **not**
include the settled output amount.

**Fix:** Fetch the actual settled amount separately from the Hub chain:

```ts
const intentState = await sodax.swaps.getFilledIntent(fillTxHash);
const amountReceived = intentState.receivedOutput; // bigint, stroops
```

**File:** `scripts/src/shared/sodax-service.ts`

---

### E5 — Defindex deposit fails with HTTP 400 ("invalid amounts")

**Symptom:** `POST /vault/{addr}/deposit` returns HTTP 400. Error body indicates the
`amounts` field is malformed.

**Root cause:** The Defindex API expects `amounts` as a `Number[]`. The initial
implementation passed `[amountStroops.toString()]` (string array).

**Fix:**

```ts
body: JSON.stringify({
  amounts: [Number(amountStroops)],  // NOT amountStroops.toString()
  ...
})
```

**File:** `scripts/src/wallets/privy-defindex-wallet.ts`

---

### E6 — Defindex deposit runs before USDC arrives on Stellar

**Symptom:** The deposit transaction fails on Stellar with an insufficient balance error.
The bridge is marked SOLVED but the USDC hasn't actually landed yet.

**Root cause:** Sodax marks the intent as `SOLVED` on the Hub chain (Sonic) **before**
the corresponding Stellar transaction is included in a ledger. There is a multi-second
(sometimes 10–30s) gap between SOLVED and actual Stellar confirmation.

**Fix:** Added a `waitForUsdcBalance()` polling step between `pollStatus()` and
`depositToDefindexVault()`. Polls Horizon every 10 seconds for up to 6 minutes.

**Commit:** `cf44c7f`

---

### E7 — `waitForUsdcBalance` fails with `fetch failed / ELIFECYCLE`

**Symptom:** After the bridge completes successfully, the script crashes at
`waitForUsdcBalance` with `Error: fetch failed`.

**Root cause (two issues combined):**

1. `getSorobanUsdcBalance()` used `xdr.AccountId` which does not exist in the current
   version of `@stellar/stellar-base`.
2. The fallback RPC URL `https://rpc.stellar.org:443` was unreliable under load.

**Fix:** Replaced the entire Soroban RPC approach with a simple Horizon API call:

```ts
// Before (broken): Soroban RPC simulateTransaction + XDR construction
// After (working): Horizon account balances endpoint
const res = await fetch(`https://horizon.stellar.org/accounts/${address}`);
const entry = data.balances.find(
  b => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
);
return BigInt(Math.round(parseFloat(entry.balance) * 10_000_000));
```

---

### E8 — `rawSign` response shape varies across SDK versions

**Symptom:** Signature extraction fails (`signatureHex` is `undefined`) depending on
the version of `@privy-io/node` used or the wallet type.

**Root cause:** The `rawSign` return type is undocumented. Different SDK versions return:
- `{ data: { signature: "0x..." } }` (REST API doc shape)
- `{ signature: "0x..." }` (some SDK versions)
- bare string `"0x..."` (Tier-2 recipe example)

**Fix:** Triple fallback chain:

```ts
const signatureHex: string =
  signResult?.data?.signature ??
  signResult?.signature ??
  (signResult as unknown as string);
```

**File:** `scripts/src/wallets/privy-defindex-wallet.ts`, `privy-stellar-wallet.ts`

---

### E9 — `rawSign` on Stellar wallet returns error (TEE not enabled)

**Symptom:** `privy.wallets().rawSign()` throws for the Stellar wallet. Error message
references TEE or unauthorized execution.

**Root cause:** Privy requires **TEE execution** to be enabled in the app dashboard
before Tier 2 chains (Stellar) can be used server-side.

**Fix:** Enable TEE execution in the Privy Dashboard:
> Dashboard → Your App → Wallets → Execution environments → Enable TEE

This is a one-time manual step — no code change required.

---

## Design Decisions

---

### D1 — Use `@privy-io/node` (not `@privy-io/server-auth`)

**Decision:** Use `@privy-io/node` v0.11.0.

**Why:** `@privy-io/server-auth` is officially deprecated. `@privy-io/node` is the
current SDK with the latest API (including the new `wallets()` interface, key quorums,
and improved TypeScript types).

**Ref:** <https://docs.privy.io/wallets/using-wallets/signers/quickstart>

---

### D2 — Authorization Key as sole wallet owner (1-of-1 quorum)

**Decision:** Wallet owner is set to `{ public_key: PRIVY_AUTHORIZATION_PUBLIC_KEY }` —
a single P-256 key controlled by this server.

**Why:** This is the simplest fully-automated pattern — equivalent to Crossmint's
`external-wallet` adminSigner. The key never requires OTP because there is no user in
the loop. For production, consider a 2-of-2 quorum (user + server key) to enforce user
consent.

**Ref:** <https://docs.privy.io/controls/authorization-keys/keys/create/key>

---

### D3 — Idempotency key for wallet creation

**Decision:** Pass a fixed `idempotency_key` string when calling `privy.wallets().create()`.

**Why:** This makes the create call idempotent — repeated runs return the same wallet
instead of creating duplicates. The idempotency_key is scoped to the Privy app.

**Ref:** <https://docs.privy.io/wallets/wallets/create/create-a-wallet>

---

### D4 — Stellar as Tier 2 (raw sign, manual broadcast)

**Decision:** Build Stellar transactions manually with `@stellar/stellar-base`, get the
tx hash, raw-sign it via `privy.wallets().rawSign()`, attach the signature as a
`DecoratedSignature`, and broadcast the XDR envelope to Horizon via `fetch`.

**Why:** Stellar has Tier 2 support in Privy — the TEE only provides cryptographic
signing (Ed25519). All transaction construction, serialization, and broadcast are the
caller's responsibility.

**Ref:**
- <https://docs.privy.io/wallets/overview/chains>
- <https://docs.privy.io/wallets/using-wallets/other-chains/index>
- <https://docs.privy.io/recipes/use-tier-2>

---

### D5 — `@stellar/stellar-base` (not `@stellar/stellar-sdk`)

**Decision:** Use `@stellar/stellar-base` for transaction building.

**Why:** `stellar-base` includes all primitives needed: `TransactionBuilder`,
`Operation`, `Asset`, `Keypair`, `Account`, `Networks`, and `xdr`. The only thing
missing vs `stellar-sdk` is the built-in Horizon client, which we replace with `fetch`.

---

### D6 — rawSign response normalization

**Decision:** Access the signature via multiple fallback paths:

```typescript
const sig = result?.data?.signature ?? result?.signature ?? (result as unknown as string);
```

**Why:** The `@privy-io/node` SDK v0.11.0 `rawSign` return type is not fully documented
and varies across versions. The fallback chain handles all known shapes defensively.

**Ref:** <https://docs.privy.io/recipes/use-tier-2>

---

### D7 — Both private and public authorization keys stored in `.env`

**Decision:** Store both `PRIVY_AUTHORIZATION_PRIVATE_KEY` and
`PRIVY_AUTHORIZATION_PUBLIC_KEY` as env vars.

**Why:** The private key signs Privy API requests. The public key is needed to set the
wallet owner (`owner: { public_key }`) and must also be registered in the Privy
Dashboard. Deriving the public key from the DER private key at runtime is possible but
adds crypto complexity.

---

### D8 — TEE requirement for Stellar

**Decision:** Documented as a prerequisite but not enforced in code.

**Why:** Privy requires **TEE execution enabled** in the app dashboard to use Tier 2
chains (Stellar) server-side. If TEE is disabled, wallet creation succeeds but `rawSign`
returns an error. The user must enable this in the Dashboard.

**Ref:** <https://docs.privy.io/wallets/overview/chains>
