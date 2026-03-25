# Privy Wallet POCs — Base Sepolia & Stellar Testnet

## Overview

Four proof-of-concept scripts that create server-controlled wallets via Privy and execute
transactions without any user interaction or OTP, using **Authorization Keys** as wallet
owners. This mirrors the Crossmint `external-wallet` adminSigner pattern.

---

## Architecture

### Chain Tiers

| Chain   | Tier | SDK Support                          | Broadcast   |
|---------|------|--------------------------------------|-------------|
| Base    | 3    | Full (`sendTransaction`, gas, etc.)  | Privy       |
| Stellar | 2    | Raw signing only (`rawSign`)         | Horizon API |

### Server-side Automation — Authorization Key Pattern

```text
┌─────────────────────────────────────────────────────────┐
│  Your Server (this script)                              │
│                                                         │
│  P-256 Private Key ──► signs every Privy API request    │
│  P-256 Public Key  ──► registered as wallet OWNER       │
└───────────────┬─────────────────────────────────────────┘
                │  HTTPS + privy-authorization-signature
                ▼
┌─────────────────────────────────────────────────────────┐
│  Privy TEE (Trusted Execution Environment)              │
│                                                         │
│  Verifies P-256 signature → executes wallet action      │
│  Wallet private key NEVER leaves TEE                    │
└─────────────────────────────────────────────────────────┘
```

No user, no OTP, no interactive approval at any step.

---

## Prerequisites

### 1. Privy Dashboard Setup

- Create an app at <https://dashboard.privy.io>
- Enable **TEE execution** (required for Stellar / Tier 2 chains)
- Copy **App ID** and **App Secret**

### 2. Generate Authorization Key

```bash
cd scripts
pnpm privy-keygen
```

Copy both keys to `.env`, then register the **public key** in:
> Dashboard → Your App → Wallets → Authorization keys → New key

---

## Quick Start

```bash
cd scripts
cp .env.example .env
# Fill in PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_PRIVATE_KEY, PRIVY_AUTHORIZATION_PUBLIC_KEY

# POC 1: Base Sepolia EVM wallet
pnpm privy-base

# POC 2: Stellar testnet wallet
pnpm privy-stellar

# POC 3: Defindex XLM vault deposit (Stellar testnet)
pnpm privy-defindex

# POC 4: Full mainnet flow (Base → Stellar → Defindex)
pnpm privy-mainnet
```

---

## POC 1 — Base (EVM)

**File:** `src/privy/privy-base-poc.ts`
**Wallet module:** `src/wallets/privy-base-wallet.ts`

### Flow (POC 1)

```text
1. privy.wallets().create({ chain_type: 'ethereum', owner: { public_key }, idempotency_key })
   └─► returns same wallet on repeated runs

2. ethers.JsonRpcProvider → getBalance(address)

3. privy.wallets().ethereum().sendTransaction(walletId, {
     caip2: 'eip155:84532',           // Base Sepolia
     params: { transaction: { to, value: '0x0', data: '0x' } },
     authorization_context: { authorization_private_keys: [privKey] }
   })
   └─► Privy handles gas estimation + broadcast
```

### Funding (POC 1)

Send at least 0.001 ETH to the wallet address on Base Sepolia.

---

## POC 2 — Stellar Testnet

**File:** `src/privy/privy-stellar-poc.ts`
**Wallet module:** `src/wallets/privy-stellar-wallet.ts`

### Flow (POC 2)

```text
1. privy.wallets().create({ chain_type: 'stellar', owner: { public_key }, idempotency_key })

2. GET https://horizon-testnet.stellar.org/accounts/{address}
   └─► fetch XLM balance + sequence number

3. TransactionBuilder (stellar-base) → build payment transaction → transaction.hash()

4. privy.wallets().rawSign(walletId, { params: { hash: '0x' + txHashHex }, authorization_context })
   └─► returns 64-byte Ed25519 signature (0x-prefixed hex)

5. Keypair.fromPublicKey(address).signatureHint() + xdr.DecoratedSignature
   └─► attach signature to transaction envelope

6. POST https://horizon-testnet.stellar.org/transactions  (XDR envelope)
   └─► returns transaction hash
```

### Funding (POC 2)

```bash
curl "https://friendbot.stellar.org/?addr=<YOUR_STELLAR_ADDRESS>"
```

Or visit: <https://laboratory.stellar.org/#account-creator?network=test>

---

## POC 3 — Defindex XLM Vault Deposit (Stellar Testnet)

**File:** `src/privy/privy-defindex-poc.ts`
**Wallet module:** `src/wallets/privy-defindex-wallet.ts`
**Vault:** `CCLV4H7WTLJQ7ATLHBBQV2WW3OINF3FOY5XZ7VPHZO7NH3D2ZS4GFSF6` (XLM, testnet)

### Flow (POC 3)

