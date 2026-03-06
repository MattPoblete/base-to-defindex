import { 
  Sodax, 
  EvmSpokeProvider, 
  type CreateBridgeIntentParams,
  type Result,
  type BridgeError,
  type BridgeErrorCode,
  BASE_MAINNET_CHAIN_ID, 
  STELLAR_MAINNET_CHAIN_ID,
  SolverIntentStatusCode
} from "@sodax/sdk";
import { EvmWalletProvider } from "@sodax/wallet-sdk-core";
import { config } from "../shared/config.js";
import { ethers } from "ethers";
import { 
  initializeSodax, 
  setupEvmProvider, 
  getStatusLabel, 
  formatError, 
  sleep,
  handleAllowance
} from "../shared/sodax.js";

// ── Core Functions ──────────────────────────────────────────────────────────

async function performBridge(
  sodax: Sodax, 
  bridgeParams: CreateBridgeIntentParams, 
  evmSpokeProvider: EvmSpokeProvider
): Promise<string> {
  console.log("\n[4] Executing Bridge (Spoke -> Hub)...");
  
  const bridgeResult: Result<[string, string], BridgeError<BridgeErrorCode>> = 
    await sodax.bridge.bridge({
      params: bridgeParams,
      spokeProvider: evmSpokeProvider as any,
    });

  if (!bridgeResult.ok) {
    console.error("\n❌ BRIDGE ERROR:", formatError(bridgeResult.error));
    throw new Error(`Bridge execution failed: ${bridgeResult.error.code}`);
  }
  
  const [spokeTxHash, hubTxHash] = bridgeResult.value;
  
  console.log(`\n✅ Bridge Steps Initiated!`);
  console.log(`   Source Tx Hash (Base): ${spokeTxHash}`);
  console.log(`   Hub Tx Hash (Sonic):   ${hubTxHash}`);
  
  return spokeTxHash;
}

async function pollStatus(sodax: Sodax, txHash: string): Promise<void> {
  console.log("\n[5] Polling final status...");
  
  let completed = false;
  let attempts = 0;
  const maxAttempts = 60;
  
  while (!completed && attempts < maxAttempts) {
    attempts++;
    const now = new Date().toLocaleTimeString();
    const statusResult = await sodax.swaps.getStatus({
      intent_tx_hash: txHash as `0x${string}`,
    });
    
    if (statusResult.ok) {
      const status = statusResult.value.status;
      const label = getStatusLabel(status);
      console.log(`  [${now}] Attempt ${attempts}/${maxAttempts} — Status: ${label}`);
      
      if (status === SolverIntentStatusCode.SOLVED) {
        console.log("\n🎉 SUCCESS: The bridge is complete and funds delivered on Stellar!");
        completed = true;
      } else if (status === SolverIntentStatusCode.FAILED) {
        console.log(`\n❌ FAILURE: The bridge reported a failure.`);
        completed = true;
      }
    } else {
      console.log(`  [${now}] Attempt ${attempts}/${maxAttempts} — Status: ⚠️ PENDING/ERROR`);
    }
    
    if (!completed) {
      await sleep(10000); 
    }
  }

  if (!completed) {
    console.log("\n⚠️ Polling timed out. Check status later with sodax-status.");
  }
}

// ── Main Execution ──────────────────────────────────────────────────────────

async function main() {
  const stellarRecipient = process.argv[2];
  if (!stellarRecipient) {
    console.error("Usage: npx tsx src/bridge/sodax-bridge-pure.ts <STELLAR_ADDRESS>");
    process.exit(1);
  }

  const AMOUNT_ATOMIC = BigInt(Number(config.bridge.amount) * 10 ** config.sodax.usdcDecimals);

  console.log("Sodax Pure Bridge — Base USDC → Stellar USDC");
  console.log("──────────────────────────────────────────────────────");

  try {
    const sodax = await initializeSodax();
    const { provider: evmSpoke, wallet: evmWallet } = setupEvmProvider(sodax);
    const evmAddress = await evmWallet.getWalletAddress();
    
    console.log(`  EVM Address: ${evmAddress}`);
    console.log(`  Stellar Recipient: ${stellarRecipient}`);

    const bridgeParams: CreateBridgeIntentParams = {
      srcChainId: BASE_MAINNET_CHAIN_ID,
      srcAsset: config.sodax.baseUsdc,
      amount: AMOUNT_ATOMIC,
      dstChainId: STELLAR_MAINNET_CHAIN_ID,
      dstAsset: config.sodax.stellarUsdc,
      recipient: stellarRecipient,
    };

    await handleAllowance(sodax.bridge, bridgeParams, evmSpoke, evmWallet);
    const txHash = await performBridge(sodax, bridgeParams, evmSpoke);
    await pollStatus(sodax, txHash);

  } catch (error) {
    console.error("\nFATAL ERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
