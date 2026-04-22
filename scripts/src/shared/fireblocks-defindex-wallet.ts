import {
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
} from "@stellar/stellar-base";
import {
  TransferPeerPathType,
  TransactionOperation,
  TransactionStateEnum,
} from "@fireblocks/ts-sdk";
import { fireblocks } from "./fireblocks-client.js";
import { config } from "./config.js";
import { FIREBLOCKS_STELLAR_MAINNET_ADDRESS } from "../wallets/fireblocks-stellar-mainnet.js";

const DEFINDEX_API = "https://api.defindex.io";
const DEFINDEX_SLIPPAGE_BPS = 50;

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

// ── Defindex API helpers ──────────────────────────────────────────────────────

async function buildDepositXdr(
  vaultAddress: string,
  callerAddress: string,
  amountStroops: bigint,
  apiKey: string,
  network: "testnet" | "mainnet"
): Promise<string> {
  const url = `${DEFINDEX_API}/vault/${vaultAddress}/deposit?network=${network}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      amounts: [Number(amountStroops)],
      caller: callerAddress,
      invest: true,
      slippageBps: DEFINDEX_SLIPPAGE_BPS,
    }),
  });

  const json = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(`Defindex API error ${response.status}: ${JSON.stringify(json)}`);
  }
  if (!json.xdr) {
    throw new Error(`Defindex API returned no XDR: ${JSON.stringify(json)}`);
  }
  return json.xdr as string;
}

async function submitSignedXdr(
  signedXdr: string,
  apiKey: string,
  network: "testnet" | "mainnet"
): Promise<string> {
  const url = `${DEFINDEX_API}/send?network=${network}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ xdr: signedXdr }),
  });

  const json = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(`Defindex /send error ${response.status}: ${JSON.stringify(json)}`);
  }

  const txHash = json.txHash ?? json.hash ?? json.id;
  if (!txHash) {
    throw new Error(`Defindex /send returned no txHash: ${JSON.stringify(json)}`);
  }
  return txHash as string;
}

// ── Fireblocks raw signing ────────────────────────────────────────────────────

async function rawSignViaFireblocks(txHashBytes: Buffer): Promise<Buffer> {
  const vaultId = config.fireblocks.vaultAccountId;
  const hashHex = txHashBytes.toString("hex");

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
          messages: [{ content: hashHex }],
        },
      } as any,
      note: "Fireblocks PoC — Defindex deposit signature",
    },
  });

  const txId = createRes.data?.id;
  if (!txId) throw new Error("Fireblocks did not return a transaction ID");

  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fireblocks.transactions.getTransaction({ txId });
    const tx = res.data;
    const status = tx?.status ?? "";

    console.log(`    [${attempt}/${POLL_MAX_ATTEMPTS}] Fireblocks raw sign status: ${status}`);

    if (status === TransactionStateEnum.Completed) {
      const signedMessages = (tx as any)?.signedMessages;
      if (!signedMessages?.length) {
        throw new Error("Raw signing completed but signedMessages is empty");
      }
      const sigHex: string = signedMessages[0]?.signature?.fullSig ?? "";
      if (!sigHex) throw new Error("signedMessages[0].signature.fullSig is missing");

      const sigBytes = Buffer.from(sigHex, "hex");
      if (sigBytes.length !== 64) {
        throw new Error(`Expected 64-byte signature, got ${sigBytes.length}`);
      }
      return sigBytes;
    }

    if (TERMINAL_STATUSES.has(status) && status !== TransactionStateEnum.Completed) {
      const sub = (tx as any)?.subStatus ?? "";
      throw new Error(`Raw sign tx ${txId} ended: ${status}${sub ? ` (${sub})` : ""}`);
    }
  }

  throw new Error(`Raw sign tx ${txId} timed out after ${POLL_MAX_ATTEMPTS} attempts`);
}

// ── Fallback: STELLAR_SERVER_KEY ─────────────────────────────────────────────

async function signWithServerKey(txHashBytes: Buffer): Promise<Buffer> {
  const serverKeypair = Keypair.fromSecret(config.stellarServerKey);
  return Buffer.from(serverKeypair.sign(txHashBytes));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full Defindex deposit flow using Fireblocks MPC as the signer.
 *
 * Strategy A (default): Fireblocks raw signing — signs the XDR hash using
 *   the MPC vault's Ed25519 key. The Fireblocks Stellar mainnet address
 *   (GD6OI7...) is the caller and the signer.
 *
 * Strategy B (fallback): If Fireblocks raw signing fails, falls back to
 *   signing with STELLAR_SERVER_KEY. In this case, the caller address must
 *   be the server key's public key (caller parameter changes), and the
 *   Defindex vault must accept that address as the depositor.
 *
 * @returns On-chain Stellar transaction hash
 */
export async function depositToDefindexWithFireblocks(
  vaultAddress: string,
  amountStroops: bigint,
  apiKey: string,
  network: "testnet" | "mainnet" = "mainnet"
): Promise<{ txHash: string; strategy: "fireblocks" | "server-key" }> {
  const callerAddress = FIREBLOCKS_STELLAR_MAINNET_ADDRESS;
  const networkPassphrase = network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

  console.log(`  [Defindex] Requesting deposit XDR from API...`);
  const unsignedXdr = await buildDepositXdr(vaultAddress, callerAddress, amountStroops, apiKey, network);
  console.log(`  [Defindex] Unsigned XDR received (${unsignedXdr.length} chars)`);

  const transaction = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase) as any;
  const txHashBytes = Buffer.from(transaction.hash());

  let signatureBytes: Buffer;
  let strategy: "fireblocks" | "server-key";
  let signerAddress: string;

  try {
    console.log(`  [Defindex] Signing via Fireblocks raw signing (Strategy A)...`);
    signatureBytes = await rawSignViaFireblocks(txHashBytes);
    strategy = "fireblocks";
    signerAddress = FIREBLOCKS_STELLAR_MAINNET_ADDRESS;
  } catch (err: any) {
    console.warn(`  [Defindex] Fireblocks raw signing failed: ${err?.message}`);
    console.warn(`  [Defindex] Falling back to STELLAR_SERVER_KEY (Strategy B)...`);
    signatureBytes = await signWithServerKey(txHashBytes);
    strategy = "server-key";
    signerAddress = Keypair.fromSecret(config.stellarServerKey).publicKey();
  }

  const keypair = Keypair.fromPublicKey(signerAddress);
  transaction.signatures.push(
    new xdr.DecoratedSignature({
      hint: keypair.signatureHint(),
      signature: signatureBytes,
    })
  );

  const signedXdr = transaction.toEnvelope().toXDR("base64");
  console.log(`  [Defindex] Submitting signed XDR (strategy: ${strategy})...`);

  const txHash = await submitSignedXdr(signedXdr, apiKey, network);
  return { txHash, strategy };
}
