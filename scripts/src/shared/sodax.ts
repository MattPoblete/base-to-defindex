import { 
  Sodax, 
  EvmSpokeProvider, 
  BASE_MAINNET_CHAIN_ID,
  STELLAR_MAINNET_CHAIN_ID,
  IntentsAbi,
  SolverIntentStatusCode,
  SONIC_MAINNET_CHAIN_ID
} from "@sodax/sdk";
import { EvmWalletProvider } from "@sodax/wallet-sdk-core";
import { config } from "./config.js";
import { ethers } from "ethers";

// ── Types & Utils ───────────────────────────────────────────────────────────

export const bigintReplacer = (_key: string, value: any) => typeof value === 'bigint' ? value.toString() : value;

export const formatError = (error: any): string => {
  if (error instanceof Error) return error.message;
  return JSON.stringify(error, bigintReplacer);
};

export const formatJson = (data: any) => JSON.stringify(data, bigintReplacer, 2);

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const getStatusLabel = (code: number) => {
  switch (code) {
    case -1: return "🔍 NOT_FOUND (API indexing...)";
    case 1:  return "🕒 NOT_STARTED_YET (Pending on Relayer)";
    case 2:  return "⚙️  STARTED_NOT_FINISHED (Processing on Hub/Sonic)";
    case 3:  return "✅ SOLVED (Funds delivered on Stellar)";
    case 4:  return "❌ FAILED (Solver or Hub error)";
    default: return `❓ UNKNOWN_CODE (${code})`;
  }
};

// ── Core Functions ──────────────────────────────────────────────────────────

export async function pollSodaxStatus(sodax: Sodax, txHash: string, maxAttempts = 120): Promise<void> {
  console.log("\n[Status] Polling final solver status...");
  
  let completed = false;
  let attempts = 0;
  
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

        if (statusResult.value.fill_tx_hash) {
          console.log(`\n🔍 Hub Chain (Sonic) Fill Tx: ${statusResult.value.fill_tx_hash}`);
          try {
            const deliveryPacketResult = await sodax.swaps.getSolvedIntentPacket({
              chainId: SONIC_MAINNET_CHAIN_ID,
              fillTxHash: statusResult.value.fill_tx_hash as `0x${string}`
            });

            if (deliveryPacketResult.ok) {
              const stellarTxHash = deliveryPacketResult.value.dst_tx_hash;
              console.log(`🚀 Stellar Transaction Hash: ${stellarTxHash}`);
              console.log(`🔗 Explorer: https://stellar.expert/explorer/mainnet/tx/${stellarTxHash}`);
            } else {
              console.log(deliveryPacketResult)
              console.log("\n⚠️ Intent solved but delivery packet not yet available in Relay API.");
              console.log("Status Data:", formatJson(statusResult.value));
            }
          } catch (e) {
            console.warn("\n  ⚠️ Could not fetch detailed delivery info from Relay API.");
            console.log("Status Data:", formatJson(statusResult.value));
          }
        } else {
          console.log("Status Data:", formatJson(statusResult.value));
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

export async function initializeSodax(): Promise<Sodax> {
  console.log("\n[1] Initializing Sodax SDK...");
  const sodax = new Sodax();
  const result = await sodax.initialize();
  if (!result.ok) throw new Error(`Initialization failed: ${formatError(result.error)}`);
  console.log("  Sodax initialized");
  return sodax;
}

export function setupEvmProvider(sodax: Sodax): { provider: EvmSpokeProvider, wallet: EvmWalletProvider } {
  console.log("\n[2] Setting up EVM wallet provider...");
  if (!config.evmPrivateKey) throw new Error("EVM_PRIVATE_KEY is required");

  const wallet = new EvmWalletProvider({
    privateKey: config.evmPrivateKey.startsWith("0x") ? (config.evmPrivateKey as `0x${string}`) : `0x${config.evmPrivateKey}`,
    chainId: config.sodax.baseChainId as any,
    rpcUrl: config.baseRpcUrl as `http${string}`,
  });

  const provider = new EvmSpokeProvider(
    wallet,
    sodax.config.spokeChainConfig[BASE_MAINNET_CHAIN_ID] as any
  );

  return { provider, wallet };
}

/**
 * Common allowance handler for both Swap and Bridge services
 */
export async function handleAllowance(
  sodaxService: any, // sodax.swaps or sodax.bridge
  intentParams: any, 
  spokeProvider: EvmSpokeProvider,
  walletProvider: EvmWalletProvider
): Promise<void> {
  console.log("\n[Allowance] Checking token allowance...");
  
  const allowanceResult = await sodaxService.isAllowanceValid({
    intentParams, // swaps uses intentParams
    params: intentParams, // bridge uses params
    spokeProvider: spokeProvider as any,
  });

  if (!allowanceResult.ok) throw new Error(`Allowance check failed: ${formatError(allowanceResult.error)}`);

  if (!allowanceResult.value) {
    console.log("  Allowance insufficient. Sending approval...");
    
    const approveResult = await sodaxService.approve({
      intentParams,
      params: intentParams,
      spokeProvider: spokeProvider as any,
    });

    if (!approveResult.ok) throw new Error(`Approval failed: ${formatError(approveResult.error)}`);
    console.log(`  Approval sent! Tx Hash: ${approveResult.value}`);
    
    await walletProvider.waitForTransactionReceipt(approveResult.value as `0x${string}`);
    console.log("  Approval confirmed.");
  } else {
    console.log("  Token allowance is sufficient.");
  }
}
