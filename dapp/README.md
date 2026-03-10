# Base to DeFindex — Dapp

Next.js 15 frontend for bridging USDC from **Base** to **Stellar** via the [Sodax](https://sodax.com/) intent protocol, with **Crossmint** smart wallet integration for Account Abstraction.

## Setup

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment variables:**

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your values
   ```

   | Variable | Description |
   | --- | --- |
   | `NEXT_PUBLIC_CROSSMINT_API_KEY` | Crossmint client-side API key (`ck_...`) from the [Crossmint console](https://www.crossmint.com/console/projects/apiKeys) |
   | `NEXT_PUBLIC_BASE_RPC_URL` | JSON-RPC endpoint for Base mainnet |
   | `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint |
   | `NEXT_PUBLIC_STELLAR_HORIZON_URL` | Stellar Horizon API URL |

3. **Run the development server:**

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Stack

- **Framework**: Next.js 15 (App Router)
- **Bridge**: Sodax SDK (intent-based, solver-filled)
- **Wallets**: Crossmint (`@crossmint/wallets-sdk`) + Allbridge Core SDK
- **Chains**: Base (EVM source) → Stellar/Soroban (destination)
