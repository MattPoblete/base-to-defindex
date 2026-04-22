import {
  TransactionBuilder,
  Networks,
  Asset,
  Operation,
  Keypair,
  Account,
  xdr,
} from "@stellar/stellar-base";
import {
  TransferPeerPathType,
  TransactionOperation,
  TransactionStateEnum,
} from "@fireblocks/ts-sdk";
import { fireblocks } from "../shared/fireblocks-client.js";
import { config } from "../shared/config.js";

// Fireblocks sandbox Stellar address — same Ed25519 key is valid on mainnet
export const FIREBLOCKS_STELLAR_MAINNET_ADDRESS =
  "GD6OI7IW7QDBGOKPAMIZZZ5J5ZEVL4VUN4J3VCJQR4D53GVT6EJN7D5P";

const STELLAR_HORIZON_MAINNET = "https://horizon.stellar.org";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_ASSET = new Asset("USDC", USDC_ISSUER);

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

type HorizonAccount = {
  sequence: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }>;
};

// ── Horizon helpers ───────────────────────────────────────────────────────────

async function fetchAccount(address: string): Promise<HorizonAccount | null> {
  const res = await fetch(`${STELLAR_HORIZON_MAINNET}/accounts/${address}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
  return (await res.json()) as HorizonAccount;
}

async function submitToMainnet(envelopeXdr: string): Promise<string> {
  const res = await fetch(`${STELLAR_HORIZON_MAINNET}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `tx=${encodeURIComponent(envelopeXdr)}`,
  });
  const data = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(
      `Horizon submission failed: ${JSON.stringify(data?.extras?.result_codes ?? data)}`
    );
  }
  return data.hash as string;
}

// ── Fireblocks raw signing helper ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Signs a 32-byte hash using Fireblocks raw signing (TransactionOperation.Raw).
 * Returns a 64-byte Ed25519 signature as a Buffer.
 */
async function rawSignWithFireblocks(txHashBytes: Buffer): Promise<Buffer> {
  const vaultId = config.fireblocks.vaultAccountId;
  const txHashHex = txHashBytes.toString("hex");

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
          messages: [{ content: txHashHex }],
        },
      } as any,
      note: "Fireblocks PoC — Stellar mainnet setup",
    },
  });

  const txId = createRes.data?.id;
  if (!txId) throw new Error("Fireblocks did not return a transaction ID");

  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fireblocks.transactions.getTransaction({ txId });
    const tx = res.data;
    const status = tx?.status ?? "";

    console.log(`    [${attempt}/${POLL_MAX_ATTEMPTS}] Raw sign status: ${status}`);

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

  throw new Error(`Raw sign tx ${txId} did not complete after ${POLL_MAX_ATTEMPTS} attempts`);
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Ensures the Fireblocks Stellar address exists on mainnet with at least
 * `minimumXlm` XLM. Funds it from STELLAR_SERVER_KEY if needed.
 */
export async function ensureMainnetXlmFunding(minimumXlm = 3): Promise<void> {
  const account = await fetchAccount(FIREBLOCKS_STELLAR_MAINNET_ADDRESS);
  const xlmBalance = account
    ? parseFloat(account.balances.find((b) => b.asset_type === "native")?.balance ?? "0")
    : 0;

  if (xlmBalance >= minimumXlm) {
    console.log(`  XLM balance: ${xlmBalance} ✅`);
    return;
  }

  console.log(
    `  XLM balance: ${xlmBalance} — below ${minimumXlm} XLM minimum. Funding from server key...`
  );

  if (!config.stellarServerKey) {
    throw new Error("STELLAR_SERVER_KEY is not set. Cannot fund Fireblocks Stellar address.");
  }

  const serverKeypair = Keypair.fromSecret(config.stellarServerKey);
  const serverAccount = await fetchAccount(serverKeypair.publicKey());
  if (!serverAccount) {
    throw new Error(`Server Stellar account (${serverKeypair.publicKey()}) does not exist on mainnet.`);
  }

  const sendAmount = String(minimumXlm + 1);

  const operation = account
    ? Operation.payment({
        destination: FIREBLOCKS_STELLAR_MAINNET_ADDRESS,
        asset: Asset.native(),
        amount: sendAmount,
      })
    : Operation.createAccount({
        destination: FIREBLOCKS_STELLAR_MAINNET_ADDRESS,
        startingBalance: sendAmount,
      });

  const tx = new TransactionBuilder(new Account(serverKeypair.publicKey(), serverAccount.sequence), {
    fee: "100",
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  tx.sign(serverKeypair);
  const txHash = await submitToMainnet(tx.toEnvelope().toXDR("base64"));
  console.log(`  XLM funded! txHash: ${txHash}`);
}

/**
 * Ensures the Fireblocks Stellar mainnet address has a USDC trustline.
 * Builds the changeTrust XDR, signs it via Fireblocks raw signing,
 * and broadcasts to Horizon mainnet.
 */
export async function ensureMainnetUsdcTrustline(): Promise<void> {
  const account = await fetchAccount(FIREBLOCKS_STELLAR_MAINNET_ADDRESS);
  if (!account) {
    throw new Error(
      `Fireblocks Stellar address (${FIREBLOCKS_STELLAR_MAINNET_ADDRESS}) does not exist on mainnet. ` +
        "Call ensureMainnetXlmFunding() first."
    );
  }

  const hasUsdcTrustline = account.balances.some(
    (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
  );

  if (hasUsdcTrustline) {
    console.log(`  USDC trustline: already exists ✅`);
    return;
  }

  console.log(`  USDC trustline: missing — creating via Fireblocks raw signing...`);

  const stellarAccount = new Account(FIREBLOCKS_STELLAR_MAINNET_ADDRESS, account.sequence);
  const tx = new TransactionBuilder(stellarAccount, {
    fee: "100",
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(30)
    .build();

  const signatureBytes = await rawSignWithFireblocks(Buffer.from(tx.hash()));

  const keypair = Keypair.fromPublicKey(FIREBLOCKS_STELLAR_MAINNET_ADDRESS);
  tx.signatures.push(
    new xdr.DecoratedSignature({
      hint: keypair.signatureHint(),
      signature: signatureBytes,
    })
  );

  const txHash = await submitToMainnet(tx.toEnvelope().toXDR("base64"));
  console.log(`  USDC trustline created! txHash: ${txHash}`);
}
