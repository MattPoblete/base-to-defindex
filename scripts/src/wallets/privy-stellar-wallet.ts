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
import { config } from "../shared/config.js";

const STELLAR_HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const STELLAR_HORIZON_MAINNET = "https://horizon.stellar.org";
const STELLAR_WALLET_IDEMPOTENCY_KEY = "privy-poc-stellar-wallet-v1";

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_ASSET = new Asset("USDC", USDC_ISSUER);

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

// ─── Mainnet helpers ─────────────────────────────────────────────────────────

type HorizonAccountResponse = {
  sequence: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }>;
};

/**
 * Fetches account data from Horizon mainnet.
 * Returns null if the account does not exist (404).
 */
async function fetchMainnetAccount(
  address: string
): Promise<HorizonAccountResponse | null> {
  const response = await fetch(`${STELLAR_HORIZON_MAINNET}/accounts/${address}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Horizon error: ${response.status}`);
  return (await response.json()) as HorizonAccountResponse;
}

/**
 * Submits a signed XDR to Horizon mainnet.
 */
async function submitToMainnetHorizon(envelopeXdr: string): Promise<string> {
  const response = await fetch(`${STELLAR_HORIZON_MAINNET}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `tx=${encodeURIComponent(envelopeXdr)}`,
  });
  const data = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(
      `Horizon submission failed: ${JSON.stringify(data?.extras?.result_codes ?? data)}`
    );
  }
  return data.hash as string;
}

/**
 * Ensures the Privy Stellar wallet has at least `minimumXlm` XLM on mainnet.
 * If the account does not exist or has insufficient balance, funds it from
 * the server's STELLAR_SERVER_KEY. Throws if the server key is also unfunded.
 */
export async function ensureXlmFunding(
  privyAddress: string,
  minimumXlm: number = 3
): Promise<void> {
  const account = await fetchMainnetAccount(privyAddress);
  const xlmBalance = account
    ? parseFloat(
        account.balances.find((b) => b.asset_type === "native")?.balance ?? "0"
      )
    : 0;

  if (xlmBalance >= minimumXlm) {
    console.log(`  XLM balance: ${xlmBalance} ✅`);
    return;
  }

  console.log(
    `  XLM balance: ${xlmBalance} — below ${minimumXlm} XLM minimum. Sponsoring from server key...`
  );

  if (!config.stellarServerKey) {
    throw new Error(
      "STELLAR_SERVER_KEY is not set. Cannot sponsor XLM for the Privy Stellar wallet."
    );
  }

  const serverKeypair = Keypair.fromSecret(config.stellarServerKey);

  const serverAccount = await fetchMainnetAccount(serverKeypair.publicKey());
  if (!serverAccount) {
    throw new Error(
      `Server Stellar account (${serverKeypair.publicKey()}) does not exist on mainnet. Please fund it first.`
    );
  }

  const serverXlm = parseFloat(
    serverAccount.balances.find((b) => b.asset_type === "native")?.balance ?? "0"
  );
  const sendAmount = String(minimumXlm + 1); // extra buffer
  if (serverXlm < parseFloat(sendAmount) + 1) {
    throw new Error(
      `Server key has only ${serverXlm} XLM — not enough to sponsor ${sendAmount} XLM.`
    );
  }

  const serverStellarAccount = new Account(
    serverKeypair.publicKey(),
    serverAccount.sequence
  );

  const operation = account
    ? Operation.payment({
        destination: privyAddress,
        asset: Asset.native(),
        amount: sendAmount,
      })
    : Operation.createAccount({
        destination: privyAddress,
        startingBalance: sendAmount,
      });

  const tx = new TransactionBuilder(serverStellarAccount, {
    fee: "100",
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  tx.sign(serverKeypair);
  const txHash = await submitToMainnetHorizon(tx.toEnvelope().toXDR("base64"));
  console.log(`  XLM sponsored! txHash: ${txHash}`);
}

/**
 * Ensures the Privy Stellar wallet has a USDC trustline on mainnet.
 * If missing, builds a changeTrust transaction, raw-signs it via Privy,
 * and broadcasts to Horizon mainnet.
 */
export async function ensureUsdcTrustline(
  walletId: string,
  address: string
): Promise<void> {
  const account = await fetchMainnetAccount(address);
  if (!account) {
    throw new Error(
      `Stellar account ${address} does not exist on mainnet. Fund it first.`
    );
  }

  const hasUsdcTrustline = account.balances.some(
    (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
  );

  if (hasUsdcTrustline) {
    console.log(`  USDC trustline: already exists ✅`);
    return;
  }

  console.log(`  USDC trustline: not found — creating...`);

  const stellarAccount = new Account(address, account.sequence);

  const tx = new TransactionBuilder(stellarAccount, {
    fee: "100",
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(30)
    .build();

  const txHashHex = "0x" + Buffer.from(tx.hash()).toString("hex");

  const signResult = await privy.wallets().rawSign(walletId, {
    params: { hash: txHashHex },
    authorization_context: buildAuthContext(),
  } as any);

  const signatureHex: string =
    (signResult as any)?.data?.signature ??
    (signResult as any)?.signature ??
    (signResult as unknown as string);

  const signatureBytes = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");
  const keypair = Keypair.fromPublicKey(address);
  tx.signatures.push(
    new xdr.DecoratedSignature({ hint: keypair.signatureHint(), signature: signatureBytes })
  );

  const txHash = await submitToMainnetHorizon(tx.toEnvelope().toXDR("base64"));
  console.log(`  USDC trustline created! txHash: ${txHash}`);
}
