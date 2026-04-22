import "dotenv/config";
import { createHash } from "crypto";
import { ethers } from "ethers";
import {
  TransferPeerPathType,
  TransactionOperation,
  TransactionStateEnum,
} from "@fireblocks/ts-sdk";
import { fireblocks } from "../shared/fireblocks-client.js";
import { config } from "../shared/config.js";
import { getOrCreateEvmVault } from "../wallets/fireblocks-base-wallet.js";

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40;

const TERMINAL_STATUSES = new Set<string>([
  TransactionStateEnum.Completed,
  TransactionStateEnum.Failed,
  TransactionStateEnum.Cancelled,
  TransactionStateEnum.Blocked,
  TransactionStateEnum.Rejected,
  TransactionStateEnum.Timeout,
]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollTransaction(txId: string): Promise<any> {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fireblocks.transactions.getTransaction({ txId });
    const tx = res.data;
    const status = tx?.status ?? "";
    console.log(`  [${attempt}/${POLL_MAX_ATTEMPTS}] Status: ${status}`);
    if (status === TransactionStateEnum.Completed) return tx;
    if (TERMINAL_STATUSES.has(status) && status !== TransactionStateEnum.Completed) {
      const sub = (tx as any)?.subStatus ?? "";
      throw new Error(`Transaction ${txId} ended: ${status}${sub ? ` (${sub})` : ""}`);
    }
  }
  throw new Error(`Transaction ${txId} timed out`);
}

async function main() {
  const vaultId = config.fireblocks.vaultAccountId;

  console.log("Fireblocks EVM Raw Signing — Validation Test (secp256k1)");
  console.log("──────────────────────────────────────────────────────────────");

  console.log("\n  Getting vault EVM address...");
  const { address: vaultAddress } = await getOrCreateEvmVault();
  console.log(`  Vault EVM address: ${vaultAddress}`);
  console.log(`  Explorer: https://basescan.org/address/${vaultAddress}`);

  // A known 32-byte test hash to sign
  const testMessage = "fireblocks-evm-raw-sign-test";
  const testHashBytes = Buffer.from(
    createHash("sha256").update(testMessage).digest()
  );
  const testHashHex = testHashBytes.toString("hex");

  console.log(`\n  Test message:   "${testMessage}"`);
  console.log(`  SHA-256 (hex):  ${testHashHex}`);

  console.log(`\n  Submitting RAW signing request via Fireblocks (assetId: ETH_TEST5)...`);

  const createRes = await fireblocks.transactions.createTransaction({
    transactionRequest: {
      operation: TransactionOperation.Raw,
      assetId: "ETH_TEST5",
      source: {
        type: TransferPeerPathType.VaultAccount,
        id: vaultId,
      },
      extraParameters: {
        rawMessageData: {
          messages: [{ content: testHashHex }],
        },
      } as any,
      note: "Fireblocks PoC — EVM raw sign validation test",
    },
  });

  const txId = createRes.data?.id;
  if (!txId) throw new Error("Fireblocks did not return a transaction ID");
  console.log(`  Transaction ID: ${txId}`);

  console.log(`\n  Polling for completion...`);
  const completedTx = await pollTransaction(txId);

  console.log(`\n  ✅ Transaction COMPLETED`);
  console.log(`\n  Inspecting signedMessages...`);

  const signedMessages = (completedTx as any)?.signedMessages;
  if (!signedMessages?.length) {
    console.log(`  ❌ No signedMessages — raw signing not available or different response structure`);
    console.log(`  Full tx:\n${JSON.stringify(completedTx, null, 2)}`);
    process.exit(1);
  }

  const sig = signedMessages[0];
  console.log(`  algorithm:  ${sig?.algorithm}`);
  console.log(`  publicKey:  ${sig?.publicKey}`);
  console.log(`  content:    ${sig?.content}`);
  console.log(`  signature:  ${JSON.stringify(sig?.signature, null, 2)}`);

  // Extract signature components — Fireblocks secp256k1 returns { r, s, v } or { fullSig }
  const rawSig = sig?.signature;
  let recovered: string | undefined;

  if (rawSig?.r && rawSig?.s) {
    const r = "0x" + rawSig.r;
    const s = "0x" + rawSig.s;
    // v from Fireblocks is 0 or 1 (yParity) — some versions return 27/28
    const vRaw: number = typeof rawSig.v === "number" ? rawSig.v : parseInt(rawSig.v, 10);
    const v = vRaw > 1 ? vRaw : vRaw + 27; // normalize to 27/28 for ethers recoverAddress

    console.log(`\n  Parsed r: ${r}`);
    console.log(`  Parsed s: ${s}`);
    console.log(`  Parsed v: ${vRaw} (normalized to ${v})`);

    try {
      const prefixedHash = "0x" + testHashHex;
      recovered = ethers.recoverAddress(prefixedHash, { r, s, v });
      console.log(`\n  Recovered address: ${recovered}`);
      console.log(`  Vault address:     ${vaultAddress}`);
      if (recovered.toLowerCase() === vaultAddress.toLowerCase()) {
        console.log(`\n  ✅ MATCH — Fireblocks EVM raw signing works correctly`);
        console.log(`     Use { r, s, v: yParity } format in FireblocksRawEvmSodaxAdapter`);
        console.log(`     yParity = ${vRaw > 1 ? vRaw - 27 : vRaw} (${vRaw > 1 ? "was 27/28 → subtract 27" : "already 0/1"})`);
      } else {
        console.log(`\n  ⚠️  Address mismatch — check hash encoding`);
        // Try with keccak256 prefix (Ethereum personal sign format)
        const ethHash = ethers.hashMessage(testHashBytes);
        const recovered2 = ethers.recoverAddress(ethHash, { r, s, v });
        console.log(`  With eth_sign prefix: ${recovered2}`);
      }
    } catch (e: any) {
      console.log(`  ❌ recoverAddress failed: ${e.message}`);
    }
  } else if (rawSig?.fullSig) {
    console.log(`\n  fullSig: ${rawSig.fullSig} (${rawSig.fullSig.length / 2} bytes)`);
    console.log(`  ⚠️  secp256k1 fullSig format — need r,s,v split for EIP-1559`);
  } else {
    console.log(`\n  ⚠️  Unknown signature format — inspect output above`);
  }

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("EVM raw signing test complete.");
}

main().catch((err) => {
  console.error("\n❌ Error:", err?.message ?? err);
  process.exit(1);
});
