# Scripts Documentation Index

Technical documentation for the Base → Stellar → Defindex bridge scripts.

---

## Quick Navigation

| Document | Description |
|---|---|
| [crossmint-bridge.md](./crossmint-bridge.md) | Complete guide for the Crossmint wallet path — EVM smart wallet + Soroban |
| [privy-bridge.md](./privy-bridge.md) | Complete guide for the Privy wallet path — TEE EOA + Horizon broadcast |
| [privy-pocs.md](./privy-pocs.md) | Quickstart for all 4 Privy POCs (Base, Stellar, Defindex, Mainnet) |
| [custodial-vs-selfcustodial.md](./custodial-vs-selfcustodial.md) | Architectural comparison: server-managed vs user-owned wallets |

---

## Which document do I need?

**I want to bridge USDC from Base → Stellar using Crossmint wallets:**
→ [crossmint-bridge.md](./crossmint-bridge.md)

**I want to bridge USDC from Base → Stellar using Privy wallets:**
→ [privy-bridge.md](./privy-bridge.md)

**I want a quick overview of the 4 Privy POCs (testnet experiments):**
→ [privy-pocs.md](./privy-pocs.md)

**I'm deciding between custodial and self-custodial architecture:**
→ [custodial-vs-selfcustodial.md](./custodial-vs-selfcustodial.md)

**I need to compare Crossmint vs Privy side by side:**
→ See the comparison table in [crossmint-bridge.md § Crossmint vs Privy](./crossmint-bridge.md#crossmint-vs-privy--key-differences)

---

## Document Summaries

### [crossmint-bridge.md](./crossmint-bridge.md)
Full step-by-step guide for the primary production flow: Base EVM smart wallet (ERC-4337
via Crossmint REST API) → Sodax intent bridge → Stellar smart wallet → Defindex vault
deposit via Soroban contract-call. Includes module architecture, full sequence diagram,
integration checklist, and known gotchas.

### [privy-bridge.md](./privy-bridge.md)
Full step-by-step guide for the Privy production flow: Privy EVM EOA (Tier 3) →
Sodax intent bridge → Privy Stellar wallet (Tier 2, raw sign) → Horizon USDC polling →
Defindex vault deposit. Includes an error log (E1–E9) with root causes and fixes, plus
design decisions (D1–D8).

### [privy-pocs.md](./privy-pocs.md)
Overview and quickstart for the four Privy proof-of-concept scripts. Covers POC 1
(Base EVM wallet on testnet), POC 2 (Stellar testnet wallet), POC 3 (Defindex XLM vault
deposit on testnet), and POC 4 (full mainnet bridge flow). Also includes a Privy vs
Crossmint feature comparison.

### [custodial-vs-selfcustodial.md](./custodial-vs-selfcustodial.md)
Architectural comparison of custodial (server-managed) vs self-custodial (user-owned)
wallet models for Defindex integration. Explains when to use each model, key
implementation differences, and a side-by-side properties table.

---

## Stack Reference

| Component | Version / Detail |
|---|---|
| Crossmint API | `2025-06-09` |
| Crossmint wallet type | `evm-smart-wallet` (ERC-4337 + ERC-7579) for EVM; `stellar-smart-wallet` for Stellar |
| Privy SDK | `@privy-io/node` v0.11.0 |
| Sodax SDK | `@sodax/sdk` (mainnet, hub on Sonic) |
| Ethers.js | v6 |
| Runtime | `tsx` (TypeScript direct execution) |
| Source chain | Base Mainnet |
| Destination chain | Stellar Mainnet |
| Bridge token | USDC Base (6 dec) → USDC Stellar SAC (7 dec) |
| Defindex vault | Soroswap Earn USDC — `CA2FIPJ7U6BG3N7EOZFI74XPJZOEOD4TYWXFVCIO5VDCHTVAGS6F4UKK` |
