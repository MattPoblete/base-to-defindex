import { ethers } from "ethers";
import {
  TransferPeerPathType,
  TransactionOperation,
  TransactionStateEnum,
} from "@fireblocks/ts-sdk";
import { fireblocks } from "../shared/fireblocks-client.js";
import { config } from "../shared/config.js";

// Ethereum Sepolia asset ID in Fireblocks sandbox
export const EVM_ASSET_ID = "ETH_TEST5";
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const SEPOLIA_CHAIN_ID = 11155111;
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
 * Returns the vault account and ensures the Ethereum Sepolia asset is activated.
 */
export async function getOrCreateEvmVault(): Promise<{ vaultId: string; address: string }> {
  const vaultId = config.fireblocks.vaultAccountId;

  try {
    await fireblocks.vaults.createVaultAccountAsset({
      vaultAccountId: vaultId,
      assetId: EVM_ASSET_ID,
    });
  } catch (err: any) {
    if (!err?.message?.includes("409") && !err?.message?.toLowerCase().includes("already")) {
      throw err;
    }
  }

  const addrRes = await fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
    vaultAccountId: vaultId,
    assetId: EVM_ASSET_ID,
  });
  const address = addrRes.data?.addresses?.[0]?.address ?? "";
  return { vaultId, address };
}

/**
 * Fetches the ETH balance on Ethereum Sepolia directly from the chain.
 */
export async function getEvmBalance(address: string): Promise<string> {
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC, { chainId: SEPOLIA_CHAIN_ID, name: "sepolia" });
  const balanceWei = await provider.getBalance(address);
  return ethers.formatEther(balanceWei);
}

/**
 * Forces Fireblocks to rescan the blockchain and sync the vault's ETH balance.
 * Must be called after receiving external funds (e.g. from a faucet) before
 * attempting to send, otherwise Fireblocks will reject with INSUFFICIENT_FUNDS.
 */
export async function refreshFireblocksBalance(vaultId: string): Promise<string> {
  const res = await fireblocks.vaults.updateVaultAccountAssetBalance({
    vaultAccountId: vaultId,
    assetId: EVM_ASSET_ID,
  });
  return res.data?.available ?? "0";
}

/**
 * Sends a test transaction from the Fireblocks vault on Ethereum Sepolia.
 * Returns the on-chain transaction hash.
 */
export async function sendEvmTransaction(
  vaultId: string,
  toAddress: string
): Promise<string> {
  const createRes = await fireblocks.transactions.createTransaction({
    transactionRequest: {
      assetId: EVM_ASSET_ID,
      operation: TransactionOperation.Transfer,
      source: {
        type: TransferPeerPathType.VaultAccount,
        id: vaultId,
      },
      destination: {
        type: TransferPeerPathType.OneTimeAddress,
        oneTimeAddress: { address: toAddress },
      },
      amount: "0.00001",
      note: "Fireblocks PoC — Ethereum Sepolia test transaction",
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
