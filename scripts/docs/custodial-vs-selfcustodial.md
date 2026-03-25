# Custodial vs Self-Custodial — Privy + Defindex (Stellar)

Architectural comparison of the two wallet management models for interacting with
Defindex vaults on Stellar using Privy as the wallet provider.

---

## Definitions

| Model | Description |
|---|---|
| **Custodial (server-managed)** | Your server controls the wallet. The user signs nothing — they trust you as the operator. |
| **Self-custodial** | The user owns their wallet. No one else can sign on their behalf without explicit approval. |

---

## Architecture Comparison

### Custodial

```
┌──────────────────────────────────────────────────────────┐
│  Your Server                                             │
│                                                          │
│  P-256 private key ──► signs every request to Privy API  │
│  P-256 public key  ──► registered as wallet OWNER        │
└──────────────────────┬───────────────────────────────────┘
                       │  HTTPS + privy-authorization-signature
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Privy TEE                                               │
│                                                          │
│  Verifies P-256 signature → executes rawSign             │
│  Stellar private key NEVER leaves the TEE                │
└──────────────────────────────────────────────────────────┘
```

- The user does not interact at any step.
- The server acts as the wallet manager.
- Typical model for automated yield management, robo-advisors.

---

### Self-Custodial

```
┌──────────────────────────────────────────────────────────┐
│  User's Browser / App                                    │
│                                                          │
│  Login (email / Google / passkey)                        │
│  └─► Privy creates the user's embedded wallet            │
│                                                          │
│  privy.sign(txHash) ──► approval modal shown to user     │
└──────────────────────┬───────────────────────────────────┘
                       │  Only the user can approve
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Privy TEE                                               │
│                                                          │
│  Verifies user session → executes rawSign                │
│  Stellar private key NEVER leaves the TEE                │
└──────────────────────────────────────────────────────────┘
```

- The user approves each transaction explicitly.
- The server can never sign without the user present.
- Typical model for dapps, end-user wallets.

---

## Defindex Deposit Flow — Step by Step

Steps that are **identical** in both models are marked with `=`.

| Step | Custodial | Self-Custodial |
|---|---|---|
| 1 | Server creates wallet with `idempotency_key` (P-256 owner) | User logs in → Privy creates/recovers their embedded wallet |
| 2 | Server fetches balance via Horizon | Frontend fetches balance via Horizon |
| 3 `=` | `POST api.defindex.io/vault/{addr}/deposit` → `{ xdr }` | `POST api.defindex.io/vault/{addr}/deposit` → `{ xdr }` |
| 4 `=` | `TransactionBuilder.fromXDR(xdr)` → `transaction.hash()` | `TransactionBuilder.fromXDR(xdr)` → `transaction.hash()` |
| **5** ⚠️ | `privy.wallets().rawSign(walletId, { hash }, authContext)` | `wallet.sign({ message: txHashBytes })` → user modal |
| 6 `=` | Attach `xdr.DecoratedSignature` to envelope | Attach `xdr.DecoratedSignature` to envelope |
| 7 `=` | `POST api.defindex.io/send` → `{ txHash }` | `POST api.defindex.io/send` → `{ txHash }` |

**Only step 5 differs.** The rest of the flow is reusable in both models.

---

## Implementation Differences

### SDK used

```
Custodial      →  @privy-io/node       (Node.js, server-side)
Self-Custodial →  @privy-io/react-auth (React) | @privy-io/expo (React Native)
```

### Authentication in Privy

```typescript
// CUSTODIAL — Authorization Key (server)
// Configure in Privy Dashboard: Wallets → Authorization Keys → New Key
const authorization_context = {
  authorization_private_keys: [authorizationPrivateKey],
};
await privy.wallets().rawSign(walletId, {
  params: { hash: txHashHex },
  authorization_context,
});

// SELF-CUSTODIAL — user session (browser)
// No authorization_context — Privy verifies the active user session
const { signature } = await wallet.sign({ message: txHashBytes });
// Privy shows a modal → user approves or rejects
```

### Obtaining the walletId

```typescript
// CUSTODIAL — server creates the wallet and stores the ID
const wallet = await privy.wallets().create({
  chain_type: "stellar",
  owner: { public_key: authorizationPublicKey },
  idempotency_key: "user-123-stellar-v1",
});
const walletId = wallet.id;

// SELF-CUSTODIAL — comes from the authenticated user session
const { wallets } = usePrivy();
const stellarWallet = wallets.find(w => w.chainType === "stellar");
const walletAddress = stellarWallet.address;
```

### Recommended separation of concerns (self-custodial)

```
Backend  (your server)
  └─► POST api.defindex.io/vault/{addr}/deposit → return xdr to frontend
      (avoids exposing the Defindex API key to the browser)

Frontend (user's browser)
  └─► parse xdr → request signature from Privy → user approves
  └─► attach DecoratedSignature
  └─► POST api.defindex.io/send → txHash
```

---

## Properties Comparison

| Property | Custodial | Self-Custodial |
|---|---|---|
| **Private key control** | Server (via TEE) | User (via TEE) |
| **User interaction** | None | Approval per tx |
| **Can be automated** | ✅ Yes (cron, triggers, etc.) | ❌ No (requires active user) |
| **Legal responsibility** | You (as custodian) | The user |
| **UX** | Transparent / invisible | Signature modal |
| **Recovery if access lost** | You manage the recovery | User manages their recovery |
| **Funds risk** | If your server is compromised | Only if user is compromised |
| **Regulation (LATAM)** | More scrutiny (VASP) | Less (non-custodial) |
| **Integration time** | Lower (backend only) | Higher (frontend + UX) |

---

## When to Use Each Model

### Use Custodial when:
- You are an investment manager or fund (automated yield management).
- The user wants "deposit and forget" — they should not approve every rebalance.
- You need to execute scheduled operations (e.g. daily rebalancing).
- The user has no technical knowledge of wallets.

### Use Self-Custodial when:
- You want to minimize legal liability over user funds.
- The user must explicitly approve each movement.
- You are building a public dapp where anyone can connect their wallet.
- Your business model requires full transparency ("not your keys, not your coins").

### Hybrid model (advanced):
The user owns their wallet (self-custodial) but delegates specific permissions to the
server via **Soroban contract-level authorization** — the server can only execute
operations authorized by the user within the contract, without unrestricted access to
their funds.

---

## Relevant Files in This Repository

| File | Model | Description |
|---|---|---|
| `scripts/src/wallets/privy-defindex-wallet.ts` | Custodial | `depositToDefindexVault()` server-side |
| `scripts/src/privy/privy-defindex-poc.ts` | Custodial | POC 3 entry point |
| `scripts/src/wallets/privy-stellar-wallet.ts` | Custodial | `rawSign` + Horizon broadcast |
| `scripts/src/shared/privy-client.ts` | Custodial | PrivyClient + `buildAuthContext()` |
| `dapp/` | Self-Custodial *(work in progress)* | Next.js frontend for user-facing integration |
