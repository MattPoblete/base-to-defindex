import "dotenv/config";
import { createHash } from "crypto";
import {
  TransferPeerPathType,
  TransactionOperation,
  TransactionStateEnum,
} from "@fireblocks/ts-sdk";
import { fireblocks } from "../shared/fireblocks-client.js";
import { config } from "../shared/config.js";

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

    if (status === TransactionStateEnum.Completed) {
      return tx;
    }

    if (TERMINAL_STATUSES.has(status) && status !== TransactionStateEnum.Completed) {
      const subStatus = (tx as any)?.subStatus ?? "";
      throw new Error(
        `Transaction ${txId} ended with: ${status}${subStatus ? ` (${subStatus})` : ""}`
      );
    }
  }
  throw new Error(`Transaction ${txId} did not complete after ${POLL_MAX_ATTEMPTS} attempts`);
}

async function main() {
  const vaultId = config.fireblocks.vaultAccountId;

  console.log("Fireblocks Raw Signing — Validation Test");
  console.log("──────────────────────────────────────────────────────────────");

  // A known 32-byte test message to sign (SHA-256 of "fireblocks-raw-sign-test")
  const testMessage = "fireblocks-raw-sign-test";
  const testHashHex = createHash("sha256").update(testMessage).digest("hex");
  console.log(`\n  Test message:   "${testMessage}"`);
  console.log(`  SHA-256 (hex):  ${testHashHex}`);
  console.log(`  Hash length:    ${testHashHex.length / 2} bytes`);

  console.log(`\n  Submitting RAW signing request via Fireblocks (assetId: XLM_TEST)...`);

  const createRes = await fireblocks.transactions.createTransaction({
    transactionRequest: {
      operation: TransactionOperation.Raw,
      assetId: "XLM_TEST",
      source: {
        type: TransferPeerPathType.VaultAccount,
        id: vaultId,
      },
      extraParameters: {
        rawMessageData: {
          messages: [{ content: testHashHex }],
        },
      } as any,
      note: "Fireblocks PoC — raw sign validation test",
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
  if (!signedMessages || signedMessages.length === 0) {
    console.log(`  ❌ No signedMessages in response — raw signing not available in this sandbox`);
    console.log(`     Full tx response:\n${JSON.stringify(completedTx, null, 2)}`);
    process.exit(1);
  }

  const sig = signedMessages[0];
  console.log(`  signedMessages[0]:`, JSON.stringify(sig, null, 2));

  const signatureHex: string = sig?.signature?.fullSig ?? sig?.fullSig ?? sig?.signature ?? "";
  const signatureBytes = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");

  console.log(`\n  Signature (hex): ${signatureHex}`);
  console.log(`  Signature length: ${signatureBytes.length} bytes`);

  if (signatureBytes.length === 64) {
    console.log(`\n  ✅ STRATEGY A CONFIRMED: 64-byte Ed25519 signature returned`);
    console.log(`     Fireblocks raw signing is available — can sign Defindex XDR hashes`);
  } else {
    console.log(`\n  ⚠️  Unexpected signature length: ${signatureBytes.length} bytes (expected 64)`);
    console.log(`     Review the full response above to determine the correct field`);
  }

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("Raw signing test complete.");
}

main().catch((err) => {
  console.error("\n❌ Error:", err?.message ?? err);
  if (err?.response?.data) {
    console.error("   API response:", JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
