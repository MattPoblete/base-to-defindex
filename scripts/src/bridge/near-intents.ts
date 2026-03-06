import { ethers, JsonRpcProvider, Contract, Wallet } from "ethers";
import { config } from "../shared/config.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SWAP_AMOUNT_USDC = "1"; // Human readable
const USDC_DECIMALS = 6;
const SWAP_AMOUNT_ATOMIC = ethers.parseUnits(SWAP_AMOUNT_USDC, USDC_DECIMALS);

const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEPOSIT_ABI = [
  "function deposit(address token, address to, uint256 amount, bytes data) external",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getUsdcBalance(wallet: Wallet): Promise<bigint> {
  const usdc = new Contract(BASE_USDC_ADDRESS, DEPOSIT_ABI, wallet);
  return await usdc.balanceOf(wallet.address);
}

async function handleAllowance(
  wallet: Wallet,
  spender: string,
  amount: bigint
) {
  const usdc = new Contract(BASE_USDC_ADDRESS, DEPOSIT_ABI, wallet);
  const currentAllowance = await usdc.allowance(wallet.address, spender);

  if (currentAllowance < amount) {
    console.log(`  Allowance insufficient. Approving ${SWAP_AMOUNT_USDC} USDC...`);
    const tx = await usdc.approve(spender, amount);
    console.log(`  Approve tx sent: ${tx.hash}`);
    await tx.wait();
    console.log("  Approve confirmed");
  } else {
    console.log("  Allowance OK");
  }
}

// ── Main flow ────────────────────────────────────────────────────────────────

async function main() {
  const stellarAddress = process.argv[2];
  if (!stellarAddress) {
    console.error("Usage: npx tsx src/near-intents.ts <STELLAR_ADDRESS>");
    process.exit(1);
  }

  console.log("Near Intents Bridge — Base USDC → Stellar USDC");
  console.log("──────────────────────────────────────────────────────");

  // [1] Setup EVM Wallet
  if (!config.evmPrivateKey) throw new Error("EVM_PRIVATE_KEY is missing");
  const provider = new JsonRpcProvider(config.baseRpcUrl);
  const wallet = new Wallet(config.evmPrivateKey, provider);

  console.log(`  EVM Address:     ${wallet.address}`);
  console.log(`  Stellar Address: ${stellarAddress}`);

  const initialBalance = await getUsdcBalance(wallet);
  console.log(
    `  Initial USDC balance: ${ethers.formatUnits(initialBalance, USDC_DECIMALS)}`
  );

  if (initialBalance < SWAP_AMOUNT_ATOMIC) {
    throw new Error("Insufficient USDC balance on Base");
  }

  // [2] Get 1-Click Quote & Intent from ChainDefuser
  console.log("\n[1/3] Getting quote and intent from ChainDefuser...");

  const quoteResponse = await fetch(`${config.nearIntents.baseUrl}/v0/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.nearIntents.jwt}`,
    },
    body: JSON.stringify({
      defuse_asset_identifier_in: config.nearIntentsOriginAsset,
      defuse_asset_identifier_out: `stellar:${config.stellarUsdcContract}`,
      exact_amount_in: SWAP_AMOUNT_ATOMIC.toString(),
      quote_type: "exact_input",
    }),
  });

  if (!quoteResponse.ok) {
    const errorBody = await quoteResponse.text();
    throw new Error(`Quote failed: ${quoteResponse.statusText} - ${errorBody}`);
  }

  const quoteData = (await quoteResponse.json()) as any;
  const quoteId = quoteData.quote_id;
  console.log(`  Quote ID: ${quoteId}`);
  console.log(
    `  Expected out: ${ethers.formatUnits(quoteData.amount_out, 7)} USDC`
  );

  // Get Intent
  const intentResponse = await fetch(`${config.nearIntents.baseUrl}/v0/intent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.nearIntents.jwt}`,
    },
    body: JSON.stringify({
      quote_id: quoteId,
      receiver_id: stellarAddress,
    }),
  });

  if (!intentResponse.ok) {
    throw new Error(`Intent creation failed: ${intentResponse.statusText}`);
  }

  const intentData = (await intentResponse.json()) as any;
  const depositAddress = intentData.deposit_address;
  console.log(`  Deposit address: ${depositAddress}`);

  // [3] Handle Allowance & Execute Deposit on Base
  console.log("\n[2/3] Executing deposit on Base...");
  await handleAllowance(wallet, depositAddress, SWAP_AMOUNT_ATOMIC);

  const depositContract = new Contract(depositAddress, DEPOSIT_ABI, wallet);

  // Arguments based on the payload analysis:
  // deposit(token, to, amount, data)
  // The 'to' and 'data' come from the 1-click API payload
  const tx = await depositContract.deposit(
    BASE_USDC_ADDRESS,
    intentData.to,
    SWAP_AMOUNT_ATOMIC,
    intentData.data
  );

  console.log(`  Deposit tx sent: ${tx.hash}`);
  console.log("  Waiting for confirmation...");
  const receipt = await tx.wait();
  console.log(`  Confirmed in block ${receipt?.blockNumber}`);

  // [4] Final polling / status check (simplified)
  console.log("\n[3/3] Monitoring bridge status...");
  console.log(
    `  You can track the progress at: ${config.nearIntents.baseUrl.replace(
      "api.",
      ""
    )}/tx/${tx.hash}`
  );

  // Optional: check balance after a while
  console.log("\nWaiting 10 seconds before final balance check...");
  await new Promise((r) => setTimeout(r, 10000));

  const finalBalance = await getUsdcBalance(wallet);
  console.log(
    `  Final USDC balance: ${ethers.formatUnits(finalBalance, USDC_DECIMALS)}`
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
