import { 
  Sodax, 
  type SolverIntentStatusRequest, 
  type SolverIntentStatusResponse, 
  type Result, 
  type SolverErrorResponse, 
  IntentsAbi, 
  SolverIntentStatusCode 
} from "@sodax/sdk";
import { ethers } from "ethers";
import { config } from "../shared/config.js";
import { 
  initializeSodax, 
  getStatusLabel, 
  formatJson, 
  sleep, 
  decodePayload 
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
      console.log(formatJson(decodePayload(extraData.payload)));
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
            console.log("📦 Decoded Intent (from Blockchain Data):");
            console.log(formatJson(decodePayload(parsed.args.data)));
        }
    } catch (e) {
        console.warn("  Could not decode intent from blockchain data.");
    }
  }
}

async function pollStatus(sodax: Sodax, txHash: string) {
  console.log("\n[3] Polling final solver status...");
  let completed = false;
  let attempts = 0;
  const maxAttempts = 120; 
  
  while (!completed && attempts < maxAttempts) {
    attempts++;
    const now = new Date().toLocaleTimeString();
    const statusResult = await sodax.swaps.getStatus({ intent_tx_hash: txHash as `0x${string}` });

    if (statusResult.ok) {
      const status = statusResult.value.status;
      const label = getStatusLabel(status);
      process.stdout.write(`  [${now}] Attempt ${attempts}/${maxAttempts} — Status: ${label}\r`);
      
      if (status === SolverIntentStatusCode.SOLVED) {
        console.log("\n\n✅ SUCCESS: The Solver has delivered the funds on Stellar!");
        console.log("Status Data:", formatJson(statusResult.value));
        
        if (statusResult.value.fill_tx_hash) {
          console.log(`\n🔍 Hub Chain Fill Tx: ${statusResult.value.fill_tx_hash}`);
          try {
            const filledIntent = await sodax.swaps.getFilledIntent(statusResult.value.fill_tx_hash as `0x${string}`);
            console.log("📝 Filled Intent State:");
            console.log(formatJson(filledIntent));
            
            const deliveryPacket = await sodax.swaps.getSolvedIntentPacket({
              chainId: config.sodax.baseChainId,
              fillTxHash: statusResult.value.fill_tx_hash as `0x${string}`
            });
            console.log("🚚 Delivery Packet Info:");
            console.log(formatJson(deliveryPacket));
          } catch (e) {
            console.warn("  (Could not fetch detailed fill/delivery info yet)");
          }
        }
        completed = true;
      } else if (status === SolverIntentStatusCode.FAILED) {
        console.log(`\n\n❌ FAILURE: The solver reported a failure: ${status}`);
        console.log("Full Details:", formatJson(statusResult.value));
        completed = true;
      }
    } else {
      process.stdout.write(`  [${now}] Attempt ${attempts}/${maxAttempts} — Status: ⚠️ PENDING/ERROR\r`);
    }
    
    if (!completed) await sleep(10000);
  }

  if (!completed) console.log("\n\n⚠️ Polling timed out. The transaction might still be in progress.");
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
    await pollStatus(sodax, txHash);

  } catch (error) {
    console.error("\nFATAL ERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
