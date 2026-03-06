import { 
  Sodax, 
  EvmSpokeProvider, 
  type SolverIntentQuoteRequest,
  type SolverIntentQuoteResponse,
  type CreateIntentParams,
  type SolverIntentStatusRequest,
  type SolverIntentStatusResponse,
  type Result,
  type SolverErrorResponse,
  type IntentError,
  type Intent,
  type SolverExecutionResponse,
  type IntentDeliveryInfo,
  type IntentErrorCode,
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
  bigintReplacer,
  handleAllowance
} from "../shared/sodax.js";

// ── Core Functions ──────────────────────────────────────────────────────────

async function getQuote(sodax: Sodax, amountAtomic: bigint): Promise<SolverIntentQuoteResponse> {
  console.log("\n[3] Getting quote from Sodax Solver...");
  const request: SolverIntentQuoteRequest = {
    token_src: config.sodax.baseUsdc,
    token_src_blockchain_id: BASE_MAINNET_CHAIN_ID,
    token_dst: config.sodax.stellarUsdc,
    token_dst_blockchain_id: STELLAR_MAINNET_CHAIN_ID,
    amount: amountAtomic,
    quote_type: "exact_input",
  };

  console.log("  Quote Request:", JSON.stringify(request, bigintReplacer, 2));
  const result = await sodax.swaps.getQuote(request);
  if (!result.ok) throw new Error(`Quote failed: ${formatError(result.error)}`);
  
  console.log(`  Quoted Amount Out: ${ethers.formatUnits(result.value.quoted_amount, config.sodax.stellarDecimals)} USDC (Stellar)`);
  return result.value;
}

async function performSwap(
  sodax: Sodax, 
  intentParams: CreateIntentParams, 
  evmSpokeProvider: EvmSpokeProvider
): Promise<{ baseTxHash: string, statusHash: string }> {
  console.log("\n[5] Executing swap (Automated Intent + Relay + Post-Execution)...");
  console.log("    (This process orchestrates multiple steps and might take a minute)");
  
  const swapResult: Result<[SolverExecutionResponse, Intent, IntentDeliveryInfo], IntentError<IntentErrorCode>> = 
    await sodax.swaps.swap({
      intentParams,
      spokeProvider: evmSpokeProvider as any,
    });

  if (!swapResult.ok) {
    const { code, data } = swapResult.error;
    console.error(`\n❌ SWAP ERROR [${code}]`);
    
    switch (code) {
      case "CREATION_FAILED":
        console.error("   Reason: Failed to create the intent transaction on Base.");
        break;
      case "SUBMIT_TX_FAILED":
        console.error("   Reason: Transaction was sent but failed to be submitted to Relayer.");
        if (data && (data as any).tx_hash) console.error(`   Base Tx Hash: ${(data as any).tx_hash}`);
        break;
      case "WAIT_UNTIL_INTENT_EXECUTED_FAILED":
        console.error("   Reason: Relayer timed out waiting for hub execution.");
        break;
      case "POST_EXECUTION_FAILED":
        console.error("   Reason: Final status update to Solver API failed.");
        break;
      default:
        console.error("   An unexpected error occurred.");
    }

    console.error("\nDebug Data:", formatError(data));
    throw new Error(`Swap flow failed at stage: ${code}`);
  }
  
  const [solverResponse, _intent, deliveryInfo] = swapResult.value;
  
  console.log(`\n✅ Swap Execution Step Finished!`);
  console.log(`   Base Tx Hash:    ${(deliveryInfo as any).tx_hash}`);
  console.log(`   Dest Intent Hash: ${solverResponse.intent_hash || 'N/A'}`);
  
  return {
    baseTxHash: (deliveryInfo as any).tx_hash as string,
    statusHash: (solverResponse.intent_hash || (deliveryInfo as any).tx_hash) as string
  };
}

async function pollStatus(sodax: Sodax, txHash: string): Promise<void> {
  console.log("\n[6] Polling final solver status...");
  
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
        console.log("\n\n🎉 SUCCESS: The Solver has delivered the funds on Stellar!");
        completed = true;
      } else if (status === SolverIntentStatusCode.FAILED) {
        console.log(`\n❌ FAILURE: The solver reported a failure.`);
        console.log("   Details:", formatError(statusResult.value));
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
    console.log("\n⚠️ Polling timed out. Use sodax-status script to check later.");
  }
}

// ── Main Execution ──────────────────────────────────────────────────────────

async function main() {
  const stellarRecipient = process.argv[2];
  if (!stellarRecipient) {
    console.error("Usage: npx tsx src/bridge/sodax-bridge.ts <STELLAR_ADDRESS>");
    process.exit(1);
  }

  const AMOUNT_ATOMIC = BigInt(Number(config.bridge.amount) * 10 ** config.sodax.usdcDecimals);

  console.log("Sodax Solver Bridge — Base USDC → Stellar USDC");
  console.log("──────────────────────────────────────────────────────");

  try {
    const sodax = await initializeSodax();
    const { provider: evmSpoke, wallet: evmWallet } = setupEvmProvider(sodax);
    const evmAddress = await evmWallet.getWalletAddress();
    
    console.log(`  EVM Address: ${evmAddress}`);
    console.log(`  Stellar Recipient: ${stellarRecipient}`);

    const quote = await getQuote(sodax, AMOUNT_ATOMIC);

    const intentParams: CreateIntentParams = {
      inputToken: config.sodax.baseUsdc,
      outputToken: config.sodax.stellarUsdc,
      inputAmount: AMOUNT_ATOMIC,
      minOutputAmount: quote.quoted_amount * 99n / 100n, // 1% slippage
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      allowPartialFill: false,
      srcChain: BASE_MAINNET_CHAIN_ID,
      dstChain: STELLAR_MAINNET_CHAIN_ID,
      srcAddress: evmAddress,
      dstAddress: stellarRecipient,
      solver: sodax.swaps.config.intentsContract,
      data: "0x",
    };

    await handleAllowance(sodax.swaps, intentParams, evmSpoke, evmWallet);
    const { statusHash } = await performSwap(sodax, intentParams, evmSpoke);
    await pollStatus(sodax, statusHash);

  } catch (error) {
    console.error("\nFATAL ERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
