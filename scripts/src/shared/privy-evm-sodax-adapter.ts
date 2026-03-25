import {
  IEvmWalletProvider,
  EvmRawTransaction,
  EvmRawTransactionReceipt,
  Address,
  Hash,
} from "@sodax/types";
import { ethers } from "ethers";
import { privy, buildAuthContext } from "./privy-client.js";

/**
 * Adapter to use Privy EVM wallets with the Sodax SDK.
 * Implements IEvmWalletProvider (from @sodax/types) using Privy's Tier 3
 * sendTransaction — mirrors CrossmintEvmSodaxAdapter but delegates signing
 * to the Privy TEE via the Authorization Key pattern.
 */
export class PrivyEvmSodaxAdapter implements IEvmWalletProvider {
  constructor(
    private walletId: string,
    private walletAddress: string,
    private caip2: string,
    private provider: ethers.JsonRpcProvider
  ) {}

  async getWalletAddress(): Promise<Address> {
    return this.walletAddress as Address;
  }

  async sendTransaction(evmRawTx: EvmRawTransaction): Promise<Hash> {
    console.log(`[PrivyAdapter] Sending transaction to ${evmRawTx.to}...`);

    const response = await privy
      .wallets()
      .ethereum()
      .sendTransaction(this.walletId, {
        caip2: this.caip2,
        params: {
          transaction: {
            to: evmRawTx.to,
            data: evmRawTx.data,
            value: evmRawTx.value,
          },
        },
        authorization_context: buildAuthContext(),
      });

    const txHash =
      (response as any).hash ?? (response as any).transaction_hash;

    if (!txHash) {
      throw new Error(
        `Privy sendTransaction returned no hash: ${JSON.stringify(response)}`
      );
    }

    console.log(`[PrivyAdapter] Transaction sent! Hash: ${txHash}`);
    return txHash as Hash;
  }

  async waitForTransactionReceipt(txHash: Hash): Promise<EvmRawTransactionReceipt> {
    console.log(`[PrivyAdapter] Waiting for receipt: ${txHash}...`);

    const receipt = await this.provider.waitForTransaction(txHash);

    if (!receipt) {
      throw new Error(`Transaction receipt not found for hash: ${txHash}`);
    }

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
}
