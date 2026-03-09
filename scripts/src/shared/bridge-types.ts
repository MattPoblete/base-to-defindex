import { Address, Hash } from "@sodax/types";

export interface BridgeToken {
  symbol: string;
  address: string;
  decimals: number;
  chainId: string | number;
}

export interface BridgeQuote {
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
  estimatedTime?: number; // seconds
  rawQuote: any; // Original quote object from the provider
}

export interface SwapParams {
  srcToken: BridgeToken;
  dstToken: BridgeToken;
  amountIn: bigint;
  dstAddress: string;
  slippageBps?: number; // 100 bps = 1%
}

export interface BridgeExecutionResult {
  srcTxHash: Hash | string;
  statusHash: string; // Used for polling status
}

export interface IBridgeService {
  getQuote(params: SwapParams): Promise<BridgeQuote>;
  executeSwap(signer: any, params: SwapParams, quote: BridgeQuote): Promise<BridgeExecutionResult>;
  pollStatus(statusHash: string): Promise<string>; // Returns the destination Tx Hash if successful
}
