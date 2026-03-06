import { CrossmintAASDK } from "@crossmint/wallets-sdk";
import { ethers } from "ethers";
import { config } from "../shared/config.js";

/**
 * Example script to:
 * 1. Initialize Crossmint AA SDK
 * 2. Create/Retrieve a Smart Wallet for a user
 * 3. Fetch balances
 * 4. Transfer tokens (Bridge simulation)
 */

async function main() {
  console.log("Crossmint Smart Wallet — Base Management");
  console.log("──────────────────────────────────────────────────────");

  // [1] Initialize SDK
  const sdk = new CrossmintAASDK({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  // [2] Get or Create Wallet
  console.log(`\n[1/4] Getting wallet for: ${config.walletEmail}`);
  const wallet = await sdk.getOrCreateWallet(
    { email: config.walletEmail },
    config.chain
  );

  const address = await wallet.getAddress();
  console.log(`  Wallet Address: ${address}`);
  console.log(`  Chain:          ${config.chain}`);

  // [3] Fetch Balances
  console.log("\n[2/4] Fetching balances...");
  const balances = await wallet.getBalances();
  
  if (balances.length === 0) {
    console.log("  No balances found.");
  } else {
    balances.forEach((b) => {
      console.log(`  - ${b.amount} ${b.symbol} (${b.tokenAddress || "Native"})`);
    });
  }

  // [4] Staging: Fund wallet if needed
  if (config.isStaging) {
    console.log("\n[3/4] Staging detected: Funding wallet with test tokens...");
    try {
      const fundTx = await wallet.stagingFund();
      console.log(`  Funding request sent! Tx: ${fundTx}`);
    } catch (e) {
      console.log("  Funding skipped (might already have funds or limit reached)");
    }
  }

  // [5] Transfer (Bridge Simulation)
  console.log("\n[4/4] Executing a test transfer...");
  const testRecipient = "0xE35ca065B9C8572a22d6F9BB326101a81d5a1e2B";
  
  // We'll try to transfer 1 token (USDC/USDXM)
  const amount = "1";
  
  try {
    const tx = await wallet.transfer(
        testRecipient, 
        amount, 
        config.token === "usdc" ? undefined : config.baseUsdcContract
    );
    console.log(`\n✅ Transfer successful!`);
    console.log(`   Hash: ${tx}`);
    console.log(`   Explorer: https://${config.isStaging ? "sepolia." : ""}basescan.org/tx/${tx}`);
  } catch (error: any) {
    console.error(`\n❌ Transfer failed: ${error.message}`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
