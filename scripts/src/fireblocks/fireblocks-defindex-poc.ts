import "dotenv/config";
import { ethers } from "ethers";
import { config, SOROSWAP_EARN_USDC_VAULT } from "../shared/config.js";
import {
  ensureMainnetXlmFunding,
  ensureMainnetUsdcTrustline,
  FIREBLOCKS_STELLAR_MAINNET_ADDRESS,
} from "../wallets/fireblocks-stellar-mainnet.js";
import { depositToDefindexWithFireblocks } from "../shared/fireblocks-defindex-wallet.js";
import { FireblocksRawEvmSodaxAdapter } from "../shared/fireblocks-raw-evm-sodax-adapter.js";
import { getOrCreateEvmVault } from "../wallets/fireblocks-base-wallet.js";
import { initializeSodax } from "../shared/sodax.js";
import { SodaxBridgeService } from "../shared/sodax-service.js";
import { SwapParams, BridgeToken } from "../shared/bridge-types.js";

const BASE_CHAIN_ID = 8453;
const BASE_RPC = config.baseRpcUrl;
const MIN_ETH = ethers.parseEther("0.0005");
const MIN_XLM = 2;

const STELLAR_HORIZON_MAINNET = "https://horizon.stellar.org";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EvmSetup {
  vaultId: string;
  address: string;
  ethBalance: bigint;
  usdcBalance: bigint;
  amountIn: bigint;
}

// ── Horizon helpers ───────────────────────────────────────────────────────────

async function getHorizonUsdcBalance(stellarAddress: string): Promise<bigint> {
  const res = await fetch(`${STELLAR_HORIZON_MAINNET}/accounts/${stellarAddress}`);
  if (res.status === 404) return 0n;
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);

  const data = (await res.json()) as {
    balances: Array<{ asset_code?: string; asset_issuer?: string; balance: string }>;
  };

  const entry = data.balances.find(
    (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
  );
  if (!entry) return 0n;
  return BigInt(Math.round(parseFloat(entry.balance) * 10_000_000));
}

