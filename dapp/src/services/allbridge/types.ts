import type { TokenWithChainDetails, Messenger } from "@allbridge/bridge-core-sdk";

export interface BridgeQuote {
  sourceToken: TokenWithChainDetails;
  destinationToken: TokenWithChainDetails;
  amountToSend: string;
  amountToReceive: string;
  fee: string;
  feeFloat: string;
  estimatedTime: string;
  messenger: Messenger;
}

export interface BridgeFeeParams {
  amount: string;
  sourceTokenSymbol: string;
  sourceChain: string;
  destinationTokenSymbol: string;
  destinationChain: string;
}