```text
1. getOrCreateStellarWallet() — reuses POC 2 wallet (same idempotency_key)

2. Auto-fund via Friendbot if balance < 15 XLM

3. POST https://api.defindex.io/vault/{addr}/deposit?network=testnet
   body: { amounts: [100000000], caller: address, invest: true, slippageBps: 50 }
   └─► returns { xdr: "unsigned XDR..." }

4. TransactionBuilder.fromXDR(xdr, Networks.TESTNET) → transaction.hash()
   └─► txHashHex = "0x" + hex

5. privy.wallets().rawSign(walletId, { hash: txHashHex }, authorization_context)
   └─► 64-byte Ed25519 signature

6. Attach xdr.DecoratedSignature to envelope (same as POC 2)

7. POST https://api.defindex.io/send?network=testnet { xdr: signedXdr }
   └─► { txHash }
```

### Key difference from POC 2

POC 2 builds the Stellar payment transaction itself. POC 3 delegates Soroban contract
call construction to the Defindex API — we only sign the hash and submit the result.

### Required env vars (POC 3)

```bash
DEFINDEX_API_KEY=<Bearer token from Defindex team>
```

---

## POC 4 — Full Mainnet Flow (Base → Stellar → Defindex)

**File:** `src/privy/privy-mainnet-poc.ts`

This POC implements the complete production bridge flow. For full step-by-step
documentation, code snippets, and the error log, see
[privy-bridge.md](./privy-bridge.md).

### Flow summary (POC 4)

```text
1. getOrCreateEvmWallet()             — Base wallet (Tier 3)
   checkEvmFunding()                  — ETH ≥ 0.0005 + USDC ≥ bridge amount
   → if insufficient: print address + instructions → EXIT

2. getOrCreateStellarWallet()         — Stellar wallet (Tier 2)
   ensureXlmFunding(address, 3)       — sponsor from STELLAR_SERVER_KEY if < 3 XLM
   ensureUsdcTrustline(walletId, addr)— changeTrust if missing → rawSign → Horizon mainnet

3. PrivyEvmSodaxAdapter               — implements IEvmWalletProvider via Privy sendTransaction
   SodaxBridgeService.getQuote()
   SodaxBridgeService.executeSwap()   → srcTxHash (Basescan)
   SodaxBridgeService.pollStatus()    → destTxHash + amountReceived (Stellar)

4. waitForUsdcBalance()               — poll Horizon until USDC confirmed on Stellar

5. depositToDefindexVault(..., "mainnet")
   POST api.defindex.io/vault/{SOROSWAP_EARN_USDC_VAULT}/deposit?network=mainnet
   rawSign → DecoratedSignature → POST /send?network=mainnet → txHash

6. Print full summary with explorer links
```

### Required env vars (POC 4)

```bash
STELLAR_SERVER_KEY=<Stellar secret key with ≥ 5 XLM on mainnet (for sponsoring)>
DEFINDEX_API_KEY=<Bearer token from Defindex>
```

---

## Comparison: Privy vs Crossmint

| Feature                   | Privy                              | Crossmint                          |
|---------------------------|------------------------------------|------------------------------------|
| Server auth primitive     | P-256 Authorization Key            | EVM private key (external-wallet)  |
| EVM wallet type           | EOA (native private key in TEE)    | Smart wallet (ERC-4337)            |
| Stellar support           | Tier 2 (raw sign)                  | Full (smart wallet via Soroban)    |
| Gas sponsorship (EVM)     | Yes (`sponsor: true`)              | Paid by smart wallet               |
| No-user automation        | Yes (authorization key as owner)   | Yes (external-wallet signer)       |
| Horizon balance poll      | Required before Defindex deposit   | Not needed                         |
| XLM funding               | Manual (`STELLAR_SERVER_KEY`)      | Auto on wallet creation            |
| SDK                       | `@privy-io/node`                   | `@crossmint/wallets-sdk` + REST    |

---

## File Structure

```text
scripts/src/
├── shared/
│   ├── config.ts                    # Extended with privy: { ... } + vault constants
│   ├── privy-client.ts              # PrivyClient singleton + buildAuthContext()
│   └── privy-evm-sodax-adapter.ts  # PrivyEvmSodaxAdapter (IEvmWalletProvider)
├── wallets/
│   ├── privy-base-wallet.ts         # EVM: create, balance, sendTransaction
│   ├── privy-stellar-wallet.ts      # Stellar: create, balance, rawSign + broadcast
│   │                                #   + ensureXlmFunding() + ensureUsdcTrustline()
│   └── privy-defindex-wallet.ts     # Defindex: buildDepositXdr + rawSign + submit
│                                    #   network param: "testnet" | "mainnet"
└── privy/
    ├── generate-auth-key.ts         # One-time keypair generation utility
    ├── privy-base-poc.ts            # POC 1 entry point
    ├── privy-stellar-poc.ts         # POC 2 entry point
    ├── privy-defindex-poc.ts        # POC 3 entry point
    └── privy-mainnet-poc.ts         # POC 4 entry point (full mainnet flow)
```
