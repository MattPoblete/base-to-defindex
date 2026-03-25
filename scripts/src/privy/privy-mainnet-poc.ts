import "dotenv/config";
import { ethers } from "ethers";
import {
  xdr,
  Networks,
  TransactionBuilder,
  Account,
  Operation,
  StrKey,
} from "@stellar/stellar-base";
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
const BRIDGE_AMOUNT_USDC = config.bridge.amount; // default "0.1"
const MIN_ETH = ethers.parseEther("0.0005");
const MIN_XLM = 3;

const USDC_CONTRACT = config.sodax.stellarUsdc; // CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75

/**
 * Queries the USDC SAC balance for a Stellar address via Soroban RPC
 * by simulating a `balance(address)` call on the USDC contract.
 * Returns the balance in stroops (7 decimals).
 */
async function getSorobanUsdcBalance(stellarAddress: string): Promise<bigint> {
  const pubkeyBytes = StrKey.decodeEd25519PublicKey(stellarAddress);
  const addressScVal = xdr.ScVal.scvAddress(
    xdr.ScAddress.scAddressTypeAccount(
      xdr.AccountId.publicKeyTypeEd25519(pubkeyBytes)
    )
  );

  const contractBytes = StrKey.decodeContract(USDC_CONTRACT);
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: xdr.ScAddress.scAddressTypeContract(contractBytes),
    functionName: Buffer.from("balance"),
    args: [addressScVal],
  });

  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
    auth: [],
  });

  const tx = new TransactionBuilder(new Account(stellarAddress, "0"), {
    fee: "100",
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const res = await fetch(config.sorobanRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: { transaction: tx.toXDR() },
    }),
  });

  const json = (await res.json()) as any;
  if (json.error) throw new Error(`Soroban RPC error: ${JSON.stringify(json.error)}`);

  const resultXdr = json.result?.results?.[0]?.xdr;
  if (!resultXdr) return 0n;

  try {
    const scVal = xdr.ScVal.fromXDR(resultXdr, "base64");
    const i128 = scVal.i128();
    const hi = BigInt(i128.hi().toString());
    const lo = BigInt(i128.lo().toString());
    return (hi << 64n) | lo;
  } catch {
    return 0n;
  }
}

