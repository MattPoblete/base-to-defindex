# Base to DeFindex Bridge

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A cross-chain bridge solution to move assets (primarily USDC) from **Base (Coinbase L2)** to **Stellar/Soroban**, integrated with **DeFindex** vaults. This project leverages **Allbridge Core SDK** for liquidity and **Crossmint** for seamless smart wallet management via Account Abstraction.

## 🚀 Overview

This repository contains both a user-facing web application and a suite of developer tools for cross-chain operations:

- **`dapp/`**: A modern Next.js 15 frontend providing a seamless bridging experience.
- **`scripts/`**: TypeScript-based CLI tools and PoCs for wallet management and bridge testing.

## 🏗️ Architecture

- **Bridging Protocol**: [Allbridge Core](https://allbridge.io/)
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

## 📜 Documentation

- [Dapp README](./dapp/README.md)
- [Scripts README](./scripts/README.md)
- [Developer Context (AI/Gemini CLI)](./GEMINI.md)

## ⚖️ License

This project is licensed under the MIT License - see the LICENSE file for details.
