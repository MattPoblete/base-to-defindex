import { ethers } from "ethers";
import { config } from "../shared/config.js";
import { initializeSodax } from "../shared/sodax.js";
import { SodaxBridgeService } from "../shared/sodax-service.js";
import { CrossmintEvmSodaxAdapter } from "../shared/crossmint-adapters.js";
import { CrossmintRestClient } from "../shared/crossmint-rest.js";
import { SwapParams, BridgeToken } from "../shared/bridge-types.js";

async function main() {
  let stellarRecipient = process.argv[2];

  console.log("Sodax + Crossmint — Modular Bridge (Base → Stellar)");
  console.log("──────────────────────────────────────────────────────");

  // [1] Initialize Crossmint REST client (bypasses Fireblocks SDK requirement)
  const restClient = new CrossmintRestClient(config.apiKey, config.baseUrl);

  // [2] Get Wallets
  console.log(`\n[1/4] Initializing Crossmint wallets...`);

  // EVM Wallet — owned by EVM private key (external-wallet), no email OTP needed
  const { address: evmAddress, locator: walletLocator } =
    await restClient.getOrCreateEvmScriptsWallet();
  console.log(`  Base Address:    ${evmAddress}`);
  console.log(`  Wallet Locator:  ${walletLocator}`);

  // Stellar Wallet (Auto-discovery — email wallet used only as recipient)
  if (!stellarRecipient) {
    console.log(`  Fetching Stellar wallet...`);
    stellarRecipient = await restClient.getStellarWalletAddress();
    console.log(`  Stellar Address: ${stellarRecipient} (Crossmint)`);
  } else {
    console.log(`  Stellar Address: ${stellarRecipient} (Manual)`);
  }

  const provider = new ethers.JsonRpcProvider(config.baseRpcUrl);

  // Check balances and exit early if wallet needs funding
  const usdcAbi = ["function balanceOf(address) view returns (uint256)"];
  const usdcContract = new ethers.Contract(config.sodax.baseUsdc, usdcAbi, provider);
  const [ethBalance, usdcBalance] = await Promise.all([
    provider.getBalance(evmAddress),
    usdcContract.balanceOf(evmAddress),
  ]);
  const usdcFormatted = ethers.formatUnits(usdcBalance, config.sodax.usdcDecimals);
  const ethFormatted = ethers.formatEther(ethBalance);

  console.log(`\n  Balances:`);
  console.log(`    ETH:  ${ethFormatted}`);
  console.log(`    USDC: ${usdcFormatted}`);

  const amountIn = BigInt(Number(config.bridge.amount) * 10 ** config.sodax.usdcDecimals);

  if (usdcBalance < amountIn || ethBalance === 0n) {
    console.log(`\n  ⚠️  Wallet needs funding before the bridge can run.`);
    console.log(`  ──────────────────────────────────────────────`);
    console.log(`  Send to: ${evmAddress}`);
    console.log(`    • USDC: at least ${config.bridge.amount} (have ${usdcFormatted})`);
    console.log(`    • ETH:  some for gas (have ${ethFormatted})`);
    console.log(`  ──────────────────────────────────────────────`);
    process.exit(0);
  }

  const crossmintAdapter = new CrossmintEvmSodaxAdapter(
    restClient,
    evmAddress,
    walletLocator,
    config.chain,   // specific chain for tx body, e.g. "base"
    provider
  );

  // [3] Initialize Sodax Service
  const sodax = await initializeSodax();
  const bridgeService = new SodaxBridgeService(sodax);

  // [4] Prepare Swap Params
  const srcToken: BridgeToken = {
    symbol: "USDC",
    address: config.sodax.baseUsdc,
    decimals: config.sodax.usdcDecimals,
    chainId: config.sodax.baseChainId,
  };

  const dstToken: BridgeToken = {
    symbol: "USDC",
    address: config.sodax.stellarUsdc,
    decimals: config.sodax.stellarDecimals,
    chainId: config.sodax.stellarChainId,
  };

  const swapParams: SwapParams = {
    srcToken,
    dstToken,
    amountIn,
    dstAddress: stellarRecipient,
    slippageBps: 100, // 1%
  };

  try {
    // [5] Get Quote
    console.log(`\n[2/4] Fetching quote for ${config.bridge.amount} USDC...`);
    const quote = await bridgeService.getQuote(swapParams);
    const amountOutFormatted = ethers.formatUnits(quote.amountOut, dstToken.decimals);
    console.log(`  Quoted Amount Out: ${amountOutFormatted} USDC (Stellar)`);

    // [6] Execute Swap
    console.log("\n[3/4] Executing swap (this involves allowance + intent creation)...");
    const result = await bridgeService.executeSwap(crossmintAdapter, swapParams, quote);
    console.log(`\n✅ Swap initiated!`);
    console.log(`   Base Tx Hash: ${result.srcTxHash}`);

    // [7] Poll Status
    console.log("\n[4/4] Monitoring progress until fulfillment on Stellar...");
    const destTxHash = await bridgeService.pollStatus(result.statusHash);

    console.log(`\n🎉 BRIDGE COMPLETE!`);
    console.log(`   Stellar Tx Hash: ${destTxHash}`);
    console.log(`   Explorer: https://stellar.expert/explorer/mainnet/tx/${destTxHash}`);

  } catch (error: any) {
    console.error(`\n❌ Bridge failed: ${error.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
