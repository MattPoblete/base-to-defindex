# Bridge & Wallet Scripts

This directory contains CLI tools for managing wallets and interacting with various bridge protocols programmatically.

## 🛠️ Prerequisites & Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Environment Variables (.env):**
   Configure the required variables to operate with the different protocols:
   - `EVM_PRIVATE_KEY`: Private key for the Base (EVM) wallet.
   - `BASE_RPC_URL`: RPC node URL for Base.
   - `CROSSMINT_SERVER_API_KEY`: API Key for Smart Wallet management.
   - `NEAR_INTENTS_JWT`: JWT token for the Near Intents/Defuse protocol.

---

## 🚀 Available Bridge Protocols

We have integrated multiple protocols to ensure redundancy and efficiency in cross-chain asset movement.

### 1. Sodax Solver

An intent-based protocol using solvers to optimize transaction speed and cost.

| Command | Purpose | Status |
| --- | --- | --- |
| `npm run sodax-bridge -- <ADDR>` | **Solver Flow**: Automated Swap + Bridge. | 🚧 Recurrent Status 2 |
| `npm run sodax-bridge-pure -- <ADDR>` | **Direct Flow**: 1:1 Bridge without swaps. | 🚧 Recurrent Status 2 |
| `npm run sodax-status -- <HASH>` | **Monitoring**: Debugging and payload decoding. | ✅ Operational |

### 2. Allbridge Core

Direct integration with Allbridge Core for liquidity transfers between EVM and Stellar.

| Command | Purpose | Status |
| --- | --- | --- |
| `npm run allbridge-bridge` | Executes the full bridge flow using Allbridge SDK. | ⚠️ Operational: not supporting C addresses |

### 3. Near Intents (Defuse)

Cross-chain intent messaging protocol.

| Command | Purpose | Status |
| --- | --- | --- |
| `npm run near-intents` | Bridge based on the Defuse/Near Intents protocol. | ⚠️ Operational: not supporting C addresses |

---

## 🛡️ Modular Bridge (Crossmint)

This script implements a modular architecture designed to swap the underlying bridge protocol while maintaining the same wallet infrastructure.

| Command | Purpose | Status |
| --- | --- | --- |
| `npm run crossmint-bridge` | Crossmint-orchestrated bridge with support for swappable modules. | 🧪 Experimental: investigation in progress |

---

## 👛 Wallet Management (Crossmint)

| Command | Purpose | Status |
| --- | --- | --- |
| `npm run base-wallet` | Manage Smart Wallets on **Base** (EVM). | ✅ Stable |
| `npm run stellar-wallet` | Manage Smart Wallets on **Stellar** (Soroban). | ✅ Stable |

---

## 🔍 Technical Debugging Notes (Sodax)

- **Status 2 (STARTED_NOT_FINISHED):** The transaction is on the Hub (Sonic) waiting for final execution by the solver.
- **Error -999:** Generic API error; please double-check token parameters and indexing.
- **Payload Decoding:** `sodax-status` automatically strips the function selector for a clean ABI decoding of the intent.
