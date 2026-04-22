import {
  IEvmWalletProvider,
  EvmRawTransaction,
  EvmRawTransactionReceipt,
  Address,
  Hash,
} from "@sodax/types";
import { ethers } from "ethers";

/**
 * Stand-in EVM wallet adapter using an ethers Wallet (EVM_PRIVATE_KEY).
 * Implements IEvmWalletProvider so it plugs into SodaxBridgeService.
 *
 * This is used for sandbox PoC runs because the Fireblocks sandbox only
 * covers testnet assets. In production, replace with FireblocksEvmSodaxAdapter.
 */
export class EthersEvmSodaxAdapter implements IEvmWalletProvider {
  private wallet: ethers.Wallet;

  constructor(privateKey: string, private provider: ethers.JsonRpcProvider) {
    this.wallet = new ethers.Wallet(privateKey, provider);
  }

  async getWalletAddress(): Promise<Address> {
    return this.wallet.address as Address;
  }

  async sendTransaction(evmRawTx: EvmRawTransaction): Promise<Hash> {
    console.log(`[EthersAdapter] Sending tx to ${evmRawTx.to}...`);

    const tx = await this.wallet.sendTransaction({
      to: evmRawTx.to,
      data: evmRawTx.data as string | undefined,
      value: evmRawTx.value != null ? BigInt(evmRawTx.value as any) : undefined,
    });

    console.log(`[EthersAdapter] Sent! Hash: ${tx.hash}`);
    return tx.hash as Hash;
  }

  async waitForTransactionReceipt(txHash: Hash): Promise<EvmRawTransactionReceipt> {
    console.log(`[EthersAdapter] Waiting for receipt: ${txHash}...`);

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
}
