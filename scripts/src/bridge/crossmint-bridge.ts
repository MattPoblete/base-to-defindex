import { CrossmintAASDK } from "@crossmint/wallets-sdk";
import {
  AllbridgeCoreSdk,
  ChainSymbol,
  Messenger,
  FeePaymentMethod,
  AmountFormat,
  mainnet,
} from "@allbridge/bridge-core-sdk";
import { config } from "../shared/config.js";

/**
 * Advanced Bridge script using Crossmint Smart Wallets
 * but orchestrating the bridge logic via Allbridge SDK.
 * 
 * Modular approach: wallet is handled by Crossmint,
 * bridge data is built by Allbridge.
 */

async function main() {
  const stellarAddress = process.argv[2];
  if (!stellarAddress) {
    console.error("Usage: npx tsx src/bridge/crossmint-bridge.ts <STELLAR_ADDRESS>");
    process.exit(1);
  }

  console.log("Crossmint + Allbridge — Modular Bridge");
  console.log("──────────────────────────────────────────────────────");

  // [1] Initialize Crossmint SDK
  const cm = new CrossmintAASDK({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  // [2] Get Wallet
  const wallet = await cm.getOrCreateWallet(
    { email: config.walletEmail },
    config.chain
  );
  const evmAddress = await wallet.getAddress();
  console.log(`  Wallet Address: ${evmAddress}`);

  // [3] Initialize Allbridge SDK
  const ab = new AllbridgeCoreSdk(
    {
      [ChainSymbol.BAS]: config.baseRpcUrl,
      [ChainSymbol.SRB]: config.sorobanRpcUrl,
    },
    mainnet
  );

  // [4] Find Tokens
  const allTokens = await ab.tokens();
  const sourceToken = allTokens.find(
    (t) => t.chainSymbol === ChainSymbol.BAS && t.symbol === "USDC"
  );
  const destToken = allTokens.find(
    (t) => t.chainSymbol === ChainSymbol.SRB && t.symbol === "USDC"
  );

  if (!sourceToken || !destToken) throw new Error("Tokens not found");

  const amount = "1";
  const messenger = Messenger.ALLBRIDGE;

  // [5] Check and Handle Allowance via Crossmint
  console.log("\n[1/3] Checking allowance...");
  const hasAllowance = await ab.bridge.checkAllowance({
    token: sourceToken,
    owner: evmAddress,
    amount,
    messenger,
    gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
  });

  if (!hasAllowance) {
    console.log("  Approval needed. Sending via Crossmint...");
    const approveData = await ab.bridge.rawTxBuilder.approve({
      token: sourceToken,
      owner: evmAddress,
      messenger,
      gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
    });

    const approveTx = await wallet.sendTransaction({
      to: (approveData as any).to,
      data: (approveData as any).data,
    });
    console.log(`  Approve tx sent: ${approveTx}`);
    // No easy 'wait' in Crossmint SDK for raw txs, usually handled by polling or backend
  } else {
    console.log("  Allowance OK");
  }

  // [6] Get Bridge Fee
  const gasFeeOptions = await ab.getGasFeeOptions(sourceToken, destToken, messenger);
  const feeInt = gasFeeOptions[FeePaymentMethod.WITH_NATIVE_CURRENCY]?.int ?? "0";

  // [7] Execute Bridge via Crossmint
  console.log("\n[2/3] Sending bridge transaction...");
  const bridgeData = await ab.bridge.rawTxBuilder.send({
    amount,
    fromAccountAddress: evmAddress,
    toAccountAddress: stellarAddress,
    sourceToken,
    destinationToken: destToken,
    messenger,
    fee: feeInt,
    feeFormat: AmountFormat.INT,
    gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
  });

  try {
    const bridgeTx = await wallet.sendTransaction({
      to: (bridgeData as any).to,
      data: (bridgeData as any).data,
      value: (bridgeData as any).value ? BigInt((bridgeData as any).value) : undefined,
    });
    console.log(`\n✅ Bridge transaction initiated!`);
    console.log(`   Hash: ${bridgeTx}`);
    console.log(`\n[3/3] Tracking: You can monitor this hash in Allbridge explorer.`);
  } catch (err: any) {
    console.error(`\n❌ Execution failed: ${err.message}`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
