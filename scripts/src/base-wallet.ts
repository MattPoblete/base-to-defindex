import { config } from "./config.js";

const RECIPIENT_ADDRESS = "0x0610CFB8f9778160908410978Fd22a68E3FdD21C";
const TRANSFER_AMOUNT = "1";

const API_V2 = `${config.baseUrl}/api/2025-06-09/wallets`;
const API_LEGACY = `${config.baseUrl}/api/v1-alpha2/wallets`;
const WALLET_ALIAS = "script-treasury";

const headers = {
  "X-API-KEY": config.apiKey,
  "Content-Type": "application/json",
};

async function apiRequest(url: string, options?: RequestInit) {
  const res = await fetch(url, { headers, ...options });
  const data = await res.json();
  if (!res.ok || (data && typeof data === "object" && "error" in data && data.error)) {
    throw new Error(`API ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

interface WalletResponse {
  address: string;
  config?: {
    adminSigner?: { type: string; locator?: string };
  };
}

// 1. Create or get wallet (uses alias to avoid colliding with dapp wallets)
async function getOrCreateWallet(): Promise<WalletResponse> {
  const aliasLocator = `evm:smart:alias:${WALLET_ALIAS}`;

  const getRes = await fetch(`${API_V2}/${aliasLocator}`, { headers });
  if (getRes.ok) {
    return getRes.json();
  }

  // Create new wallet with api-key signer (Crossmint signs server-side)
  return apiRequest(API_V2, {
    method: "POST",
    body: JSON.stringify({
      chainType: "evm",
      type: "smart",
      config: { adminSigner: { type: "api-key" } },
      owner: `email:${config.walletEmail}`,
      alias: WALLET_ALIAS,
    }),
  });
}

// 2. Get balances
async function getBalances(address: string) {
  return apiRequest(
    `${API_V2}/${address}/balances?tokens=${config.token}&chains=${config.chain}`
  );
}

// 3. Fund wallet (staging only)
async function fundWallet(address: string, amount: number) {
  return apiRequest(`${API_LEGACY}/${address}/balances`, {
    method: "POST",
    body: JSON.stringify({
      amount,
      token: "usdxm",
      chain: config.chain,
    }),
  });
}

// 4. Transfer tokens
async function transferTokens(to: string, amount: string, signerLocator?: string) {
  const tokenLocator = `${config.chain}:0x14196F08a4Fa0B66B7331bC40dd6bCd8A1dEeA9F`;
  const walletLocator = `evm:smart:alias:${WALLET_ALIAS}`;
  return apiRequest(`${API_V2}/${walletLocator}/tokens/${tokenLocator}/transfers`, {
    method: "POST",
    body: JSON.stringify({
      recipient: to,
      amount,
      ...(signerLocator ? { signer: signerLocator } : {}),
    }),
  });
}

// 5. Approve a pending transaction (for api-key signers, server signs using X-API-KEY auth)
async function approveTransaction(txId: string, signerLocator: string) {
  const walletLocator = `evm:smart:alias:${WALLET_ALIAS}`;
  return apiRequest(`${API_V2}/${walletLocator}/transactions/${txId}/approvals`, {
    method: "POST",
    body: JSON.stringify({ approvals: [{ signer: signerLocator }] }),
  });
}

// 6. Poll transaction until final state
async function waitForTransaction(walletAddress: string, txId: string) {
  const maxAttempts = 60;
  const intervalMs = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${API_V2}/${walletAddress}/transactions/${txId}`, { headers });
    const tx = await res.json();
    const status = tx.status as string;
    if (status === "success" || status === "failed") {
      return tx;
    }
    process.stdout.write(`  Status: ${status} (${i + 1}/${maxAttempts})...\r`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Transaction ${txId} did not finalize after ${maxAttempts} attempts`);
}

async function main() {
  console.log(`Environment: ${config.isStaging ? "staging" : "production"}`);
  console.log(`Chain: ${config.chain}`);
  console.log("──────────────────────────────────────────────────────");

  // 1. Create/get wallet
  console.log(`\nCreating/fetching wallet for ${config.walletEmail}...`);
  const wallet = await getOrCreateWallet();
  const signerLocator = wallet.config?.adminSigner?.locator;
  console.log(`Wallet address: ${wallet.address}`);
  console.log(`Signer: ${wallet.config?.adminSigner?.type} (${signerLocator})`);

  // 2. Check balances
  console.log("\nFetching balances...");
  const balances = await getBalances(wallet.address);
  console.log("Balances:", JSON.stringify(balances, null, 2));

  // 3. Fund wallet (staging only)
  if (config.isStaging) {
    console.log("\nFunding wallet with 10 USDXM (staging)...");
    await fundWallet(wallet.address, 10);
    const updated = await getBalances(wallet.address);
    console.log("Updated balances:", JSON.stringify(updated, null, 2));
  }

  // 4. Transfer tokens
  console.log(`\nSending ${TRANSFER_AMOUNT} ${config.token} to ${RECIPIENT_ADDRESS}...`);
  const tx = await transferTokens(RECIPIENT_ADDRESS, TRANSFER_AMOUNT, signerLocator);
  console.log(`Tx ID: ${tx.id} | Status: ${tx.status}`);

  // 5. Approve if needed (api-key signer: server signs, we just authorize)
  if (tx.status === "awaiting-approval" && signerLocator) {
    console.log("Approving transaction...");
    await approveTransaction(tx.id, signerLocator);
  }

  // 6. Wait for on-chain confirmation
  console.log("Waiting for on-chain confirmation...");
  const finalTx = await waitForTransaction(wallet.address, tx.id);
  console.log(`\nTransfer ${finalTx.status}!`);
  if (finalTx.error) {
    console.log("Error:", JSON.stringify(finalTx.error, null, 2));
  }
  if (finalTx.onChain) {
    console.log(`Tx hash: ${finalTx.onChain.txId}`);
    console.log(`Explorer: ${finalTx.onChain.explorerLink}`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
