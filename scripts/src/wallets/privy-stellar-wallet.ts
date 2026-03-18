import {
  TransactionBuilder,
  Networks,
  Asset,
  Operation,
  Keypair,
  Account,
  xdr,
} from "@stellar/stellar-base";
import { privy, buildAuthContext, authorizationPublicKey } from "../shared/privy-client.js";

const STELLAR_HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const STELLAR_WALLET_IDEMPOTENCY_KEY = "privy-poc-stellar-wallet-v1";

/**
 * Creates a Stellar wallet owned by the stored authorization key,
 * or retrieves the existing one via idempotency_key.
 */
export async function getOrCreateStellarWallet() {
  const wallet = await privy.wallets().create({
    chain_type: "stellar",
    owner: { public_key: authorizationPublicKey },
    idempotency_key: STELLAR_WALLET_IDEMPOTENCY_KEY,
  });

  return wallet;
}

/**
 * Fetches the XLM balance for a Stellar address via Horizon testnet.
 */
export async function getStellarBalance(address: string): Promise<string> {
  const response = await fetch(
    `${STELLAR_HORIZON_TESTNET}/accounts/${address}`
  );

  if (!response.ok) {
    if (response.status === 404) return "0 (account not funded yet)";
    throw new Error(`Horizon error: ${response.status}`);
  }

  const data = (await response.json()) as { balances: { asset_type: string; balance: string }[] };
  const nativeBalance = data.balances.find((b) => b.asset_type === "native");
  return nativeBalance ? nativeBalance.balance : "0";
}

/**
 * Fetches the account sequence number from Horizon (needed to build a transaction).
 */
async function fetchAccountSequence(address: string): Promise<string> {
  const response = await fetch(
    `${STELLAR_HORIZON_TESTNET}/accounts/${address}`
  );
  if (!response.ok) {
    throw new Error(
      `Cannot fetch account from Horizon (status ${response.status}). Is the wallet funded?`
    );
  }
  const data = (await response.json()) as { sequence: string };
  return data.sequence;
}

/**
 * Builds a Stellar payment transaction, raw-signs it via Privy,
 * attaches the signature, and broadcasts to Horizon testnet.
 *
 * Privy wallets use the Ed25519 curve (same as Stellar). The rawSign
 * endpoint returns a hex-encoded 64-byte signature that we attach
 * as a DecoratedSignature to the transaction envelope.
 *
 * @returns Transaction hash
 */
export async function buildSignAndBroadcastStellarTx(
  walletId: string,
  fromAddress: string,
  toAddress: string,
  amountXlm: string
): Promise<string> {
  // [1] Fetch account sequence from Horizon
  const sequence = await fetchAccountSequence(fromAddress);
  const account = new Account(fromAddress, sequence);

  // [2] Build the transaction (testnet, 30-second timeout)
  const transaction = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: toAddress,
        asset: Asset.native(),
        amount: amountXlm,
      })
    )
    .setTimeout(30)
    .build();

  // [3] Hash the transaction (32-byte hash) and convert to hex for Privy
  const txHash = transaction.hash();
  const txHashHex = "0x" + Buffer.from(txHash).toString("hex");

  // [4] Raw-sign the transaction hash via Privy (Tier 2 — signing only)
  const signResult = await privy.wallets().rawSign(walletId, {
    params: { hash: txHashHex },
    authorization_context: buildAuthContext(),
  } as any);

  // The Node SDK returns the signature string (0x-prefixed hex, 64 bytes)
  const signatureHex: string = (signResult as any)?.data?.signature
    ?? (signResult as any)?.signature
    ?? (signResult as unknown as string);

  const signatureBytes = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");

  // [5] Attach the DecoratedSignature to the transaction envelope
  const keypair = Keypair.fromPublicKey(fromAddress);
  const hint = keypair.signatureHint();
  const decoratedSignature = new xdr.DecoratedSignature({
    hint,
    signature: signatureBytes,
  });
  transaction.signatures.push(decoratedSignature);

  // [6] Submit the signed XDR envelope to Horizon
  const envelopeXdr = transaction.toEnvelope().toXDR("base64");
  const submitResponse = await fetch(
    `${STELLAR_HORIZON_TESTNET}/transactions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `tx=${encodeURIComponent(envelopeXdr)}`,
    }
  );

  const submitData = (await submitResponse.json()) as any;

  if (!submitResponse.ok) {
    const extras = submitData?.extras?.result_codes;
    throw new Error(
      `Horizon submission failed: ${JSON.stringify(extras ?? submitData)}`
    );
  }

  return submitData.hash as string;
}