async function waitForUsdcBalance(
  stellarAddress: string,
  minimumStroops: bigint,
  maxAttempts = 36,
  intervalMs = 10_000
): Promise<void> {
  const minFloat = Number(minimumStroops) / 10_000_000;
  console.log(`  Waiting for ≥ ${minFloat} USDC on Stellar (Horizon mainnet)...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const balanceStroops = await getHorizonUsdcBalance(stellarAddress);
    const balanceFloat = Number(balanceStroops) / 10_000_000;
    console.log(`  Attempt ${attempt}/${maxAttempts} — USDC balance: ${balanceFloat}`);
    if (balanceStroops >= minimumStroops) return;
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`USDC did not arrive after ${(maxAttempts * intervalMs) / 1000}s`);
}

// ── Step 1: EVM setup ─────────────────────────────────────────────────────────

async function setupEvm(provider: ethers.JsonRpcProvider): Promise<EvmSetup> {
  console.log("\n[1/5] EVM wallet — Fireblocks MPC vault (Base mainnet via raw signing)...");

  const { vaultId, address } = await getOrCreateEvmVault();
  console.log(`  Vault ID: ${vaultId}`);
  console.log(`  Address:  ${address}`);
  console.log(`  Explorer: https://basescan.org/address/${address}`);

  const usdcAbi = ["function balanceOf(address) view returns (uint256)"];
  const usdcContract = new ethers.Contract(config.sodax.baseUsdc, usdcAbi, provider);
  const [ethBalance, usdcBalance] = await Promise.all([
    provider.getBalance(address),
    usdcContract.balanceOf(address) as Promise<bigint>,
  ]);

  const amountIn = BigInt(
    Math.round(Number(config.bridge.amount) * 10 ** config.sodax.usdcDecimals)
  );

  console.log(`\n  ┌─ Base Wallet Balances ──────────────────────────────`);
  console.log(`  │  ETH:  ${ethers.formatEther(ethBalance)} ETH`);
  console.log(`  │  USDC: ${ethers.formatUnits(usdcBalance, config.sodax.usdcDecimals)} USDC`);
  console.log(`  │  Bridge requires: ${config.bridge.amount} USDC`);
  console.log(`  │  ETH sufficient:  ${ethBalance >= MIN_ETH ? "✅" : "❌"}`);
  console.log(`  │  USDC sufficient: ${usdcBalance >= amountIn ? "✅" : "❌"}`);
  console.log(`  └─────────────────────────────────────────────────────`);

  if (ethBalance < MIN_ETH || usdcBalance < amountIn) {
    console.log(`\n  ⚠️  Wallet needs funding before the bridge can run.`);
    console.log(`  Send to: ${address}`);
    if (ethBalance < MIN_ETH) console.log(`    • ETH:  need ≥ 0.0005`);
    if (usdcBalance < amountIn) console.log(`    • USDC: need ≥ ${config.bridge.amount}`);
    process.exit(0);
  }

  return { vaultId, address, ethBalance, usdcBalance, amountIn };
}

// ── Step 2: Stellar setup ─────────────────────────────────────────────────────

async function setupStellar(): Promise<void> {
  console.log("\n[2/5] Fireblocks Stellar wallet — mainnet setup...");
  console.log(`  Address:  ${FIREBLOCKS_STELLAR_MAINNET_ADDRESS}`);
  console.log(`  Explorer: https://stellar.expert/explorer/public/account/${FIREBLOCKS_STELLAR_MAINNET_ADDRESS}`);

  console.log(`\n  Checking XLM balance (min ${MIN_XLM} XLM)...`);
  await ensureMainnetXlmFunding(MIN_XLM);

  console.log(`\n  Checking USDC trustline...`);
  await ensureMainnetUsdcTrustline();
}

// ── Step 3: Bridge ────────────────────────────────────────────────────────────

async function executeBridge(
  evm: EvmSetup,
  provider: ethers.JsonRpcProvider
): Promise<{ srcTxHash: string; statusHash: string; amountReceived: bigint }> {
  console.log(`\n[3/5] Bridging ${config.bridge.amount} USDC from Base to Stellar...`);
  console.log(`  Destination: ${FIREBLOCKS_STELLAR_MAINNET_ADDRESS}`);

  const evmAdapter = new FireblocksRawEvmSodaxAdapter(evm.vaultId, evm.address, provider);

  const sodax = await initializeSodax();
  const bridgeService = new SodaxBridgeService(sodax);

  const swapParams: SwapParams = {
    srcToken: {
      symbol: "USDC",
      address: config.sodax.baseUsdc,
      decimals: config.sodax.usdcDecimals,
      chainId: config.sodax.baseChainId,
    } as BridgeToken,
    dstToken: {
      symbol: "USDC",
      address: config.sodax.stellarUsdc,
      decimals: config.sodax.stellarDecimals,
      chainId: config.sodax.stellarChainId,
    } as BridgeToken,
    amountIn: evm.amountIn,
    dstAddress: FIREBLOCKS_STELLAR_MAINNET_ADDRESS,
    slippageBps: 100,
  };

  console.log(`  Fetching quote...`);
  const quote = await bridgeService.getQuote(swapParams);
  const amountOutStr = ethers.formatUnits(quote.amountOut, swapParams.dstToken.decimals);
  console.log(`  Quoted: ${amountOutStr} USDC on Stellar`);

  console.log(`  Executing swap...`);
  const swapResult = await bridgeService.executeSwap(evmAdapter, swapParams, quote);
  console.log(`  ✅ Swap initiated!`);
  console.log(`     Base Tx:  ${swapResult.srcTxHash}`);
  console.log(`     Basescan: https://basescan.org/tx/${swapResult.srcTxHash}`);

  console.log(`  Waiting for Stellar fulfillment (polling Sodax)...`);
  const { destTxHash, amountReceived } = await bridgeService.pollStatus(swapResult.statusHash);
  console.log(`  ✅ Bridge complete!`);
  console.log(`     Stellar Tx: ${destTxHash}`);
  console.log(`     Explorer:   https://stellar.expert/explorer/public/tx/${destTxHash}`);
  console.log(`     Amount:     ${Number(amountReceived) / 10_000_000} USDC`);

  return {
    srcTxHash: swapResult.srcTxHash as string,
    statusHash: swapResult.statusHash,
    amountReceived,
  };
}

// ── Step 4: Wait for USDC on Stellar ─────────────────────────────────────────

async function waitForUsdc(amountReceived: bigint): Promise<void> {
  console.log(`\n[4/5] Confirming USDC balance on Stellar mainnet...`);
  await waitForUsdcBalance(FIREBLOCKS_STELLAR_MAINNET_ADDRESS, amountReceived);
  console.log(`  ✅ USDC confirmed on ${FIREBLOCKS_STELLAR_MAINNET_ADDRESS}`);
}

// ── Step 5: Defindex deposit ──────────────────────────────────────────────────

async function depositToVault(amountReceived: bigint): Promise<{ txHash: string; strategy: string }> {
  const amountFormatted = Number(amountReceived) / 10_000_000;
  console.log(`\n[5/5] Depositing ${amountFormatted} USDC into Defindex vault...`);
  console.log(`  Vault:  ${SOROSWAP_EARN_USDC_VAULT}`);
  console.log(`  Caller: ${FIREBLOCKS_STELLAR_MAINNET_ADDRESS}`);

  const result = await depositToDefindexWithFireblocks(
    SOROSWAP_EARN_USDC_VAULT,
    amountReceived,
    config.defindexApiKey,
    "mainnet"
  );

  return result;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log("Fireblocks MPC Vault — Full Mainnet Flow (Base → Stellar → Defindex)");
  console.log("──────────────────────────────────────────────────────────────────────");
  console.log("  EVM signer:     Fireblocks MPC vault raw signing (secp256k1, ETH_TEST5 key → Base mainnet)");
  console.log("  Stellar signer: Fireblocks MPC vault raw signing (Ed25519, XLM_TEST key → Stellar mainnet)");
  console.log("  Note: Both chains use the same vault keypairs via TransactionOperation.Raw");

  const provider = new ethers.JsonRpcProvider(BASE_RPC, { chainId: BASE_CHAIN_ID, name: "base" });

  const evm = await setupEvm(provider);
  await setupStellar();
  const bridgeResult = await executeBridge(evm, provider);
  await waitForUsdc(bridgeResult.amountReceived);
  const { txHash: depositTxHash, strategy } = await depositToVault(bridgeResult.amountReceived);

  console.log("\n──────────────────────────────────────────────────────────────────────");
  console.log("🎉 FULL MAINNET FLOW COMPLETE");
  console.log(`   EVM wallet:         ${evm.address}`);
  console.log(`   Stellar wallet:     ${FIREBLOCKS_STELLAR_MAINNET_ADDRESS}`);
  console.log(`   Bridge tx (Base):   ${bridgeResult.srcTxHash}`);
  console.log(`   Defindex deposit:   ${depositTxHash}  (signed via: ${strategy})`);
  console.log(`   Explorer:           https://stellar.expert/explorer/public/tx/${depositTxHash}`);
  console.log(`   Fireblocks console: https://console.fireblocks.io/v2/transactions`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err?.message ?? err);
  process.exit(1);
});
