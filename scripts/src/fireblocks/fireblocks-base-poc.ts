import "dotenv/config";
import {
  getOrCreateEvmVault,
  getEvmBalance,
  refreshFireblocksBalance,
  sendEvmTransaction,
} from "../wallets/fireblocks-base-wallet.js";

const TEST_RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const MINIMUM_ETH_FOR_TX = 0.0001;

async function main() {
  console.log("Fireblocks MPC Vault — Ethereum Sepolia (EVM)");
  console.log("──────────────────────────────────────────────────────────────");

  // [1] Get vault and activate ETH_TEST5 asset
  console.log("\n[1/3] Retrieving MPC Vault + activating Ethereum Sepolia asset...");
  const { vaultId, address } = await getOrCreateEvmVault();
  console.log(`  Vault ID:  ${vaultId}`);
  console.log(`  Address:   ${address}`);
  console.log(`  Explorer:  https://sepolia.etherscan.io/address/${address}`);

  // [2] Check ETH balance
  console.log("\n[2/3] Fetching ETH balance (Ethereum Sepolia)...");
  const balance = await getEvmBalance(address);
  console.log(`  Balance: ${balance} ETH`);

  // [3] Send test transaction
  console.log("\n[3/3] Sending test transaction...");

  if (parseFloat(balance) < MINIMUM_ETH_FOR_TX) {
    console.log(`  ⚠️  Insufficient ETH (need ≥ ${MINIMUM_ETH_FOR_TX} ETH for gas).`);
    console.log("");
    console.log("  Fund this address with Sepolia ETH:");
    console.log("    https://sepoliafaucet.com");
    console.log("    https://www.alchemy.com/faucets/ethereum-sepolia");
    console.log("    https://faucet.quicknode.com/ethereum/sepolia");
    console.log("");
    console.log(`  ➜  ${address}`);
    process.exit(0);
  }

  console.log("  Syncing Fireblocks vault balance with chain...");
  const fbBalance = await refreshFireblocksBalance(vaultId);
  console.log(`  Fireblocks balance: ${fbBalance} ETH`);

  if (parseFloat(fbBalance) < MINIMUM_ETH_FOR_TX) {
    console.log(`  ⚠️  Insufficient ETH (need ≥ ${MINIMUM_ETH_FOR_TX} ETH for gas).`);
    console.log("");
    console.log("  Fund this address with Sepolia ETH:");
    console.log("    https://sepoliafaucet.com");
    console.log("    https://www.alchemy.com/faucets/ethereum-sepolia");
    console.log("    https://faucet.quicknode.com/ethereum/sepolia");
    console.log("");
    console.log(`  ➜  ${address}`);
    process.exit(0);
  }

  console.log("  Submitting via Fireblocks (polling for completion)...");
  const txHash = await sendEvmTransaction(vaultId, TEST_RECIPIENT);
  console.log(`  ✅ Transaction sent!`);
  console.log(`  Hash:     ${txHash}`);
  console.log(`  Explorer: https://sepolia.etherscan.io/tx/${txHash}`);

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("POC 1 complete. Verify in Fireblocks Console → Transactions.");
}

main().catch((err) => {
  console.error("Error:", err?.message ?? err);
  process.exit(1);
});
