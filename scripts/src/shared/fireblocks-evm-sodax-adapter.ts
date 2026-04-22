import {
  IEvmWalletProvider,
  EvmRawTransaction,
  EvmRawTransactionReceipt,
  Address,
  Hash,
} from "@sodax/types";
import {
  TransferPeerPathType,
  TransactionOperation,
  TransactionStateEnum,
} from "@fireblocks/ts-sdk";
import { ethers } from "ethers";
import { fireblocks } from "./fireblocks-client.js";
import { config } from "./config.js";

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 60;

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

/**
 * Production EVM wallet adapter using Fireblocks ContractCall.
 * Implements IEvmWalletProvider so it plugs into SodaxBridgeService.
 *
 * NOTE: This adapter is not executed in the sandbox PoC (sandbox asset IDs
 * differ from Base mainnet). It is included here as a complete production
 * implementation for partners who integrate Fireblocks with Defindex.
 *
 * To activate: set FIREBLOCKS_BASE_PATH to the production Fireblocks API and
 * use asset ID "ETH_BASE" (or the partner's actual Base asset ID).
 */
export class FireblocksEvmSodaxAdapter implements IEvmWalletProvider {
  constructor(
    private vaultId: string,
    private walletAddress: string,
    private assetId: string,
    private provider: ethers.JsonRpcProvider
  ) {}

  async getWalletAddress(): Promise<Address> {
    return this.walletAddress as Address;
  }

  async sendTransaction(evmRawTx: EvmRawTransaction): Promise<Hash> {
    console.log(`[FireblocksEvmAdapter] Sending ContractCall to ${evmRawTx.to}...`);

    const createRes = await fireblocks.transactions.createTransaction({
      transactionRequest: {
        assetId: this.assetId,
        operation: TransactionOperation.ContractCall,
        source: {
          type: TransferPeerPathType.VaultAccount,
          id: this.vaultId,
        },
        destination: {
          type: TransferPeerPathType.OneTimeAddress,
          oneTimeAddress: { address: evmRawTx.to },
        },
        amount: evmRawTx.value != null
          ? ethers.formatEther(BigInt(evmRawTx.value as any))
          : "0",
        extraParameters: {
          contractCallData: evmRawTx.data,
        } as any,
        note: "Fireblocks PoC — Sodax bridge EVM ContractCall",
      },
    });

    const txId = createRes.data?.id;
    if (!txId) throw new Error("Fireblocks did not return a transaction ID");

    const txHash = await this.pollForTxHash(txId);
    console.log(`[FireblocksEvmAdapter] Sent! Hash: ${txHash}`);
    return txHash as Hash;
  }

  async waitForTransactionReceipt(txHash: Hash): Promise<EvmRawTransactionReceipt> {
    console.log(`[FireblocksEvmAdapter] Waiting for receipt: ${txHash}...`);

    const receipt = await this.provider.waitForTransaction(txHash);
    if (!receipt) throw new Error(`Receipt not found for ${txHash}`);

    return {
      transactionHash: receipt.hash,
      transactionIndex: ethers.toQuantity(receipt.index),
      blockHash: receipt.blockHash,
      blockNumber: ethers.toQuantity(receipt.blockNumber),
      from: receipt.from,
      to: receipt.to,
      cumulativeGasUsed: ethers.toQuantity(receipt.cumulativeGasUsed),
      gasUsed: ethers.toQuantity(receipt.gasUsed),
      contractAddress: receipt.contractAddress,
      logs: receipt.logs.map((log) => ({
        address: log.address as Address,
        topics: log.topics as [Hash, ...Hash[]] | [],
        data: log.data as Hash,
        blockHash: log.blockHash as Hash,
        blockNumber: ethers.toQuantity(log.blockNumber) as Address,
        logIndex: ethers.toQuantity(log.index) as Hash,
        transactionHash: log.transactionHash as Hash,
        transactionIndex: ethers.toQuantity(log.transactionIndex) as Hash,
        removed: log.removed,
      })),
      logsBloom: receipt.logsBloom,
      status: ethers.toQuantity(receipt.status ?? 0),
      type: ethers.toQuantity(receipt.type ?? 0),
      effectiveGasPrice: ethers.toQuantity(receipt.gasPrice ?? 0),
    } as EvmRawTransactionReceipt;
  }

  private async pollForTxHash(txId: string): Promise<string> {
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

      if (TERMINAL_STATUSES.has(status) && status !== TransactionStateEnum.Completed) {
        const sub = (tx as any)?.subStatus ?? "";
        throw new Error(`Transaction ${txId} ended: ${status}${sub ? ` (${sub})` : ""}`);
      }
    }
    throw new Error(`Transaction ${txId} timed out after ${POLL_MAX_ATTEMPTS} attempts`);
  }
}
