import { CrossmintWallets, createCrossmint } from "@crossmint/wallets-sdk";
import { Keypair } from "@stellar/stellar-base";
import { config } from "../shared/config.js";

/**
 * Example script to:
 * 1. Initialize Crossmint Wallets SDK
 * 2. Create/Retrieve a Smart Wallet for a user on Stellar
 * 3. Fetch Stellar balances
 */

async function main() {
  console.log("Crossmint Smart Wallet — Stellar Management");
  console.log("──────────────────────────────────────────────────────");

  // [1] Initialize SDK
  const crossmint = createCrossmint({ apiKey: config.clientApiKey || config.apiKey });
  const sdk = CrossmintWallets.from(crossmint);

  const stellarKeypair = Keypair.fromSecret(config.stellarServerKey);

  // [2] Get or Create Wallet on Stellar
  console.log(`\n[1/2] Getting Stellar wallet for: ${config.walletEmail}`);
  const wallet = await sdk.getOrCreateWallet({
    chain: "stellar",
    owner: `email:${config.walletEmail}`,
    signer: {
      type: "external-wallet",
      address: stellarKeypair.publicKey(),
      onSignStellarTransaction: async (xdr: string) => xdr, // read-only script
    },
  });

  const address = wallet.address;
  console.log(`  Wallet Address: ${address}`);
  console.log(`  Chain:          ${config.stellarChain}`);

  // [3] Fetch Balances
  console.log("\n[2/2] Fetching balances...");
  const balances = await wallet.balances();
  
  if (balances.tokens.length === 0) {
    console.log("  No balances found. Make sure the wallet is funded and has trustlines if needed.");
  } else {
    balances.tokens.forEach((b: any) => {
      console.log(`  - ${b.amount} ${b.symbol} (${b.tokenAddress || "Native"})`);
    });
  }
  
  console.log("\n──────────────────────────────────────────────────────");
  console.log("Stellar Explorer:");
  console.log(`  https://stellar.expert/explorer/${config.isStaging ? "testnet" : "public"}/account/${address}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
