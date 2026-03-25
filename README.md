# Base to DeFindex Bridge

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A cross-chain bridge solution to move assets (primarily USDC) from **Base (L2)** to **Stellar/Soroban**, with integration targets for **DeFindex** vaults. The project supports two wallet providers — **Crossmint** smart wallets (ERC-4337) and **Privy** TEE wallets — using the **Sodax** intent protocol for cross-chain execution.

## Components

- **`scripts/`** — TypeScript CLI tools for server-side cross-chain operations.
- **`dapp/`** — Next.js 15 frontend providing a user-facing bridge UI powered by Sodax *(work in progress)*.

## Architecture

```
[Base EVM Wallet]
      │  ERC-20 approve + createIntent (Sodax)
      ▼
[Sodax Spoke — Base]  →  [Sodax Hub — Sonic]  →  [Stellar Wallet]
                                                        │
                                                        │  Defindex vault deposit
                                                        ▼
                                                 [Defindex Vault — Soroban]
```

| Component | Detail |
|---|---|
| Bridge protocol | [Sodax](https://sodax.com/) — intent-based, solver-filled |
| EVM wallet (option A) | Crossmint smart wallet (ERC-4337) via REST API |
| EVM wallet (option B) | Privy EOA wallet in TEE via `@privy-io/node` |
| Stellar wallet (option A) | Crossmint Stellar smart wallet (Soroban) |
| Stellar wallet (option B) | Privy Stellar wallet (Tier 2 — raw sign + Horizon) |
| Source chain | Base Mainnet (`eip155:8453`) |
| Destination chain | Stellar Mainnet (`stellar:pubnet`) |
| Defindex vault | Soroswap Earn USDC — `CA2FIPJ7...` |

## Getting Started

### Scripts (CLI Tools)

```bash
cd scripts
pnpm install
cp .env.example .env
# Configure .env — see scripts/README.md for all variables
```

#### Primary bridge commands

```bash
# Crossmint path (ERC-4337 smart wallets)
pnpm sodax-crossmint

# Privy path (TEE EOA wallets)
pnpm privy-mainnet

# Check status of an in-flight intent
pnpm sodax-status -- <SOURCE_TX_HASH>
```

#### Wallet utilities

```bash
pnpm base-wallet        # Crossmint EVM smart wallet
pnpm stellar-wallet     # Crossmint Stellar smart wallet
pnpm privy-base         # Privy EVM wallet (Base Sepolia)
pnpm privy-stellar      # Privy Stellar wallet (testnet)
pnpm privy-keygen       # Generate Privy Authorization Key pair
```

### Dapp (Web Interface)

```bash
cd dapp
pnpm install
cp .env.example .env.local
pnpm dev
```

## Documentation

| Document | Description |
|---|---|
| [scripts/README.md](./scripts/README.md) | Setup, env vars, all available commands |
| [scripts/docs/index.md](./scripts/docs/index.md) | Documentation index — start here for deep dives |
| [scripts/docs/crossmint-bridge.md](./scripts/docs/crossmint-bridge.md) | Crossmint bridge guide (step-by-step, sequence diagram, gotchas) |
| [scripts/docs/privy-bridge.md](./scripts/docs/privy-bridge.md) | Privy bridge guide (step-by-step, error log, design decisions) |
| [scripts/docs/privy-pocs.md](./scripts/docs/privy-pocs.md) | Privy POCs quickstart (4 scripts, testnet + mainnet) |
| [scripts/docs/custodial-vs-selfcustodial.md](./scripts/docs/custodial-vs-selfcustodial.md) | Custodial vs self-custodial architecture comparison |

## License

MIT — see [LICENSE](LICENSE).
