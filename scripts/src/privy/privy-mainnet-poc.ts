import "dotenv/config";
import { ethers } from "ethers";
import { config, SOROSWAP_EARN_USDC_VAULT } from "../shared/config.js";
import { getOrCreateEvmWallet } from "../wallets/privy-base-wallet.js";
import {
  getOrCreateStellarWallet,
  ensureXlmFunding,
  ensureUsdcTrustline,
} from "../wallets/privy-stellar-wallet.js";
import { depositToDefindexVault } from "../wallets/privy-defindex-wallet.js";
import { PrivyEvmSodaxAdapter } from "../shared/privy-evm-sodax-adapter.js";
import { initializeSodax } from "../shared/sodax.js";
import { SodaxBridgeService } from "../shared/sodax-service.js";
import { SwapParams, BridgeToken } from "../shared/bridge-types.js";

const BASE_CAIP2 = "eip155:8453";
const BRIDGE_AMOUNT_USDC = config.bridge.amount;
const MIN_ETH = ethers.parseEther("0.0005");
const MIN_XLM = 3;

const STELLAR_HORIZON_MAINNET = "https://horizon.stellar.org";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// ── Types ────────────────────────────────────────────────────────────────────

interface EvmWalletInfo {
  id: string;
  address: string;
  ethBalance: bigint;
  usdcBalance: bigint;
  amountIn: bigint;
}

interface StellarWalletInfo {
  id: string;
  address: string;
}

interface BridgeResult {
  srcTxHash: string;
  destTxHash: string;
  amountReceived: bigint;
}

// ── Horizon USDC balance ─────────────────────────────────────────────────────

/**
 * Fetches the USDC balance for a Stellar address via Horizon mainnet.
 * Returns the balance in stroops (7 decimals).
 */
