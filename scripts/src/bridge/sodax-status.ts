import { 
  Sodax, 
  IntentsAbi, 
  STELLAR_MAINNET_CHAIN_ID,
  SolverIntentStatusCode,
  sleep
} from "@sodax/sdk";
import { ethers } from "ethers";
import { config } from "../shared/config.js";
import { 
  formatJson, 
  pollSodaxStatus,
} from "../shared/sodax.js";

// ── Core Functions ──────────────────────────────────────────────────────────

async function fetchBlockchainTx(txHash: string) {
  try {
    const provider = new ethers.JsonRpcProvider(config.baseRpcUrl);
    const tx = await provider.getTransaction(txHash);
    if (!tx) return null;

    console.log("🔗 Blockchain Tx Data:");
    console.log(`   From:  ${tx.from}`);
    console.log(`   To:    ${tx.to}`);
    console.log(`   Value: ${ethers.formatEther(tx.value)} ETH`);
    
    if (tx.data.startsWith("0xc6b4180b")) {
        console.log("   Method: deposit(address,address,uint256,bytes)");
    }
    return tx;
  } catch (e) {
    console.warn("  ⚠️ Could not fetch data from blockchain RPC.");
    return null;
  }
}

async function fetchIntentDetails(sodax: Sodax, txHash: string, blockchainData: any) {
  console.log("\n[2] Fetching intent details...");
  
  // Try getIntentByTxHash (Source chain Tx)
  try {
    const intentResponse = await (sodax.swaps as any).getIntentByTxHash(txHash);
    if (intentResponse) {
      console.log("📦 Intent Details (from API):");
      console.log(formatJson(intentResponse));
      return;
    }
  } catch (e) {}

  try {
    const extraData = await sodax.swaps.getIntentSubmitTxExtraData({ txHash: txHash as `0x${string}` });
    if (extraData && extraData.payload) {
      console.log("📦 Decoded Intent (from Sodax API):");
      console.log(`\nRelayer Address: ${extraData.address}`);
      return;
    }
  } catch (e) {
    console.warn("  Sodax API has not indexed this intent yet. Checking blockchain data...");
  }

  if (blockchainData && blockchainData.data) {
    try {
        const iface = new ethers.Interface(IntentsAbi);
        const parsed = iface.parseTransaction({ data: blockchainData.data });
        if (parsed && parsed.name === "deposit" && parsed.args.data) {
        }
    } catch (e) {
        console.warn("  Could not decode intent from blockchain data.");
    }
  }
}

// ── Main Execution ──────────────────────────────────────────────────────────

async function main() {
  const txHash = process.argv[2];
  if (!txHash) {
    console.error("Usage: npx tsx src/bridge/sodax-status.ts <SOURCE_TX_HASH>");
    process.exit(1);
  }

  console.log(`Sodax Status Checker — Checking Tx: ${txHash}`);
  console.log("──────────────────────────────────────────────────────");

  try {
    const sodax = new Sodax();
    const initResult = await sodax.initialize();
    if (!initResult.ok) throw new Error(`Initialization failed: ${formatJson(initResult.error)}`);

    const blockchainData = await fetchBlockchainTx(txHash);
    await fetchIntentDetails(sodax, txHash, blockchainData);
    await pollSodaxStatus(sodax, txHash);

  } catch (error) {
    console.error("\nFATAL ERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
