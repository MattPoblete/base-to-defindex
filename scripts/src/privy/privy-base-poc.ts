import "dotenv/config";
import {
  getOrCreateEvmWallet,
  getEvmBalance,
  sendTestTransaction,
} from "../wallets/privy-base-wallet.js";

const TEST_RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const MINIMUM_ETH_FOR_TX = 0.0001;

async function main() {
  console.log("Privy Server Wallet — Base Mainnet (EVM / Tier 3)");
  console.log("──────────────────────────────────────────────────────────────");

  // [1] Create or retrieve the EVM wallet (idempotent via idempotency_key)
  console.log("\n[1/3] Creating / retrieving EVM wallet...");
  const wallet = await getOrCreateEvmWallet();
  console.log(`  Wallet ID:   ${wallet.id}`);
  console.log(`  Address:     ${wallet.address}`);
  console.log(`  Chain type:  ${wallet.chain_type}`);
  console.log(`  Explorer:    https://basescan.org/address/${wallet.address}`);

  // [2] Check ETH balance
  console.log("\n[2/3] Fetching ETH balance...");
  const balance = await getEvmBalance(wallet.address);
  console.log(`  Balance: ${balance} ETH`);

  // [3] Send a 0-value test transaction if funded
  console.log("\n[3/3] Sending test transaction...");

  if (parseFloat(balance) < MINIMUM_ETH_FOR_TX) {
    console.log(`  ⚠️  Insufficient ETH (need ≥ ${MINIMUM_ETH_FOR_TX} ETH for gas).`);
    console.log("");
    console.log("  Send Base mainnet ETH to this address and re-run:");
    console.log("");
    console.log(`  ➜  ${wallet.address}`);
    console.log("");
    console.log(`  Explorer: https://basescan.org/address/${wallet.address}`);
    process.exit(0);
  }

  const txHash = await sendTestTransaction(wallet.id, TEST_RECIPIENT);
  console.log(`  ✅ Transaction sent!`);
  console.log(`  Hash:       ${txHash}`);
  console.log(`  Explorer:   https://basescan.org/tx/${txHash}`);

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("POC complete. Wallet visible in Privy Dashboard → Wallets.");
}

main().catch((err) => {
  console.error("Error:", err?.message ?? err);
  process.exit(1);
});
