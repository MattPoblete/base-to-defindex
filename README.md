# Base to DeFindex Bridge

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A cross-chain bridge solution to move assets (primarily USDC) from **Base (L2)** to **Stellar/Soroban**, with integration targets for **DeFindex** vaults. The project uses **Crossmint** smart wallets (Account Abstraction) for both chains and the **Sodax** intent protocol for cross-chain execution.

## Overview

This repository contains two components:

- **`dapp/`**: Next.js 15 frontend providing a user-facing bridge UI powered by Sodax.
- **`scripts/`**: TypeScript CLI tools for server-side cross-chain operations:
  - **`bridge/`**: Cross-chain transfer scripts (Sodax, Allbridge, Near Intents).
  - **`wallets/`**: Smart wallet management for Base and Stellar via Crossmint.
  - **`shared/`**: Common config, REST client, adapters, and Sodax service.

## Architecture

- **Bridging protocol**: [Sodax](https://sodax.com/) (intent-based, solver-filled)
- **Wallet infrastructure**: [Crossmint Smart Wallets](https://www.crossmint.com/) — server-key pattern (no email OTP)
- **Source chain**: Base (EVM)
- **Destination chain**: Stellar (Soroban)

## Getting Started

### Prerequisites

- Node.js v18+
- pnpm

### Dapp (Web Interface)

```bash
cd dapp
pnpm install
cp .env.example .env.local
# Configure .env.local
pnpm dev
```

### Scripts (CLI Tools)

```bash
cd scripts
pnpm install
cp .env.example .env
# Configure .env (see scripts/README.md for all variables)
```

## Running Scripts

### Sodax + Crossmint bridge (primary)

```bash
cd scripts

# Bridge Base USDC → Stellar USDC (Stellar recipient auto-discovered via Crossmint email)
pnpm sodax-crossmint

# Override recipient
pnpm sodax-crossmint -- <STELLAR_ADDRESS>

# Check status of an in-flight intent
pnpm sodax-status -- <SOURCE_TX_HASH>
```

### Other bridge scripts

```bash
pnpm allbridge-bridge   # Allbridge Core SDK
pnpm near-intents       # Near Intents / Defuse protocol
```

### Wallet utilities

```bash
pnpm base-wallet        # Manage Crossmint EVM smart wallet
pnpm stellar-wallet     # Manage Crossmint Stellar smart wallet
```

## Documentation

- [Scripts README](./scripts/README.md) — detailed setup, env vars, architecture
- [Dapp README](./dapp/README.md) — dapp setup and usage

## License

MIT — see [LICENSE](LICENSE).
