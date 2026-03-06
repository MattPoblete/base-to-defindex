# Base to DeFindex Bridge

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A cross-chain bridge solution to move assets (primarily USDC) from **Base (Base L2)** to **Stellar/Soroban**, integrated with **DeFindex** vaults. This project leverages **Allbridge Core SDK** and **Sodax Solver** for liquidity, and **Crossmint** for seamless smart wallet management via Account Abstraction.

## 🚀 Overview

This repository contains both a user-facing web application and a suite of developer tools for cross-chain operations:

- **`dapp/`**: A modern Next.js 15 frontend providing a seamless bridging experience.
- **`scripts/`**: A structured collection of TypeScript CLI tools:
  - **`bridge/`**: Cross-chain transfer implementations (Sodax, Allbridge, Near Intents).
  - **`wallets/`**: Smart wallet management for Base and Stellar.
  - **`shared/`**: Common configuration and utilities.

## 🏗️ Architecture

- **Bridging Protocols**: [Allbridge Core](https://allbridge.io/), [Sodax Solver](https://sodax.com/)
- **Wallet Infrastructure**: [Crossmint Smart Wallets](https://www.crossmint.com/)
- **Source Network**: Base (EVM)
- **Destination Network**: Stellar (Soroban)
- **Integration Target**: DeFindex Vaults

## 🛠️ Getting Started

### Prerequisites

- Node.js (v18+)
- pnpm (for the dapp)
- npm (for scripts)

### Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd base-to-defindex
   ```

2. **Dapp (Web Interface):**
   ```bash
   cd dapp
   pnpm install
   cp .env.example .env.local
   # Configure your variables in .env.local
   pnpm dev
   ```

3. **Scripts (CLI Tools):**
   ```bash
   cd scripts
   npm install
   cp .env.example .env
   # Configure your variables in .env
   ```

## ⌨️ Running Scripts

The `scripts/` directory contains tools for interacting with the bridge protocols and wallets.

### Bridge Operations
- **Sodax Solver (Swap + Bridge)**: Recommended for most cases as it optimizes for speed using solvers.
  ```bash
  npm run sodax-bridge -- <STELLAR_RECIPIENT_ADDRESS>
  ```
- **Sodax Pure Bridge**: For direct 1:1 asset bridging without solver swaps.
  ```bash
  npm run sodax-bridge-pure -- <STELLAR_RECIPIENT_ADDRESS>
  ```
- **Status Checker**: Monitor any Sodax transaction using its source hash.
  ```bash
  npm run sodax-status -- <SOURCE_TX_HASH>
  ```
- **Allbridge Core SDK**: Executes the bridge flow using Allbridge.
  ```bash
  npm run allbridge-bridge -- <STELLAR_RECIPIENT_ADDRESS>
  ```

### Wallet Management
- **Base Smart Wallet**: Manage and check balances for Crossmint wallets on Base.
  ```bash
  npm run base-wallet
  ```
- **Stellar Smart Wallet**: Manage and check balances for Crossmint wallets on Stellar.
  ```bash
  npm run stellar-wallet
  ```

## 📜 Documentation

- [Dapp README](./dapp/README.md)
- [Scripts README](./scripts/README.md)
- [Developer Context (AI/Gemini CLI)](./GEMINI.md)

## ⚖️ License

This project is licensed under the MIT License - see the LICENSE file for details.
