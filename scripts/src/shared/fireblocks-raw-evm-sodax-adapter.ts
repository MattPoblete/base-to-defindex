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

const BASE_CHAIN_ID = 8453;
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

/**
 * EVM adapter that signs Base mainnet transactions using Fireblocks raw signing.
 *
 * Uses TransactionOperation.Raw with ETH_TEST5 (sandbox secp256k1 key) to sign
 * EIP-1559 transaction hashes, then broadcasts directly to Base mainnet.
 * The secp256k1 key is chain-agnostic — the same vault key signs on any EVM chain.
 *
 * Fireblocks raw signing returns { r, s, v } where v is already yParity (0 or 1).
 */
export class FireblocksRawEvmSodaxAdapter implements IEvmWalletProvider {
  constructor(
    private vaultId: string,
    private vaultAddress: string,
    private provider: ethers.JsonRpcProvider
  ) {}

  async getWalletAddress(): Promise<Address> {
    return this.vaultAddress as Address;
  }

  async sendTransaction(evmRawTx: EvmRawTransaction): Promise<Hash> {
    console.log(`[FireblocksRawEvm] Signing tx to ${evmRawTx.to} via Fireblocks raw signing...`);

    // Build unsigned EIP-1559 transaction
    const [nonce, feeData, gasEstimate] = await Promise.all([
      this.provider.getTransactionCount(this.vaultAddress, "pending"),
      this.provider.getFeeData(),
      this.provider.estimateGas({
        from: this.vaultAddress,
        to: evmRawTx.to,
        data: evmRawTx.data as string | undefined,
        value: evmRawTx.value != null ? BigInt(evmRawTx.value as any) : undefined,
      }),
    ]);

    const tx = ethers.Transaction.from({
      type: 2,
      chainId: BASE_CHAIN_ID,
      nonce,
      to: evmRawTx.to,
      data: (evmRawTx.data as string | undefined) ?? "0x",
      value: evmRawTx.value != null ? BigInt(evmRawTx.value as any) : 0n,
      gasLimit: (gasEstimate * 120n) / 100n, // 20% buffer
      maxFeePerGas: feeData.maxFeePerGas ?? ethers.parseUnits("2", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? ethers.parseUnits("1", "gwei"),
    });

    // Get the signing hash (keccak256 of RLP-encoded unsigned tx)
    const hashHex = tx.unsignedHash.replace(/^0x/, "");

    // Raw sign via Fireblocks
    const sigBytes = await this.rawSignViaFireblocks(hashHex);

    // Attach signature and serialize
    tx.signature = ethers.Signature.from({
      r: "0x" + sigBytes.r,
      s: "0x" + sigBytes.s,
      v: sigBytes.v + 27, // ethers.Signature.from expects 27/28
    });

    const txHash = tx.hash;
    if (!txHash) throw new Error("Failed to compute transaction hash after signing");

    console.log(`[FireblocksRawEvm] Broadcasting to Base mainnet...`);
    await this.provider.broadcastTransaction(tx.serialized);
    console.log(`[FireblocksRawEvm] Sent! Hash: ${txHash}`);

    return txHash as Hash;
  }

  async waitForTransactionReceipt(txHash: Hash): Promise<EvmRawTransactionReceipt> {
    console.log(`[FireblocksRawEvm] Waiting for receipt: ${txHash}...`);

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

  private async rawSignViaFireblocks(hashHex: string): Promise<{ r: string; s: string; v: number }> {
    const createRes = await fireblocks.transactions.createTransaction({
      transactionRequest: {
        operation: TransactionOperation.Raw,
        assetId: "ETH_TEST5",
        source: {
          type: TransferPeerPathType.VaultAccount,
          id: this.vaultId,
        },
        extraParameters: {
          rawMessageData: {
            messages: [{ content: hashHex }],
          },
        } as any,
        note: "Fireblocks PoC — Base mainnet EVM transaction",
      },
    });

    const txId = createRes.data?.id;
    if (!txId) throw new Error("Fireblocks did not return a transaction ID");

    for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const res = await fireblocks.transactions.getTransaction({ txId });
      const fbTx = res.data;
      const status = fbTx?.status ?? "";

      console.log(`  [${attempt}/${POLL_MAX_ATTEMPTS}] Fireblocks sign status: ${status}`);

      if (status === TransactionStateEnum.Completed) {
        const signedMessages = (fbTx as any)?.signedMessages;
        if (!signedMessages?.length) throw new Error("signedMessages is empty");

        const sig = signedMessages[0]?.signature;
        if (!sig?.r || !sig?.s) throw new Error(`Unexpected signature format: ${JSON.stringify(sig)}`);

        const v = typeof sig.v === "number" ? sig.v : parseInt(sig.v, 10);
        return { r: sig.r, s: sig.s, v };
      }

      if (TERMINAL_STATUSES.has(status) && status !== TransactionStateEnum.Completed) {
        const sub = (fbTx as any)?.subStatus ?? "";
        throw new Error(`Raw sign tx ${txId} ended: ${status}${sub ? ` (${sub})` : ""}`);
      }
    }

    throw new Error(`Raw sign tx ${txId} timed out after ${POLL_MAX_ATTEMPTS} attempts`);
  }
}
