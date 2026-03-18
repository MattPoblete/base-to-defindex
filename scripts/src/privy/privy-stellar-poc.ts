import "dotenv/config";
import {
  getOrCreateStellarWallet,
  getStellarBalance,
  buildSignAndBroadcastStellarTx,
} from "../wallets/privy-stellar-wallet.js";

// Send a tiny payment back to the same wallet (self-transfer) as a smoke test
const PAYMENT_AMOUNT_XLM = "0.0000001";
const MINIMUM_XLM_FOR_TX = 2; // XLM needed to cover minimum balance + fees

async function main() {
  console.log("Privy Server Wallet — Stellar Testnet (Tier 2 / raw sign)");
  console.log("──────────────────────────────────────────────────────────────");

  // [1] Create or retrieve the Stellar wallet (idempotent via idempotency_key)
  console.log("\n[1/3] Creating / retrieving Stellar wallet...");
  const wallet = await getOrCreateStellarWallet();
  console.log(`  Wallet ID:   ${wallet.id}`);
  console.log(`  Address:     ${wallet.address}`);
  console.log(`  Chain type:  ${wallet.chain_type}`);
  console.log(`  Explorer:    https://stellar.expert/explorer/testnet/account/${wallet.address}`);

  // [2] Check XLM balance
  console.log("\n[2/3] Fetching XLM balance...");
  const balance = await getStellarBalance(wallet.address);
  console.log(`  Balance: ${balance} XLM`);

  // [3] Build, sign, and broadcast a Stellar payment if funded
  console.log("\n[3/3] Building and signing Stellar transaction...");

  if (parseFloat(balance) < MINIMUM_XLM_FOR_TX) {
    console.log(`  ⚠️  Insufficient XLM — funding via Stellar Friendbot...`);
    const friendbotRes = await fetch(
      `https://friendbot.stellar.org/?addr=${wallet.address}`
    );
    if (!friendbotRes.ok) {
      throw new Error(`Friendbot failed: ${friendbotRes.status} ${await friendbotRes.text()}`);
    }
    const funded = await getStellarBalance(wallet.address);
    console.log(`  Funded! New balance: ${funded} XLM`);
  }

  {
    // Self-transfer: send a minimal amount back to the same wallet
    const txHash = await buildSignAndBroadcastStellarTx(
      wallet.id,
      wallet.address,
      wallet.address,
      PAYMENT_AMOUNT_XLM
    );
    console.log(`  ✅ Transaction submitted!`);
    console.log(`  Hash:     ${txHash}`);
    console.log(`  Explorer: https://stellar.expert/explorer/testnet/tx/${txHash}`);
  }

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("POC complete. Wallet visible in Privy Dashboard → Wallets.");
}

main().catch((err) => {
  console.error("Error:", err?.message ?? err);
  process.exit(1);
});
