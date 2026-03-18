# Privy POC — Design Decisions Log

## D1 — Use `@privy-io/node` (not `@privy-io/server-auth`)

**Decision:** Use `@privy-io/node` v0.11.0.

**Why:** `@privy-io/server-auth` is officially deprecated. `@privy-io/node` is the current SDK with
the latest API (including the new `wallets()` interface, key quorums, and improved TypeScript types).

**Ref:** https://docs.privy.io/wallets/using-wallets/signers/quickstart

---

## D2 — Authorization Key as sole wallet owner (1-of-1 quorum)

**Decision:** Wallet owner is set to `{ public_key: PRIVY_AUTHORIZATION_PUBLIC_KEY }` — a single
P-256 key controlled by this server. No user, no quorum.

**Why:** This is the simplest fully-automated pattern — equivalent to Crossmint's
`external-wallet` adminSigner. The key never requires OTP because there is no user in the loop.
For production, consider a 2-of-2 quorum (user + server key) to enforce user consent.

**Ref:** https://docs.privy.io/controls/authorization-keys/keys/create/key

---

## D3 — Idempotency key for wallet creation

**Decision:** Pass a fixed `idempotency_key` string when calling `privy.wallets().create()`.

**Why:** This makes the create call idempotent — repeated runs return the same wallet instead of
creating duplicates. The idempotency_key is scoped to the Privy app, so different keys produce
different wallets.

**Ref:** https://docs.privy.io/wallets/wallets/create/create-a-wallet (Body → idempotency_key)

---

## D4 — Stellar as Tier 2 (raw sign, manual broadcast)

**Decision:** Build Stellar transactions manually with `@stellar/stellar-base`, get the tx hash,
raw-sign it via `privy.wallets().rawSign()`, attach the signature as a `DecoratedSignature`,
and broadcast the XDR envelope to Horizon testnet via `fetch`.

**Why:** Stellar has Tier 2 support in Privy — the TEE only provides cryptographic signing (Ed25519).
All transaction construction, serialization, and broadcast are the caller's responsibility.
Privy does not have a `stellar()` high-level interface like it does for `ethereum()`.

**Ref:**
- https://docs.privy.io/wallets/overview/chains (Tier 2 list)
- https://docs.privy.io/wallets/using-wallets/other-chains/index (rawSign)
- https://docs.privy.io/recipes/use-tier-2 (Aptos example — same pattern for Stellar)

---

## D5 — `@stellar/stellar-base` (not `@stellar/stellar-sdk`)

**Decision:** Use `@stellar/stellar-base` (already a project dependency) for transaction building
instead of adding `@stellar/stellar-sdk`.

**Why:** `stellar-base` includes all primitives needed: `TransactionBuilder`, `Operation`, `Asset`,
`Keypair`, `Account`, `Networks`, and `xdr`. The only thing missing compared to `stellar-sdk`
is the built-in Horizon client, which we replace with plain `fetch` calls.

---

## D6 — rawSign response normalization

**Decision:** Access the signature via multiple fallback paths:
```typescript
const sig = result?.data?.signature ?? result?.signature ?? (result as unknown as string);
```

**Why:** The `@privy-io/node` SDK v0.11.0 `rawSign` return type is not fully documented.
The Tier-2 recipe casts `signatureResponse as unknown as string`, while the REST API docs describe
a `data.signature` field. The fallback chain handles both shapes defensively.

**Ref:** https://docs.privy.io/recipes/use-tier-2

---

## D7 — Both private and public authorization keys stored in `.env`

**Decision:** Store both `PRIVY_AUTHORIZATION_PRIVATE_KEY` and `PRIVY_AUTHORIZATION_PUBLIC_KEY`
as env vars.

**Why:** The private key signs Privy API requests (authorization_context). The public key is needed
to set the wallet owner (`owner: { public_key }`) and must also be registered in the Privy Dashboard.
Deriving the public key from the DER private key at runtime is possible but adds crypto complexity.
Storing both is simpler and follows the same pattern as the Privy keygen output.

---

## D8 — TEE requirement for Stellar

**Decision:** Documented as a prerequisite but not enforced in code.

**Why:** Privy requires **TEE execution enabled** in the app dashboard to use Tier 2 chains
(Stellar) and server-side access with authorization keys. If TEE is disabled, wallet creation
will succeed but `rawSign` will return an error. The user must enable this in the Dashboard.

**Ref:** https://docs.privy.io/wallets/overview/chains
