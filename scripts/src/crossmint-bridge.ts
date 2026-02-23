import {
  AllbridgeCoreSdk,
  ChainSymbol,
  Messenger,
  FeePaymentMethod,
  AmountFormat,
  mainnet,
  type NodeRpcUrls,
  type SendParams,
  type RawTransaction,
} from "@allbridge/bridge-core-sdk";
import * as readline from "node:readline/promises";
import { config } from "./config.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SWAP_AMOUNT = "1";
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_ATTEMPTS = 120;
const SIGNER_SUFFIX = config.signerType === "email" ? "-email" : "";
const BASE_WALLET_ALIAS = `script-treasury${SIGNER_SUFFIX}`;
const STELLAR_WALLET_ALIAS = "script-treasury-stellar";

const API_V2 = `${config.baseUrl}/api/2025-06-09/wallets`;
const AUTH_PATH = `${config.baseUrl}/api/2024-09-26/session/sdk/auth`;

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

interface TransferStatusSide {
  txId: string;
  amount: string;
  amountFormatted: number;
  confirmations: number;
  confirmationsNeeded: number;
}

interface TransferStatus {
  txId: string;
  sourceChainSymbol: string;
  destinationChainSymbol: string;
  sendAmountFormatted: number;
  signaturesCount: number;
  signaturesNeeded: number;
  send: TransferStatusSide | null;
  receive: TransferStatusSide | null;
  isSuspended?: boolean;
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

// ── Email OTP helpers ────────────────────────────────────────────────────────

async function promptInTerminal(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function sendEmailOTP(email: string): Promise<string> {
  const clientHeaders = {
    "Content-Type": "application/json",
    "X-API-KEY": config.clientApiKey,
  };
  const res = await fetch(`${AUTH_PATH}/otps/send`, {
    method: "POST",
    headers: clientHeaders,
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OTP send failed: ${JSON.stringify(data)}`);
  return data.emailId;
}

async function confirmEmailOTP(email: string, otp: string, emailId: string): Promise<string> {
  const params = new URLSearchParams({
    email,
    signinAuthenticationMethod: "email",
    token: otp,
    locale: "en",
    state: emailId,
    callbackUrl: "https://localhost",
  });
  const clientHeaders = {
    "Content-Type": "application/json",
    "X-API-KEY": config.clientApiKey,
  };
  const res = await fetch(`${AUTH_PATH}/authenticate?${params}`, {
    method: "POST",
    headers: clientHeaders,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OTP confirm failed: ${JSON.stringify(data)}`);
  return data.oneTimeSecret;
}

// ── Crossmint wallet helpers ────────────────────────────────────────────────

async function getOrCreateWallet(
  chainType: "evm" | "stellar",
  alias: string
): Promise<WalletResponse> {
  const prefix = chainType === "evm" ? "evm:smart" : "stellar:smart";
  const aliasLocator = `${prefix}:alias:${alias}`;

  const getRes = await fetch(`${API_V2}/${aliasLocator}`, { headers });
  if (getRes.ok) {
    return getRes.json();
  }

  const adminSigner =
    config.signerType === "email" && chainType === "evm"
      ? { type: "email" as const, address: config.walletEmail }
      : { type: "api-key" as const };

  return apiRequest(API_V2, {
    method: "POST",
    body: JSON.stringify({
      chainType,
      type: "smart",
      config: { adminSigner },
      owner: `email:${config.walletEmail}`,
      alias,
    }),
  });
}

async function approveTransaction(
  walletLocator: string,
  txId: string,
  signerLocator: string
) {
  // Email signer: OTP verification required
  if (signerLocator.startsWith("email:")) {
    const email = signerLocator.replace("email:", "");
    console.log(`  Sending OTP to ${email}...`);
    const emailId = await sendEmailOTP(email);
    const otp = await promptInTerminal(`  Enter OTP code sent to ${email}: `);
    console.log("  Verifying OTP...");
    const oneTimeSecret = await confirmEmailOTP(email, otp, emailId);

    return apiRequest(`${API_V2}/${walletLocator}/transactions/${txId}/approvals`, {
      method: "POST",
      body: JSON.stringify({
        approvals: [{ signer: signerLocator, signature: oneTimeSecret }],
      }),
    });
  }

  // api-key signer: auto-approve
  return apiRequest(`${API_V2}/${walletLocator}/transactions/${txId}/approvals`, {
    method: "POST",
    body: JSON.stringify({ approvals: [{ signer: signerLocator }] }),
  });
}

async function waitForTransaction(walletLocator: string, txId: string) {
  const maxAttempts = 60;
  const intervalMs = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${API_V2}/${walletLocator}/transactions/${txId}`, { headers });
    const tx = await res.json();
    const status = tx.status as string;
    if (status === "success" || status === "failed") {
      return tx;
    }
    process.stdout.write(`  Crossmint tx status: ${status} (${i + 1}/${maxAttempts})...\r`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Transaction ${txId} did not finalize after ${maxAttempts} attempts`);
}

async function sendRawTransaction(
  walletLocator: string,
  signerLocator: string,
  tx: { to: string; data: string; value?: string }
): Promise<{ txId: string; onChainHash: string }> {
  const result = await apiRequest(`${API_V2}/${walletLocator}/transactions`, {
    method: "POST",
    body: JSON.stringify({
      params: {
        signer: signerLocator,
        chain: config.chain === "base-sepolia" ? "base-sepolia" : "base",
        calls: [
          {
            to: tx.to,
            data: tx.data,
            value: tx.value ?? "0",
          },
        ],
      },
    }),
  });

  if (result.status === "awaiting-approval") {
    console.log("  Approving transaction...");
    await approveTransaction(walletLocator, result.id, signerLocator);
  }

  console.log("  Waiting for on-chain confirmation...");
  const finalTx = await waitForTransaction(walletLocator, result.id);

  if (finalTx.status === "failed") {
    throw new Error(`Crossmint tx failed: ${JSON.stringify(finalTx.error ?? finalTx)}`);
  }

  return {
    txId: result.id,
    onChainHash: finalTx.onChain?.txId ?? "",
  };
}

// ── Allbridge helpers ────────────────────────────────────────────────────────

function initSDK(): AllbridgeCoreSdk {
  const nodeUrls: NodeRpcUrls = {
    [ChainSymbol.BAS]: config.baseRpcUrl,
    [ChainSymbol.SRB]: config.sorobanRpcUrl,
    [ChainSymbol.STLR]: config.stellarHorizonUrl,
  };
  return new AllbridgeCoreSdk(nodeUrls, mainnet);
}

function asEvmTx(raw: RawTransaction): { to: string; data: string; value?: string } {
  return raw as { to: string; data: string; value?: string };
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function formatStatus(s: TransferStatus): string {
  const parts: string[] = [];

  if (s.send) {
    parts.push(
      `Send: ${s.send.amountFormatted} USDC (${s.send.confirmations}/${s.send.confirmationsNeeded} confirmations)`
    );
  } else {
    parts.push("Send: awaiting...");
  }

  parts.push(`Signatures: ${s.signaturesCount}/${s.signaturesNeeded}`);

  if (s.receive) {
    parts.push(`Receive: ${s.receive.amountFormatted} USDC (tx: ${s.receive.txId.slice(0, 16)}...)`);
  } else {
    parts.push("Receive: pending");
  }

  return parts.join(" | ");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const totalStart = Date.now();

  console.log("Crossmint Bridge — Base USDC → Stellar USDC");
  console.log(`Signer: ${config.signerType} | Env: ${config.isStaging ? "staging" : "production"}`);
  console.log("──────────────────────────────────────────");

  // [1/6] Create/fetch Crossmint wallets
  console.log("\n[1/6] Creating/fetching Crossmint wallets...");
  const [baseWallet, stellarWallet] = await Promise.all([
    getOrCreateWallet("evm", BASE_WALLET_ALIAS),
    getOrCreateWallet("stellar", STELLAR_WALLET_ALIAS),
  ]);

  const signerLocator = baseWallet.config?.adminSigner?.locator;
  if (!signerLocator) {
    throw new Error("Base wallet has no adminSigner locator — cannot sign transactions");
  }

  const walletLocator = `evm:smart:alias:${BASE_WALLET_ALIAS}`;
  const stellarAddress = process.argv[2] ?? stellarWallet.address;

  console.log(`  Base:    ${baseWallet.address}  (signer: ${signerLocator})`);
  console.log(`  Stellar: ${stellarAddress}`);
  if (!process.argv[2]) {
    console.log("  (using Crossmint Stellar wallet as destination)");
  }

  // [2/6] Init Allbridge SDK, find tokens, get quote
  console.log("\n[2/6] Getting bridge quote...");
  const sdk = initSDK();

  const allTokens = await sdk.tokens();
  const sourceToken = allTokens.find(
    (t) => t.chainSymbol === ChainSymbol.BAS && t.symbol.toUpperCase() === "USDC"
  );
  const destToken = allTokens.find(
    (t) => t.chainSymbol === ChainSymbol.SRB && t.symbol.toUpperCase() === "USDC"
  );

  if (!sourceToken) throw new Error("USDC not found on Base (BAS)");
  if (!destToken) throw new Error("USDC not found on Stellar/Soroban (SRB)");

  const messenger = Messenger.ALLBRIDGE;

  const [amountToReceive, gasFeeOptions] = await Promise.all([
    sdk.getAmountToBeReceived(SWAP_AMOUNT, sourceToken, destToken, messenger),
    sdk.getGasFeeOptions(sourceToken, destToken, messenger),
  ]);

  const nativeFee = gasFeeOptions[FeePaymentMethod.WITH_NATIVE_CURRENCY];
  const feeInt = nativeFee?.int ?? "0";
  const feeFloat = nativeFee?.float ?? "0";

  console.log(`  Send: ${SWAP_AMOUNT} USDC | Receive: ~${amountToReceive} USDC | Fee: ${feeFloat} ETH`);

  // [3/6] Check allowance
  console.log("\n[3/6] Checking allowance...");
  const hasAllowance = await sdk.bridge.checkAllowance({
    token: sourceToken,
    owner: baseWallet.address,
    amount: SWAP_AMOUNT,
    messenger,
    gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
  });

  // [4/6] Approve if needed
  if (hasAllowance) {
    console.log("  Allowance OK");
    console.log("\n[4/6] Skipping approve (not needed)");
  } else {
    console.log("  Insufficient allowance — approving...");
    console.log("\n[4/6] Sending approve transaction via Crossmint...");
    const approveTx = asEvmTx(
      await sdk.bridge.rawTxBuilder.approve({
        token: sourceToken,
        owner: baseWallet.address,
        messenger,
        gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
      })
    );
    const approveResult = await sendRawTransaction(walletLocator, signerLocator, approveTx);
    console.log(`  Approve tx: ${approveResult.onChainHash}`);
  }

  // [5/6] Build + send bridge tx via Crossmint
  console.log("\n[5/6] Sending bridge transaction via Crossmint...");
  const sendParams: SendParams = {
    amount: SWAP_AMOUNT,
    fromAccountAddress: baseWallet.address,
    toAccountAddress: stellarAddress,
    sourceToken,
    destinationToken: destToken,
    messenger,
    fee: feeInt,
    feeFormat: AmountFormat.INT,
    gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
  };

  const rawTx = asEvmTx(await sdk.bridge.rawTxBuilder.send(sendParams));
  const bridgeResult = await sendRawTransaction(walletLocator, signerLocator, rawTx);

  console.log(`  Crossmint tx ID: ${bridgeResult.txId} | Status: success`);
  console.log(`  On-chain hash: ${bridgeResult.onChainHash}`);

  // [6/6] Poll Allbridge transfer status
  console.log("\n[6/6] Polling bridge transfer status...");
  const bridgeStart = Date.now();
  const txHash = bridgeResult.onChainHash;

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    let status: TransferStatus;
    try {
      status = (await sdk.getTransferStatus(
        ChainSymbol.BAS,
        txHash
      )) as unknown as TransferStatus;
    } catch (err: unknown) {
      const is404 =
        err != null &&
        typeof err === "object" &&
        "response" in err &&
        (err as { response?: { status?: number } }).response?.status === 404;
      if (is404) {
        process.stdout.write(
          `\r  Waiting for tx to be indexed... (${i + 1}/${POLL_MAX_ATTEMPTS})   `
        );
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      throw err;
    }

    if (status.receive?.txId) {
      console.log(`\n  Bridge complete! Received ${status.receive.amountFormatted} USDC on Stellar`);
      console.log(`  Stellar tx: ${status.receive.txId}`);
      break;
    }

    process.stdout.write(`\r  ${formatStatus(status)} (${i + 1}/${POLL_MAX_ATTEMPTS})   `);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    if (i === POLL_MAX_ATTEMPTS - 1) {
      console.log(`\n  Max polling attempts reached.`);
      console.log(`  Last: ${formatStatus(status)}`);
      console.log("  The bridge may still complete — check manually.");
    }
  }

  const totalElapsed = Date.now() - totalStart;
  const bridgeElapsed = Date.now() - bridgeStart;

  console.log("\n──────────────────────────────────────────");
  console.log(`Done. Total time: ${formatDuration(totalElapsed)} (bridge: ${formatDuration(bridgeElapsed)})`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
