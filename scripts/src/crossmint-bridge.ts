import { ethers } from "ethers";
import { config } from "./config.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SWAP_AMOUNT_USDC = "1"; // Amount to bridge
const USDC_DECIMALS = 6;
const SWAP_AMOUNT_ATOMIC = (
  BigInt(Number(SWAP_AMOUNT_USDC) * 10 ** USDC_DECIMALS)
).toString();

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 120;
const BASE_WALLET_ALIAS = "script-treasury"; // Server-side wallet
const STELLAR_WALLET_ALIAS = "script-treasury-stellar";

const API_V2 = `${config.baseUrl}/api/2025-06-09/wallets`;
const ONECLICK_BASE = "https://1click.chaindefuser.com/v0";

const headers = {
  "X-API-KEY": config.apiKey,
  "Content-Type": "application/json",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface WalletResponse {
  address: string;
  config?: {
    adminSigner?: { type: string; locator?: string };
  };
}

interface TokenInfo {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
}

interface QuoteResponse {
  quote: {
    depositAddress?: string;
    depositMemo?: string;
    amountInFormatted: string;
    amountOutFormatted: string;
  };
}

// ── Crossmint helpers ────────────────────────────────────────────────────────

async function apiRequest(url: string, options?: RequestInit) {
  const res = await fetch(url, { headers, ...options });
  const data = await res.json();
  if (!res.ok || (data && typeof data === "object" && "error" in data && data.error)) {
    throw new Error(`API ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function getOrCreateWallet(chainType: "evm" | "stellar", alias: string): Promise<WalletResponse> {
  const prefix = chainType === "evm" ? "evm:smart" : "stellar:smart";
  const aliasLocator = `${prefix}:alias:${alias}`;

  const getRes = await fetch(`${API_V2}/${aliasLocator}`, { headers });
  if (getRes.ok) return getRes.json();

  console.log(`  Creating new ${chainType} wallet with alias: ${alias}`);
  return apiRequest(API_V2, {
    method: "POST",
    body: JSON.stringify({
      chainType,
      type: "smart",
      config: { adminSigner: { type: "api-key" } },
      owner: `email:${config.walletEmail}`,
      alias,
    }),
  });
}

async function sendRawTransaction(walletLocator: string, signerLocator: string, tx: { to: string; data: string; value?: string }) {
  const result = await apiRequest(`${API_V2}/${walletLocator}/transactions`, {
    method: "POST",
    body: JSON.stringify({
      params: {
        signer: signerLocator,
        chain: config.chain,
        calls: [{ to: tx.to, data: tx.data, value: tx.value ?? "0" }],
      },
    }),
  });

  // api-key signer: auto-approve
  if (result.status === "awaiting-approval") {
    await apiRequest(`${API_V2}/${walletLocator}/transactions/${result.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ approvals: [{ signer: signerLocator }] }),
    });
  }

  // Poll Crossmint transaction status
  for (let i = 0; i < 60; i++) {
    const poll = await fetch(`${API_V2}/${walletLocator}/transactions/${result.id}`, { headers });
    const txStatus = await poll.json();
    if (txStatus.status === "success") return { id: result.id, onChainHash: txStatus.onChain?.txId };
    if (txStatus.status === "failed") throw new Error(`Crossmint tx failed: ${JSON.stringify(txStatus.error || txStatus)}`);
    process.stdout.write(`  Crossmint status: ${txStatus.status} (${i+1}/60)...\r`);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("Crossmint transaction timeout");
}

// ── Near Intents helpers ─────────────────────────────────────────────────────

