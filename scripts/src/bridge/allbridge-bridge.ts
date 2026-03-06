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
import { JsonRpcProvider, Wallet } from "ethers";
import { config } from "../shared/config.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SWAP_AMOUNT = "1"; // 1 USDC, human-readable (SDK uses float strings)
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_ATTEMPTS = 120; // ~20 minutes

// ── Types for Allbridge status response ──────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Cast RawTransaction (union of string | object) to EVM tx fields */
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

// ── SDK init ─────────────────────────────────────────────────────────────────

function initSDK(): AllbridgeCoreSdk {
  const nodeUrls: NodeRpcUrls = {
    [ChainSymbol.BAS]: config.baseRpcUrl,
    [ChainSymbol.SRB]: config.sorobanRpcUrl,
    [ChainSymbol.STLR]: config.stellarHorizonUrl,
  };
  return new AllbridgeCoreSdk(nodeUrls, mainnet);
}

// ── EVM wallet ───────────────────────────────────────────────────────────────

function getEvmWallet(): Wallet {
  if (!config.evmPrivateKey) {
    throw new Error("EVM_PRIVATE_KEY is required. See .env.example");
  }
  const provider = new JsonRpcProvider(config.baseRpcUrl);
  return new Wallet(config.evmPrivateKey, provider);
}

// ── Main flow ────────────────────────────────────────────────────────────────

async function main() {
  const stellarAddress = process.argv[2];
  if (!stellarAddress) {
    console.error(
      "Usage: npx tsx src/allbridge-bridge.ts <STELLAR_ADDRESS>"
    );
    process.exit(1);
  }

  const totalStart = Date.now();

  console.log("Allbridge Bridge — Base USDC → Stellar USDC");
  console.log("──────────────────────────────────────────────────────");

  // [1/5] Init SDK, load wallet, find tokens
  console.log("\n[1/5] Initializing SDK and discovering tokens...");
  const sdk = initSDK();
  const wallet = getEvmWallet();
  console.log(`  EVM address:     ${wallet.address}`);
  console.log(`  Stellar address: ${stellarAddress}`);

  const allTokens = await sdk.tokens();
  const sourceToken = allTokens.find(
    (t) => t.chainSymbol === ChainSymbol.BAS && t.symbol.toUpperCase() === "USDC"
  );
  const destToken = allTokens.find(
    (t) => t.chainSymbol === ChainSymbol.SRB && t.symbol.toUpperCase() === "USDC"
  );

  if (!sourceToken) throw new Error("USDC not found on Base (BAS)");
  if (!destToken) throw new Error("USDC not found on Stellar/Soroban (SRB)");

  console.log(`  Source:  ${sourceToken.symbol} on ${sourceToken.chainSymbol} (${sourceToken.tokenAddress})`);
  console.log(`  Dest:    ${destToken.symbol} on ${destToken.chainSymbol} (${destToken.tokenAddress})`);
  console.log(`  Amount:  ${SWAP_AMOUNT} USDC`);

  // [2/5] Get quote: amount to receive + gas fee
  console.log("\n[2/5] Getting bridge quote...");
  const messenger = Messenger.ALLBRIDGE;

  const [amountToReceive, gasFeeOptions] = await Promise.all([
    sdk.getAmountToBeReceived(SWAP_AMOUNT, sourceToken, destToken, messenger),
    sdk.getGasFeeOptions(sourceToken, destToken, messenger),
  ]);

  const nativeFee = gasFeeOptions[FeePaymentMethod.WITH_NATIVE_CURRENCY];
  const feeInt = nativeFee?.int ?? "0";
  const feeFloat = nativeFee?.float ?? "0";
  const transferTime = sourceToken.transferTime;
  const avgTime = transferTime?.allbridge ?? 5;

  console.log(`  Amount to receive: ${amountToReceive} USDC`);
  console.log(`  Bridge fee (ETH):  ${feeFloat}`);
  console.log(`  Estimated time:    ~${avgTime} min`);

  // [3/5] Check allowance, approve if needed
  console.log("\n[3/5] Checking token allowance...");
  const hasAllowance = await sdk.bridge.checkAllowance({
    token: sourceToken,
    owner: wallet.address,
    amount: SWAP_AMOUNT,
    messenger,
    gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
  });

  if (hasAllowance) {
    console.log("  Allowance OK — no approval needed");
  } else {
    console.log("  Insufficient allowance — sending approve tx...");
    const approveTx = asEvmTx(
      await sdk.bridge.rawTxBuilder.approve({
        token: sourceToken,
        owner: wallet.address,
        messenger,
        gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
      })
    );
    const approveResponse = await wallet.sendTransaction({
      to: approveTx.to,
      data: approveTx.data,
    });
    console.log(`  Approve tx hash: ${approveResponse.hash}`);
    console.log("  Waiting for confirmation...");
    const approveReceipt = await approveResponse.wait();
    console.log(`  Approved in block ${approveReceipt?.blockNumber}`);
  }

  // [4/5] Build bridge tx, sign with ethers, send on-chain
  console.log("\n[4/5] Building and sending bridge transaction...");
  const sendParams: SendParams = {
    amount: SWAP_AMOUNT,
    fromAccountAddress: wallet.address,
    toAccountAddress: stellarAddress,
    sourceToken,
    destinationToken: destToken,
    messenger,
    fee: feeInt,
    feeFormat: AmountFormat.INT,
    gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
  };

  const rawTx = asEvmTx(await sdk.bridge.rawTxBuilder.send(sendParams));
  console.log(`  Raw tx built — to: ${rawTx.to}`);

  const txResponse = await wallet.sendTransaction({
    to: rawTx.to,
    data: rawTx.data,
    value: rawTx.value ? BigInt(rawTx.value) : undefined,
  });
  console.log(`  Bridge tx hash: ${txResponse.hash}`);
  console.log("  Waiting for on-chain confirmation...");
  const txReceipt = await txResponse.wait();
  console.log(`  Confirmed in block ${txReceipt?.blockNumber}`);

  // [5/5] Poll transfer status until complete
  console.log("\n[5/5] Polling bridge transfer status...");
  const bridgeStart = Date.now();
  const txHash = txResponse.hash;

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    let status: TransferStatus;
    try {
      status = (await sdk.getTransferStatus(
        ChainSymbol.BAS,
        txHash
      )) as unknown as TransferStatus;
    } catch (err: unknown) {
      // Allbridge API returns 404 until the tx is indexed — treat as pending
      const is404 =
        err != null &&
        typeof err === "object" &&
        ("response" in err &&
          (err as { response?: { status?: number } }).response?.status === 404);
      if (is404) {
        process.stdout.write(
          `\r  Waiting for tx to be indexed... (${i + 1}/${POLL_MAX_ATTEMPTS})   `
        );
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      throw err;
    }

    // Bridge complete: receive side has a txId
    if (status.receive?.txId) {
      console.log(`\n  Bridge complete!`);
      console.log(`  Sent:     ${status.send?.amountFormatted ?? "?"} USDC (Base)`);
      console.log(`  Received: ${status.receive.amountFormatted} USDC (Stellar)`);
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
  const bridgePct = ((bridgeElapsed / totalElapsed) * 100).toFixed(1);

  console.log("\n──────────────────────────────────────────────────────");
  console.log("Done. Verify USDC arrival on Stellar:");
  console.log(`  https://stellar.expert/explorer/public/account/${stellarAddress}`);
  console.log(`\n  Total time:  ${formatDuration(totalElapsed)}`);
  console.log(`  Bridge time: ${formatDuration(bridgeElapsed)} (${bridgePct}% of total)`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