/**
 * Polls via Soroban RPC until the USDC SAC balance reaches minimumStroops.
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
  console.log(`  Waiting for ≥ ${minFloat} USDC via Soroban RPC...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const balanceStroops = await getSorobanUsdcBalance(stellarAddress);
    const balanceFloat = Number(balanceStroops) / 10_000_000;
    console.log(`  Attempt ${attempt}/${maxAttempts} — USDC balance: ${balanceFloat}`);
    if (balanceStroops >= minimumStroops) return;
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `USDC did not arrive after ${(maxAttempts * intervalMs) / 1000}s`
  );
}

async function main() {
  console.log("Privy Server Wallet — Full Mainnet Flow (Base → Stellar → Defindex)");
  console.log("──────────────────────────────────────────────────────────────────────");

  const provider = new ethers.JsonRpcProvider(config.baseRpcUrl);

  // ─────────────────────────────────────────────────────────────────────────
  // [1/5] Base (EVM) wallet — create and check funding
  // ─────────────────────────────────────────────────────────────────────────
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

  const ethFormatted = ethers.formatEther(ethBalance);
  const usdcFormatted = ethers.formatUnits(usdcBalance, config.sodax.usdcDecimals);
  const amountIn = BigInt(
    Math.round(Number(BRIDGE_AMOUNT_USDC) * 10 ** config.sodax.usdcDecimals)
  );

  console.log(`  ETH:  ${ethFormatted}`);
  console.log(`  USDC: ${usdcFormatted}`);

  if (ethBalance < MIN_ETH || usdcBalance < amountIn) {
    console.log(`\n  ⚠️  Wallet needs funding before the bridge can run.`);
    console.log(`  ─────────────────────────────────────────────────────`);
    console.log(`  Send to: ${evmWallet.address}`);
    if (ethBalance < MIN_ETH) {
      console.log(`    • ETH:  need ≥ 0.0005  (have ${ethFormatted})`);
    }
    if (usdcBalance < amountIn) {
      console.log(`    • USDC: need ≥ ${BRIDGE_AMOUNT_USDC}  (have ${usdcFormatted})`);
    }
    console.log(`  ─────────────────────────────────────────────────────`);
    process.exit(0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // [2/5] Stellar wallet — create, fund XLM, ensure USDC trustline
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[2/5] Creating / retrieving Stellar wallet...");
  const stellarWallet = await getOrCreateStellarWallet();
  console.log(`  Address:  ${stellarWallet.address}`);
  console.log(`  Explorer: https://stellar.expert/explorer/public/account/${stellarWallet.address}`);

  console.log(`\n  Checking XLM balance (min ${MIN_XLM} XLM)...`);
  await ensureXlmFunding(stellarWallet.address, MIN_XLM);

  console.log(`\n  Checking USDC trustline...`);
  await ensureUsdcTrustline(stellarWallet.id, stellarWallet.address);

  // ─────────────────────────────────────────────────────────────────────────
  // [3/5] Bridge USDC Base → Stellar via Sodax
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n[3/5] Bridging ${BRIDGE_AMOUNT_USDC} USDC from Base to Stellar...`);

  const privyAdapter = new PrivyEvmSodaxAdapter(
    evmWallet.id,
    evmWallet.address,
    BASE_CAIP2,
    provider
  );

  const sodax = await initializeSodax();
  const bridgeService = new SodaxBridgeService(sodax);

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
    dstAddress: stellarWallet.address,
    slippageBps: 100, // 1%
  };

  console.log(`  Fetching quote...`);
  const quote = await bridgeService.getQuote(swapParams);
  const amountOutFormatted = ethers.formatUnits(quote.amountOut, dstToken.decimals);
  console.log(`  Quoted: ${amountOutFormatted} USDC on Stellar`);

  console.log(`  Executing swap...`);
  const swapResult = await bridgeService.executeSwap(privyAdapter, swapParams, quote);
  console.log(`  ✅ Swap initiated! Base Tx: ${swapResult.srcTxHash}`);
  console.log(`     Basescan: https://basescan.org/tx/${swapResult.srcTxHash}`);

  console.log(`  Waiting for Stellar fulfillment...`);
  const { destTxHash, amountReceived } = await bridgeService.pollStatus(
    swapResult.statusHash
  );
  console.log(`  ✅ Bridge complete!`);
  console.log(`     Stellar Tx: ${destTxHash}`);
  console.log(`     Explorer: https://stellar.expert/explorer/public/tx/${destTxHash}`);

  // Wait for USDC to land in Stellar before depositing.
  // Sodax resolves SOLVED on the Hub (Sonic) before the Stellar tx confirms.
  await waitForUsdcBalance(stellarWallet.address, amountReceived);

  // ─────────────────────────────────────────────────────────────────────────
  // [4/5] Deposit USDC into Defindex vault (mainnet)
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n[4/5] Depositing ${ethers.formatUnits(amountReceived, dstToken.decimals)} USDC into Defindex vault...`);
  console.log(`  Vault: ${SOROSWAP_EARN_USDC_VAULT}`);

  const depositTxHash = await depositToDefindexVault(
    stellarWallet.id,
    stellarWallet.address,
    SOROSWAP_EARN_USDC_VAULT,
    amountReceived,
    config.defindexApiKey,
    "mainnet"
  );

  // ─────────────────────────────────────────────────────────────────────────
  // [5/5] Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n[5/5] Done!`);
  console.log(`  ✅ Defindex deposit: ${depositTxHash}`);
  console.log(`     Explorer: https://stellar.expert/explorer/public/tx/${depositTxHash}`);

  console.log("\n──────────────────────────────────────────────────────────────────────");
  console.log("🎉 FULL MAINNET FLOW COMPLETE");
  console.log(`   Base wallet:    ${evmWallet.address}`);
  console.log(`   Stellar wallet: ${stellarWallet.address}`);
  console.log(`   Bridge tx:      ${swapResult.srcTxHash}`);
  console.log(`   Defindex tx:    ${depositTxHash}`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err?.message ?? err);
  process.exit(1);
});
