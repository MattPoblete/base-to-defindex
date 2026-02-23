import { ethers, JsonRpcProvider, Contract, Wallet } from "ethers";
import { config } from "./config.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SWAP_AMOUNT_USDC = "1"; // Human-readable
const USDC_DECIMALS = 6;
const SWAP_AMOUNT_ATOMIC = (
  BigInt(Number(SWAP_AMOUNT_USDC) * 10 ** USDC_DECIMALS)
).toString();

const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base mainnet
const ORIGIN_ASSET =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const SLIPPAGE_BPS = 100; // 1%
const DEADLINE_MINUTES = 30;

const ONECLICK_BASE = "https://1click.chaindefuser.com/v0";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

// ── EVM helpers ──────────────────────────────────────────────────────────────

function getEvmWallet(): Wallet {
  if (!config.evmPrivateKey) {
    throw new Error("EVM_PRIVATE_KEY is required. See .env.example");
  }
  const provider = new JsonRpcProvider(config.baseRpcUrl);
  return new Wallet(config.evmPrivateKey, provider);
}

async function getUsdcBalance(wallet: Wallet): Promise<bigint> {
  const contract = new Contract(USDC_CONTRACT, ERC20_ABI, wallet.provider);
  return contract.balanceOf(wallet.address);
}

async function transferUsdc(
  wallet: Wallet,
  to: string,
  amountAtomic: string
): Promise<string> {
  const contract = new Contract(USDC_CONTRACT, ERC20_ABI, wallet);
  const tx = await contract.transfer(to, amountAtomic);
  console.log(`  Tx hash: ${tx.hash}`);
  console.log("  Waiting for confirmation...");
  const receipt = await tx.wait();
  console.log(`  Confirmed in block ${receipt.blockNumber}`);
  return tx.hash as string;
}

// ── 1Click API helpers (raw fetch, following reference client pattern) ───────

interface TokenInfo {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  contractAddress?: string;
}

interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  minAmountOut: string;
  deadline?: string;
  [key: string]: unknown;
}

interface QuoteResponse {
  correlationId: string;
  quote: Quote;
  [key: string]: unknown;
}

async function oneClickFetch(
  path: string,
  options?: RequestInit
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.nearIntents.jwt) {
    headers["Authorization"] = `Bearer ${config.nearIntents.jwt}`;
  }

  const res = await fetch(`${ONECLICK_BASE}${path}`, {
    headers,
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "message" in data
        ? (data as { message: string }).message
        : JSON.stringify(data);
    throw new Error(`1Click API ${res.status}: ${msg}`);
  }
  return data;
}

async function getTokens(): Promise<TokenInfo[]> {
  return oneClickFetch("/tokens") as Promise<TokenInfo[]>;
}

async function getQuote(
  refundAddress: string,
  recipient: string,
  destAssetId: string
): Promise<QuoteResponse> {
  return oneClickFetch("/quote", {
    method: "POST",
    body: JSON.stringify({
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: SLIPPAGE_BPS,
      originAsset: ORIGIN_ASSET,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: destAssetId,
      amount: SWAP_AMOUNT_ATOMIC,
      refundTo: refundAddress,
      refundType: "ORIGIN_CHAIN",
      recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(
        Date.now() + DEADLINE_MINUTES * 60 * 1000
      ).toISOString(),
      quoteWaitingTimeMs: 3000,
    }),
  }) as Promise<QuoteResponse>;
}

async function submitDeposit(
  txHash: string,
  depositAddress: string
): Promise<unknown> {
  return oneClickFetch("/deposit/submit", {
    method: "POST",
    body: JSON.stringify({ txHash, depositAddress }),
  });
}

