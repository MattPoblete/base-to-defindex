import "dotenv/config";
import {
  getOrCreateStellarVault,
  getStellarBalance,
  sendXlmPayment,
} from "../wallets/fireblocks-stellar-wallet.js";

// Funded testnet address used as payment recipient
const TEST_RECIPIENT = "GCV5WY74SAW576NAB5ELMXTURWIJLTJAIVLMRRWQXH7EQHOGOJAB5YUQ";
const SEND_AMOUNT_XLM = "1";
const MINIMUM_XLM_FOR_TX = 2; // 1 XLM to send + 1 for reserve/fees

async function main() {
  console.log("Fireblocks MPC Vault — Stellar Testnet (XLM)");
  console.log("──────────────────────────────────────────────────────────────");

  // [1] Get vault and activate XLM_TEST asset
  console.log("\n[1/3] Retrieving MPC Vault + activating Stellar Testnet asset...");
  const { vaultId, address } = await getOrCreateStellarVault();
  console.log(`  Vault ID:  ${vaultId}`);
  console.log(`  Address:   ${address}`);
  console.log(`  Explorer:  https://stellar.expert/explorer/testnet/account/${address}`);

  // [2] Check XLM balance
  console.log("\n[2/3] Fetching XLM balance (Stellar Testnet)...");
  const balance = await getStellarBalance(address);
  console.log(`  Balance: ${balance} XLM`);

  // [3] Send XLM payment
  console.log(`\n[3/3] Sending ${SEND_AMOUNT_XLM} XLM test payment...`);

  if (parseFloat(balance) < MINIMUM_XLM_FOR_TX) {
    console.log(`  ⚠️  Insufficient XLM (need ≥ ${MINIMUM_XLM_FOR_TX} XLM).`);
    console.log("");
    console.log("  Fund this address with Stellar Testnet XLM via Friendbot:");
    console.log(`    https://friendbot.stellar.org/?addr=${address}`);
    console.log("");
    console.log(`  ➜  ${address}`);
    process.exit(0);
  }

  console.log(`  To:       ${TEST_RECIPIENT}`);
  console.log("  Submitting via Fireblocks (polling for completion)...");
  const txHash = await sendXlmPayment(vaultId, TEST_RECIPIENT, SEND_AMOUNT_XLM);
  console.log(`  ✅ Transaction sent!`);
  console.log(`  Hash:     ${txHash}`);
  console.log(`  Explorer: https://stellar.expert/explorer/testnet/tx/${txHash}`);

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("POC 2 complete. Verify in Fireblocks Console → Transactions.");
}

main().catch((err) => {
  console.error("Error:", err?.message ?? err);
  process.exit(1);
});
