import "dotenv/config";
import {
  ensureMainnetXlmFunding,
  ensureMainnetUsdcTrustline,
  FIREBLOCKS_STELLAR_MAINNET_ADDRESS,
} from "../wallets/fireblocks-stellar-mainnet.js";

async function main() {
  console.log("Fireblocks Stellar — Mainnet Setup");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Address: ${FIREBLOCKS_STELLAR_MAINNET_ADDRESS}`);
  console.log(`  Explorer: https://stellar.expert/explorer/public/account/${FIREBLOCKS_STELLAR_MAINNET_ADDRESS}`);

  console.log("\n[1/2] Ensuring XLM funding on mainnet (minimum 2 XLM)...");
  await ensureMainnetXlmFunding(2);

  console.log("\n[2/2] Ensuring USDC trustline on mainnet...");
  await ensureMainnetUsdcTrustline();

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("✅ Fireblocks Stellar mainnet setup complete.");
  console.log(`   Address ready to receive USDC: ${FIREBLOCKS_STELLAR_MAINNET_ADDRESS}`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err?.message ?? err);
  process.exit(1);
});
