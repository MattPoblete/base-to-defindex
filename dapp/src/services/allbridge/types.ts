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

export interface BridgeProgress {
  phase: "indexing" | "sending" | "signing" | "receiving" | "complete";
  sendConfirmations: number | null;
  sendConfirmationsNeeded: number | null;
  signaturesCount: number | null;
  signaturesNeeded: number | null;
  receiveTxId: string | null;
  receiveAmount: number | null;
  pollAttempt: number;
}

export interface BridgeFeeParams {
  amount: string;
  sourceTokenSymbol: string;
  sourceChain: string;
  destinationTokenSymbol: string;
  destinationChain: string;
}
