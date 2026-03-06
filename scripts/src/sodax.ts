import { 
  Sodax, 
  EvmSpokeProvider, 
  BASE_MAINNET_CHAIN_ID,
  IntentsAbi
} from "@sodax/sdk";
import { EvmWalletProvider } from "@sodax/wallet-sdk-core";
import { config } from "./config.js";
import { ethers } from "ethers";

// ── Types & Utils ───────────────────────────────────────────────────────────

export const bigintReplacer = (_key: string, value: any) => typeof value === 'bigint' ? value.toString() : value;

export const formatError = (error: any) => JSON.stringify(error, bigintReplacer, 2);

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

export function decodePayload(payload: string) {
  try {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    let dataToDecode = payload;
    if (payload.length % 64 !== 2) { 
      dataToDecode = "0x" + payload.slice(10); 
    }

    const intentTypes = [
      "uint256", "address", "address", "address", "uint256", "uint256", 
      "uint256", "bool", "uint256", "uint256", "bytes", "bytes", "address", "bytes"
    ];

    const decoded = abiCoder.decode(intentTypes, dataToDecode);
    
    return {
      intentId: decoded[0].toString(),
      creator: decoded[1],
      inputToken: decoded[2],
      outputToken: decoded[3],
      inputAmount: decoded[4].toString(),
      minOutputAmount: decoded[5].toString(),
      deadline: new Date(Number(decoded[6]) * 1000).toLocaleString(),
      allowPartialFill: decoded[7],
      srcChain: decoded[8].toString(),
      dstChain: decoded[9].toString(),
      srcAddress: decoded[10],
      dstAddress: decoded[11],
      solver: decoded[12],
      data: decoded[13]
    };
  } catch (e) {
    try {
        const iface = new ethers.Interface(IntentsAbi);
        const decoded = iface.parseTransaction({ data: payload });
        if (decoded) return { function: decoded.name, args: decoded.args };
    } catch (e2) {}
    return { error: "Failed to decode payload", raw: payload.slice(0, 100) + "..." };
  }
}