async function oneClickFetch(path: string, options?: RequestInit) {
  const niHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (config.nearIntents.jwt) niHeaders["Authorization"] = `Bearer ${config.nearIntents.jwt}`;

  const res = await fetch(`${ONECLICK_BASE}${path}`, {
    headers: niHeaders,
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Near Intents API ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

async function getQuote(refundAddress: string, recipient: string, destAssetId: string): Promise<QuoteResponse> {
  const body = {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: config.nearIntentsOriginAsset,
    destinationAsset: destAssetId,
    amount: SWAP_AMOUNT_ATOMIC,
    refundTo: refundAddress,
    recipient,
    depositType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    quoteWaitingTimeMs: 3000,
  };
  console.log(`  Quote Request: ${JSON.stringify(body, null, 2)}`);
  return oneClickFetch("/quote", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const totalStart = Date.now();
  console.log("Crossmint Bridge — Base USDC → Stellar USDC (Near Intents Server-Side)");
  console.log(`Env: ${config.isStaging ? "staging" : "production"} | Chain: ${config.chain}`);
  console.log("─────────────────────────────────────────────────────────────────────");

  // [1/6] Wallets
  console.log("\n[1/6] Creating/fetching Crossmint wallets...");
  const [baseWallet, stellarWallet] = await Promise.all([
    getOrCreateWallet("evm", BASE_WALLET_ALIAS),
    getOrCreateWallet("stellar", STELLAR_WALLET_ALIAS),
  ]);
  const signerLocator = baseWallet.config?.adminSigner?.locator;
  if (!signerLocator) throw new Error("No adminSigner locator found");
  
  const walletLocator = `evm:smart:alias:${BASE_WALLET_ALIAS}`;
  
  // Use CLI arg if provided, otherwise fallback to Crossmint Stellar wallet
  const stellarAddress = process.argv[2] ?? stellarWallet.address;

  console.log(`  Base:    ${baseWallet.address}`);
  console.log(`  Stellar: ${stellarAddress} ${process.argv[2] ? "(from CLI)" : "(Crossmint wallet)"}`);

  // [2/6] Quote
  console.log("\n[2/6] Getting Near Intents quote...");
  const tokens = await oneClickFetch("/tokens") as TokenInfo[];
  const destToken = tokens.find(t => 
    (t.blockchain === "stellar" || t.assetId.includes("stellar")) && 
    t.symbol.toUpperCase() === "USDC"
  );
  if (!destToken) throw new Error("Stellar USDC not found in Near Intents tokens");

  console.log(`  Selected Destination Token: ${destToken.symbol} on ${destToken.blockchain} (${destToken.assetId})`);
  
  const quoteRes = await getQuote(baseWallet.address, stellarAddress, destToken.assetId);
  const { depositAddress, amountInFormatted, amountOutFormatted } = quoteRes.quote;
  if (!depositAddress) throw new Error("No deposit address in quote");

  console.log(`  Send:    ${amountInFormatted} USDC`);
  console.log(`  Receive: ${amountOutFormatted} USDC (Stellar)`);
  console.log(`  Deposit: ${depositAddress}`);

  // [3/6] Balance Check
  console.log("\n[3/6] Checking balances...");
  const balances = await apiRequest(`${API_V2}/${baseWallet.address}/balances?tokens=${config.token}&chains=${config.chain}`);
  const usdcBalance = balances.find((b: any) => b.token.toLowerCase() === config.token.toLowerCase())?.amount ?? "0";
  console.log(`  Current USDC: ${usdcBalance}`);
  if (parseFloat(usdcBalance) < parseFloat(SWAP_AMOUNT_USDC)) {
      throw new Error(`Insufficient funds: ${usdcBalance} USDC < ${SWAP_AMOUNT_USDC} USDC`);
  }

  // [4/6] Near Intents logic
  console.log("\n[4/6] Preparing transaction...");

  // [5/6] Transfer (Send USDC to Deposit Address)
  console.log("\n[5/6] Sending USDC to Near Intents deposit address...");
  const erc20 = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
  const data = erc20.encodeFunctionData("transfer", [depositAddress, SWAP_AMOUNT_ATOMIC]);
  
  const result = await sendRawTransaction(walletLocator, signerLocator, {
    to: config.baseUsdcContract,
    data,
  });
  console.log(`\n  Base Tx Hash: ${result.onChainHash}`);

  // [6/6] Submit & Poll
  console.log("\n[6/6] Submitting to Near Intents and polling status...");
  await oneClickFetch("/deposit/submit", {
    method: "POST",
    body: JSON.stringify({ txHash: result.onChainHash, depositAddress }),
  });

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const statusRes = await oneClickFetch(`/status?depositAddress=${depositAddress}`);
    process.stdout.write(`  Status: ${statusRes.status} (${i + 1}/${POLL_MAX_ATTEMPTS})...\r`);
    
    if (statusRes.status === "SUCCESS") {
      console.log("\n  Bridge Complete! Fund successfully moved to Stellar.");
      if (statusRes.swapDetails) console.log("  Details:", JSON.stringify(statusRes.swapDetails, null, 2));
      break;
    }
    if (["FAILED", "REFUNDED"].includes(statusRes.status)) {
        throw new Error(`Bridge terminal state: ${statusRes.status}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  const elapsed = (Date.now() - totalStart) / 1000;
  console.log(`\n─────────────────────────────────────────────────────────────────────`);
  console.log(`Total elapsed time: ${Math.floor(elapsed)}s`);
}

main().catch(err => {
  console.error("\nError:", err.message || err);
  process.exit(1);
});