async function pollSwapStatus(
  depositAddress: string,
  depositMemo?: string
): Promise<string> {
  const maxAttempts = 120;
  const intervalMs = 5000;

  for (let i = 0; i < maxAttempts; i++) {
    const params = new URLSearchParams({ depositAddress });
    if (depositMemo) params.set("depositMemo", depositMemo);

    const data = (await oneClickFetch(`/status?${params}`)) as {
      status: string;
      swapDetails?: unknown;
    };

    const status = data.status ?? "UNKNOWN";
    if (["SUCCESS", "REFUNDED", "FAILED"].includes(status)) {
      console.log(`\n  Swap terminal status: ${status}`);
      if (data.swapDetails) {
        console.log(`  Details:`, JSON.stringify(data.swapDetails, null, 2));
      }
      return status;
    }
    process.stdout.write(
      `  Swap status: ${status} (${i + 1}/${maxAttempts})...\r`
    );
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Swap did not reach terminal status after ${maxAttempts} attempts`
  );
}

// ── Main flow ────────────────────────────────────────────────────────────────

async function main() {
  const stellarAddress = process.argv[2];
  if (!stellarAddress) {
    console.error("Usage: npx tsx src/near-intents.ts <STELLAR_ADDRESS>");
    process.exit(1);
  }

  console.log("Near Intents 1Click Swap — Base USDC → Stellar USDC");
  console.log("──────────────────────────────────────────────────────");

  // [1/5] Load EVM wallet, parse Stellar address
  console.log("\n[1/5] Loading EVM wallet...");
  const wallet = getEvmWallet();
  console.log(`  EVM address:     ${wallet.address}`);
  console.log(`  Stellar address: ${stellarAddress}`);

  // [2/5] Check USDC balance, discover 1Click tokens (find Stellar USDC)
  console.log("\n[2/5] Checking USDC balance & discovering tokens...");
  const [balance, allTokens] = await Promise.all([
    getUsdcBalance(wallet),
    getTokens(),
  ]);

  const balanceFormatted = ethers.formatUnits(balance, USDC_DECIMALS);
  console.log(`  USDC balance: ${balanceFormatted}`);
  console.log(`  Swap amount:  ${SWAP_AMOUNT_USDC}`);

  if (balance < BigInt(SWAP_AMOUNT_ATOMIC)) {
    throw new Error(
      `Insufficient USDC balance: ${balanceFormatted} < ${SWAP_AMOUNT_USDC}`
    );
  }

  const stellarTokens = allTokens.filter(
    (t) =>
      t.blockchain === "stellar" ||
      t.assetId?.toLowerCase().includes("stellar") ||
      t.assetId?.toLowerCase().includes("xlm")
  );
  const stellarUsdc = stellarTokens.find(
    (t) => t.symbol?.toUpperCase() === "USDC"
  );

  console.log(`  Found ${allTokens.length} total tokens on 1Click`);
  if (stellarTokens.length > 0) {
    console.log(`  Stellar tokens (${stellarTokens.length}):`);
    for (const t of stellarTokens) {
      console.log(
        `    - ${t.symbol} | blockchain: ${t.blockchain} | id: ${t.assetId}`
      );
    }
  }

  if (!stellarUsdc) {
    throw new Error(
      "Stellar USDC not found in 1Click token list.\n" +
        "Check https://app.defuse.org/ for current chain support."
    );
  }

  const destAssetId = stellarUsdc.assetId;
  console.log(`  Destination asset: ${destAssetId}`);

  // [3/5] Get swap quote (real, with deposit address)
  console.log("\n[3/5] Getting swap quote...");
  const quoteRes = await getQuote(
    wallet.address,
    stellarAddress,
    destAssetId
  );

  const { depositAddress, depositMemo, amountInFormatted, amountOutFormatted } =
    quoteRes.quote;

  if (!depositAddress) {
    throw new Error("No deposit address returned from 1Click quote");
  }

  console.log(`  Send:    ${amountInFormatted} USDC`);
  console.log(`  Receive: ${amountOutFormatted} USDC (Stellar)`);
  console.log(`  Deposit: ${depositAddress}`);
  if (depositMemo) console.log(`  Memo:    ${depositMemo}`);
  if (quoteRes.quote.deadline) {
    console.log(
      `  Deadline: ${new Date(quoteRes.quote.deadline as string).toLocaleString()}`
    );
  }

  // [4/5] Transfer USDC to deposit address via ethers, submit tx hash to 1Click
  console.log("\n[4/5] Transferring USDC to deposit address...");
  const txHash = await transferUsdc(wallet, depositAddress, SWAP_AMOUNT_ATOMIC);

  console.log("  Submitting tx hash to 1Click...");
  await submitDeposit(txHash, depositAddress);
  console.log("  Deposit submitted");

  // [5/5] Poll swap status until SUCCESS/FAILED/REFUNDED
  console.log("\n[5/5] Polling swap status...");
  const finalStatus = await pollSwapStatus(depositAddress, depositMemo);

  console.log("\n──────────────────────────────────────────────────────");
  if (finalStatus === "SUCCESS") {
    console.log("Swap completed successfully!");
  } else {
    console.log(`Swap ended with status: ${finalStatus}`);
  }

  const finalBalance = await getUsdcBalance(wallet);
  console.log(
    `  Final USDC balance: ${ethers.formatUnits(finalBalance, USDC_DECIMALS)}`
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
