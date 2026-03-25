import {
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
} from "@stellar/stellar-base";
import { privy, buildAuthContext } from "../shared/privy-client.js";

const DEFINDEX_API = "https://api.defindex.io";
const DEFINDEX_SLIPPAGE_BPS = 50; // 0.5%

/**
 * Calls the Defindex API to build an unsigned deposit XDR for the given vault.
 * @param vaultAddress  Soroban contract address of the vault
 * @param callerAddress Stellar address of the depositor (Privy wallet)
 * @param amountStroops Amount in stroops (7 decimals: 1 XLM/USDC = 10_000_000)
 * @param apiKey        Defindex API Bearer token
 * @param network       "testnet" | "mainnet"
 * @returns Unsigned transaction XDR (base64)
 */
async function buildDepositXdr(
  vaultAddress: string,
  callerAddress: string,
  amountStroops: bigint,
  apiKey: string,
  network: "testnet" | "mainnet"
): Promise<string> {
  const url = `${DEFINDEX_API}/vault/${vaultAddress}/deposit?network=${network}`;
  console.log(`  [Defindex] Building deposit XDR via API...`);
  console.log('params')
  console.log({
    amounts: [amountStroops.toString()],
    caller: callerAddress,
    invest: true,
    slippageBps: DEFINDEX_SLIPPAGE_BPS,
  });
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
    throw new Error(
      `Defindex API error ${response.status}: ${JSON.stringify(json)}`
    );
  }

  if (!json.xdr) {
    throw new Error(
      `Defindex API returned no XDR: ${JSON.stringify(json)}`
    );
  }

  return json.xdr as string;
}

/**
 * Submits a signed XDR to the Defindex /send endpoint.
 * @returns Transaction hash
 */
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
    throw new Error(
      `Defindex /send error ${response.status}: ${JSON.stringify(json)}`
    );
  }

  const txHash = json.txHash ?? json.hash ?? json.id;
  if (!txHash) {
    throw new Error(
      `Defindex /send returned no txHash: ${JSON.stringify(json)}`
    );
  }

  return txHash as string;
}

/**
 * Full deposit flow:
 *  1. Request unsigned XDR from Defindex API
 *  2. Hash the transaction
 *  3. Raw-sign the hash via Privy (Ed25519, Tier 2)
 *  4. Attach the DecoratedSignature to the envelope
 *  5. Submit to Defindex /send
 *
 * @returns On-chain transaction hash
 */
export async function depositToDefindexVault(
  walletId: string,
  fromAddress: string,
  vaultAddress: string,
  amountStroops: bigint,
  apiKey: string,
  network: "testnet" | "mainnet" = "testnet"
): Promise<string> {
  // [1] Build unsigned XDR via Defindex API
  console.log(`  [Defindex] Requesting deposit XDR from API...`);
  const unsignedXdr = await buildDepositXdr(
    vaultAddress,
    fromAddress,
    amountStroops,
    apiKey,
    network
  );
  console.log(`  [Defindex] Unsigned XDR received (${unsignedXdr.length} chars)`);

  // [2] Parse the XDR into a Transaction object
  const networkPassphrase =
    network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
  const transaction = TransactionBuilder.fromXDR(
    unsignedXdr,
    networkPassphrase
  ) as ReturnType<typeof TransactionBuilder.fromXDR>;

  // [3] Hash the transaction for signing
  const txHashHex = "0x" + Buffer.from((transaction as any).hash()).toString("hex");
  console.log(`  [Defindex] Signing transaction hash: ${txHashHex}`);

  // [4] Raw-sign via Privy (Tier 2 — Ed25519, signing only)
  const signResult = await privy.wallets().rawSign(walletId, {
    params: { hash: txHashHex },
    authorization_context: buildAuthContext(),
  } as any);

  const signatureHex: string =
    (signResult as any)?.data?.signature ??
    (signResult as any)?.signature ??
    (signResult as unknown as string);

  const signatureBytes = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");

  // [5] Attach the DecoratedSignature to the transaction envelope
  const keypair = Keypair.fromPublicKey(fromAddress);
  const decoratedSignature = new xdr.DecoratedSignature({
    hint: keypair.signatureHint(),
    signature: signatureBytes,
  });
  (transaction as any).signatures.push(decoratedSignature);

  // [6] Submit signed XDR to Defindex /send
  const signedXdr = (transaction as any).toEnvelope().toXDR("base64");
  console.log(`  [Defindex] Submitting signed XDR...`);

  return submitSignedXdr(signedXdr, apiKey, network);
}
