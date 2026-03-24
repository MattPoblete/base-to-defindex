import "dotenv/config";
import {
  getOrCreateStellarWallet,
  getStellarBalance,
} from "../wallets/privy-stellar-wallet.js";
import { depositToDefindexVault } from "../wallets/privy-defindex-wallet.js";
import { config } from "../shared/config.js";

const VAULT_ADDRESS = "CCLV4H7WTLJQ7ATLHBBQV2WW3OINF3FOY5XZ7VPHZO7NH3D2ZS4GFSF6";
const DEPOSIT_AMOUNT_STROOPS = 10_0_000_000n; // 10 XLM (7 decimals)
const MINIMUM_XLM_BALANCE = 15; // 10 XLM deposit + 5 XLM reserve for fees/min balance

async function main() {
  console.log("Privy Server Wallet — Defindex XLM Vault Deposit (Testnet)");
  console.log("──────────────────────────────────────────────────────────────");

  // [1] Create or retrieve the Stellar wallet (idempotent via idempotency_key)
  console.log("\n[1/4] Creating / retrieving Stellar wallet...");
  const wallet = await getOrCreateStellarWallet();
  console.log(`  Wallet ID:   ${wallet.id}`);
  console.log(`  Address:     ${wallet.address}`);
  console.log(`  Explorer:    https://stellar.expert/explorer/testnet/account/${wallet.address}`);

  // [2] Check XLM balance — auto-fund via Friendbot if needed
  console.log("\n[2/4] Fetching XLM balance...");
  let balance = await getStellarBalance(wallet.address);
  console.log(`  Balance: ${balance} XLM`);

  if (parseFloat(balance) < MINIMUM_XLM_BALANCE) {
    console.log(`  ⚠️  Balance below ${MINIMUM_XLM_BALANCE} XLM — funding via Stellar Friendbot...`);
    const friendbotRes = await fetch(
      `https://friendbot.stellar.org/?addr=${wallet.address}`
    );
    if (!friendbotRes.ok) {
      throw new Error(
        `Friendbot failed: ${friendbotRes.status} ${await friendbotRes.text()}`
      );
    }
    balance = await getStellarBalance(wallet.address);
    console.log(`  Funded! New balance: ${balance} XLM`);
  }

  // [3] Deposit to Defindex vault
  console.log(`\n[3/4] Depositing ${Number(DEPOSIT_AMOUNT_STROOPS) / 10_000_000} XLM to Defindex vault...`);
  console.log(`  Vault:  ${VAULT_ADDRESS}`);

  const txHash = await depositToDefindexVault(
    wallet.id,
    wallet.address,
    VAULT_ADDRESS,
    DEPOSIT_AMOUNT_STROOPS,
    config.defindexApiKey
  );

  // [4] Confirm
  console.log(`\n[4/4] Deposit confirmed!`);
  console.log(`  Transaction hash: ${txHash}`);
  console.log(`  Explorer: https://stellar.expert/explorer/testnet/tx/${txHash}`);

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("POC complete. Check Privy Dashboard → Wallets and Defindex vault balance.");
}

main().catch((err) => {
  console.error("Error:", err?.message ?? err);
  process.exit(1);
});