async function getHorizonUsdcBalance(stellarAddress: string): Promise<bigint> {
  const response = await fetch(`${STELLAR_HORIZON_MAINNET}/accounts/${stellarAddress}`);
  if (response.status === 404) return 0n;
  if (!response.ok) throw new Error(`Horizon error: ${response.status}`);

  const data = (await response.json()) as {
    balances: Array<{ asset_code?: string; asset_issuer?: string; balance: string }>;
  };

  const usdcEntry = data.balances.find(
    (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
  );

  if (!usdcEntry) return 0n;
  return BigInt(Math.round(parseFloat(usdcEntry.balance) * 10_000_000));
}

/**
 * Polls via Horizon until the USDC balance reaches minimumStroops.
 * Sodax marks SOLVED on the Hub (Sonic) before the Stellar tx confirms,
 * so we must poll before depositing into Defindex.
 */
async function waitForUsdcBalance(
  stellarAddress: string,
  minimumStroops: bigint,
  maxAttempts = 36,
  intervalMs = 10_000
): Promise<void> {
  const minFloat = Number(minimumStroops) / 10_000_000;
  console.log(`  Waiting for ≥ ${minFloat} USDC via Horizon...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const balanceStroops = await getHorizonUsdcBalance(stellarAddress);
    const balanceFloat = Number(balanceStroops) / 10_000_000;
    console.log(`  Attempt ${attempt}/${maxAttempts} — USDC balance: ${balanceFloat}`);
    if (balanceStroops >= minimumStroops) return;
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`USDC did not arrive after ${(maxAttempts * intervalMs) / 1000}s`);
}

// ── Step 1: EVM wallet ───────────────────────────────────────────────────────

async function setupEvmWallet(
  provider: ethers.JsonRpcProvider
): Promise<EvmWalletInfo> {
  console.log("\n[1/5] Creating / retrieving Base (EVM) wallet...");
  const evmWallet = await getOrCreateEvmWallet();
  console.log(`  Address:  ${evmWallet.address}`);
  console.log(`  Explorer: https://basescan.org/address/${evmWallet.address}`);

  const usdcAbi = ["function balanceOf(address) view returns (uint256)"];
  const usdcContract = new ethers.Contract(config.sodax.baseUsdc, usdcAbi, provider);
  const [ethBalance, usdcBalance] = await Promise.all([
    provider.getBalance(evmWallet.address),
    usdcContract.balanceOf(evmWallet.address),
  ]);

  const amountIn = BigInt(
    Math.round(Number(BRIDGE_AMOUNT_USDC) * 10 ** config.sodax.usdcDecimals)
  );

  logEvmBalances(ethBalance, usdcBalance, amountIn);

  return { id: evmWallet.id, address: evmWallet.address, ethBalance, usdcBalance, amountIn };
}

function logEvmBalances(
  ethBalance: bigint,
  usdcBalance: bigint,
  amountIn: bigint
): void {
  const ethFormatted = ethers.formatEther(ethBalance);
  const usdcFormatted = ethers.formatUnits(usdcBalance, config.sodax.usdcDecimals);

  console.log(`\n  ┌─ Base Wallet Balances ──────────────────────────────`);
  console.log(`  │  ETH:  ${ethFormatted} ETH  (raw: ${ethBalance} wei)`);
  console.log(`  │  USDC: ${usdcFormatted} USDC  (raw: ${usdcBalance} units)`);
  console.log(`  │`);
  console.log(`  │  Bridge requires:  ${BRIDGE_AMOUNT_USDC} USDC  (raw: ${amountIn})`);
  console.log(`  │  ETH min:          0.0005 ETH  (raw: ${MIN_ETH} wei)`);
  console.log(`  │  ETH sufficient:   ${ethBalance >= MIN_ETH ? "✅" : "❌"} (${ethFormatted} ≥ 0.0005)`);
  console.log(`  │  USDC sufficient:  ${usdcBalance >= amountIn ? "✅" : "❌"} (${usdcFormatted} ≥ ${BRIDGE_AMOUNT_USDC})`);
  console.log(`  └─────────────────────────────────────────────────────`);
}

function assertEvmFunding(wallet: EvmWalletInfo): void {
  if (wallet.ethBalance >= MIN_ETH && wallet.usdcBalance >= wallet.amountIn) return;

  const ethFormatted = ethers.formatEther(wallet.ethBalance);
  const usdcFormatted = ethers.formatUnits(wallet.usdcBalance, config.sodax.usdcDecimals);

  console.log(`\n  ⚠️  Wallet needs funding before the bridge can run.`);
  console.log(`  ─────────────────────────────────────────────────────`);
  console.log(`  Send to: ${wallet.address}`);
  if (wallet.ethBalance < MIN_ETH)
    console.log(`    • ETH:  need ≥ 0.0005  (have ${ethFormatted})`);
  if (wallet.usdcBalance < wallet.amountIn)
    console.log(`    • USDC: need ≥ ${BRIDGE_AMOUNT_USDC}  (have ${usdcFormatted})`);
  console.log(`  ─────────────────────────────────────────────────────`);
  process.exit(0);
}

// ── Step 2: Stellar wallet ───────────────────────────────────────────────────

async function setupStellarWallet(): Promise<StellarWalletInfo> {
  console.log("\n[2/5] Creating / retrieving Stellar wallet...");
  const stellarWallet = await getOrCreateStellarWallet();
  console.log(`  Address:  ${stellarWallet.address}`);
  console.log(`  Explorer: https://stellar.expert/explorer/public/account/${stellarWallet.address}`);

  console.log(`\n  Checking XLM balance (min ${MIN_XLM} XLM)...`);
  await ensureXlmFunding(stellarWallet.address, MIN_XLM);

  console.log(`\n  Checking USDC trustline...`);
  await ensureUsdcTrustline(stellarWallet.id, stellarWallet.address);

  return { id: stellarWallet.id, address: stellarWallet.address };
}

// ── Step 3: Bridge ───────────────────────────────────────────────────────────

function buildSwapParams(evmWallet: EvmWalletInfo, stellarAddress: string): SwapParams {
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

  return {
    srcToken,
    dstToken,
    amountIn: evmWallet.amountIn,
    dstAddress: stellarAddress,
    slippageBps: 100, // 1%
  };
}

async function executeBridge(
  evmWallet: EvmWalletInfo,
  stellarAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<BridgeResult> {
  console.log(`\n[3/5] Bridging ${BRIDGE_AMOUNT_USDC} USDC from Base to Stellar...`);

  const privyAdapter = new PrivyEvmSodaxAdapter(
    evmWallet.id,
    evmWallet.address,
    BASE_CAIP2,
    provider
  );

  const sodax = await initializeSodax();
  const bridgeService = new SodaxBridgeService(sodax);
  const swapParams = buildSwapParams(evmWallet, stellarAddress);

  console.log(`  Fetching quote...`);
  const quote = await bridgeService.getQuote(swapParams);
  const amountOutFormatted = ethers.formatUnits(quote.amountOut, swapParams.dstToken.decimals);
  console.log(`  Quoted: ${amountOutFormatted} USDC on Stellar`);

  console.log(`  Executing swap...`);
  const swapResult = await bridgeService.executeSwap(privyAdapter, swapParams, quote);
  console.log(`  ✅ Swap initiated! Base Tx: ${swapResult.srcTxHash}`);
  console.log(`     Basescan: https://basescan.org/tx/${swapResult.srcTxHash}`);

  console.log(`  Waiting for Stellar fulfillment...`);
  const { destTxHash, amountReceived } = await bridgeService.pollStatus(swapResult.statusHash);
  console.log(`  ✅ Bridge complete!`);
  console.log(`     Stellar Tx: ${destTxHash}`);
  console.log(`     Explorer: https://stellar.expert/explorer/public/tx/${destTxHash}`);

  await waitForUsdcBalance(stellarAddress, amountReceived);

  return { srcTxHash: swapResult.srcTxHash, destTxHash, amountReceived };
}

// ── Step 4: Defindex deposit ─────────────────────────────────────────────────

async function depositToVault(
  stellarWallet: StellarWalletInfo,
  amountReceived: bigint
): Promise<string> {
  const amountFormatted = ethers.formatUnits(amountReceived, config.sodax.stellarDecimals);
  console.log(`\n[4/5] Depositing ${amountFormatted} USDC into Defindex vault...`);
  console.log(`  Vault: ${SOROSWAP_EARN_USDC_VAULT}`);

  return depositToDefindexVault(
    stellarWallet.id,
    stellarWallet.address,
    SOROSWAP_EARN_USDC_VAULT,
    amountReceived,
    config.defindexApiKey,
    "mainnet"
  );
}

// ── Step 5: Summary ──────────────────────────────────────────────────────────

function logSummary(
  evmAddress: string,
  stellarAddress: string,
  bridgeResult: BridgeResult,
  depositTxHash: string
): void {
  console.log(`\n[5/5] Done!`);
  console.log(`  ✅ Defindex deposit: ${depositTxHash}`);
  console.log(`     Explorer: https://stellar.expert/explorer/public/tx/${depositTxHash}`);

  console.log("\n──────────────────────────────────────────────────────────────────────");
  console.log("🎉 FULL MAINNET FLOW COMPLETE");
  console.log(`   Base wallet:    ${evmAddress}`);
  console.log(`   Stellar wallet: ${stellarAddress}`);
  console.log(`   Bridge tx:      ${bridgeResult.srcTxHash}`);
  console.log(`   Defindex tx:    ${depositTxHash}`);
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  console.log("Privy Server Wallet — Full Mainnet Flow (Base → Stellar → Defindex)");
  console.log("──────────────────────────────────────────────────────────────────────");

  const provider = new ethers.JsonRpcProvider(config.baseRpcUrl);

  const evmWallet = await setupEvmWallet(provider);
  assertEvmFunding(evmWallet);

  const stellarWallet = await setupStellarWallet();

  const bridgeResult = await executeBridge(evmWallet, stellarWallet.address, provider);

  const depositTxHash = await depositToVault(stellarWallet, bridgeResult.amountReceived);

  logSummary(evmWallet.address, stellarWallet.address, bridgeResult, depositTxHash);
}

main().catch((err) => {
  console.error("\n❌ Error:", err?.message ?? err);
  process.exit(1);
});
