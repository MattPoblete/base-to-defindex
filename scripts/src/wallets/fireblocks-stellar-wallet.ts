import {
  TransferPeerPathType,
  TransactionOperation,
  TransactionStateEnum,
} from "@fireblocks/ts-sdk";
import { fireblocks } from "../shared/fireblocks-client.js";
import { config } from "../shared/config.js";

// Stellar Testnet asset ID in Fireblocks sandbox
export const XLM_TEST_ASSET_ID = "XLM_TEST";
const STELLAR_HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
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

/**
 * Activates the XLM_TEST asset on the vault and returns the Stellar address.
 */
export async function getOrCreateStellarVault(): Promise<{ vaultId: string; address: string }> {
  const vaultId = config.fireblocks.vaultAccountId;

  try {
    await fireblocks.vaults.createVaultAccountAsset({
      vaultAccountId: vaultId,
      assetId: XLM_TEST_ASSET_ID,
    });
  } catch (err: any) {
    if (!err?.message?.includes("409") && !err?.message?.toLowerCase().includes("already")) {
      throw err;
    }
  }

  const addrRes = await fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
    vaultAccountId: vaultId,
    assetId: XLM_TEST_ASSET_ID,
  });
  const address = addrRes.data?.addresses?.[0]?.address ?? "";
  return { vaultId, address };
}

/**
 * Fetches the XLM balance for a Stellar address via Horizon testnet.
 */
export async function getStellarBalance(address: string): Promise<string> {
  const res = await fetch(`${STELLAR_HORIZON_TESTNET}/accounts/${address}`);
  if (res.status === 404) return "0 (account not funded yet)";
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);

  const data = (await res.json()) as {
    balances: { asset_type: string; balance: string }[];
  };
  const native = data.balances.find((b) => b.asset_type === "native");
  return native ? native.balance : "0";
}

/**
 * Sends an XLM payment from the Fireblocks vault to a destination address.
 * Fireblocks signs and broadcasts on Stellar Testnet.
 */
export async function sendXlmPayment(
  vaultId: string,
  toAddress: string,
  amountXlm: string
): Promise<string> {
  const createRes = await fireblocks.transactions.createTransaction({
    transactionRequest: {
      assetId: XLM_TEST_ASSET_ID,
      operation: TransactionOperation.Transfer,
      source: {
        type: TransferPeerPathType.VaultAccount,
        id: vaultId,
      },
      destination: {
        type: TransferPeerPathType.OneTimeAddress,
        oneTimeAddress: { address: toAddress },
      },
      amount: amountXlm,
      note: "Fireblocks PoC — Stellar Testnet XLM payment",
    },
  });

  const txId = createRes.data?.id;
  if (!txId) throw new Error("Fireblocks did not return a transaction ID");

  return pollTransactionHash(txId);
}

async function pollTransactionHash(txId: string): Promise<string> {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fireblocks.transactions.getTransaction({ txId });
    const tx = res.data;
    const status = tx?.status ?? "";

    console.log(`  [${attempt}/${POLL_MAX_ATTEMPTS}] Status: ${status}`);

    if (status === TransactionStateEnum.Completed) {
      const hash = tx?.txHash;
      if (!hash) throw new Error("Transaction completed but no txHash returned");
      return hash;
    }

    if (status && TERMINAL_STATUSES.has(status) && status !== TransactionStateEnum.Completed) {
      const subStatus = (res.data as any)?.subStatus ?? "";
      throw new Error(`Transaction ${txId} ended with status: ${status}${subStatus ? ` (${subStatus})` : ""}`);
    }
  }
  throw new Error(`Transaction ${txId} did not complete after ${POLL_MAX_ATTEMPTS} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
