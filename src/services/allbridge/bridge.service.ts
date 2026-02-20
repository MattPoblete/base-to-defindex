import {
  AllbridgeCoreSdk,
  ChainSymbol,
  Messenger,
  FeePaymentMethod,
  AmountFormat,
  mainnet,
  type TokenWithChainDetails,
  type SendParams,
  type CheckAllowanceParams,
  type BridgeApproveParams,
  type RawTransaction,
} from "@allbridge/bridge-core-sdk";
import { ALLBRIDGE_NODE_URLS } from "./config";
import type { BridgeQuote } from "./types";

let sdkInstance: AllbridgeCoreSdk | null = null;

function getSDK(): AllbridgeCoreSdk {
  if (!sdkInstance) {
    sdkInstance = new AllbridgeCoreSdk(ALLBRIDGE_NODE_URLS, mainnet);
  }
  return sdkInstance;
}

export async function getTokens() {
  const sdk = getSDK();
  return sdk.tokens();
}

export async function findToken(
  chainSymbol: string,
  tokenSymbol: string
): Promise<TokenWithChainDetails | undefined> {
  const tokens = await getTokens();
  return tokens.find(
    (t) =>
      t.chainSymbol === chainSymbol &&
      t.symbol.toUpperCase() === tokenSymbol.toUpperCase()
  );
}

export async function getQuote(params: {
  amount: string;
  sourceChain: string;
  destinationChain: string;
  tokenSymbol: string;
  messenger?: Messenger;
}): Promise<BridgeQuote> {
  const sdk = getSDK();
  const messenger = params.messenger ?? Messenger.ALLBRIDGE;

  const [sourceToken, destinationToken] = await Promise.all([
    findToken(params.sourceChain, params.tokenSymbol),
    findToken(params.destinationChain, params.tokenSymbol),
  ]);

  if (!sourceToken) {
    throw new Error(
      `Token ${params.tokenSymbol} not found on ${params.sourceChain}`
    );
  }
  if (!destinationToken) {
    throw new Error(
      `Token ${params.tokenSymbol} not found on ${params.destinationChain}`
    );
  }

  const [amountToReceive, gasFeeOptions] = await Promise.all([
    sdk.getAmountToBeReceived(
      params.amount,
      sourceToken,
      destinationToken,
      messenger
    ),
    sdk.getGasFeeOptions(sourceToken, destinationToken, messenger),
  ]);

  const nativeFee = gasFeeOptions[FeePaymentMethod.WITH_NATIVE_CURRENCY];
  const transferTime = sourceToken.transferTime;
  // Estimate time from the messenger's average transfer time
  const timeKey =
    messenger === Messenger.ALLBRIDGE ? "allbridge" : "wormhole";
  const avgTimeMinutes =
    transferTime?.[timeKey as keyof typeof transferTime] ?? 5;

  return {
    sourceToken,
    destinationToken,
    amountToSend: params.amount,
    amountToReceive,
    fee: nativeFee?.int ?? "0",
    feeFloat: nativeFee?.float ?? "0",
    estimatedTime: `~${avgTimeMinutes} min`,
    messenger,
  };
}

export function buildSendParams(params: {
  quote: BridgeQuote;
  fromAddress: string;
  toAddress: string;
}): SendParams {
  return {
    amount: params.quote.amountToSend,
    fromAccountAddress: params.fromAddress,
    toAccountAddress: params.toAddress,
    sourceToken: params.quote.sourceToken,
    destinationToken: params.quote.destinationToken,
    messenger: params.quote.messenger,
    fee: params.quote.fee,
    feeFormat: AmountFormat.INT,
    gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
  };
}

export async function buildRawTransaction(sendParams: SendParams) {
  const sdk = getSDK();
  return sdk.bridge.rawTxBuilder.send(sendParams);
}

export async function checkAllowance(
  params: CheckAllowanceParams
): Promise<boolean> {
  const sdk = getSDK();
  return sdk.bridge.checkAllowance(params);
}

export async function buildApproveTransaction(
  params: BridgeApproveParams
): Promise<RawTransaction> {
  const sdk = getSDK();
  return sdk.bridge.rawTxBuilder.approve(params);
}

export async function getTransferStatus(chainSymbol: string, txId: string) {
  const sdk = getSDK();
  return sdk.getTransferStatus(chainSymbol, txId);
}

export { ChainSymbol, Messenger, FeePaymentMethod, AmountFormat };
export type { CheckAllowanceParams, BridgeApproveParams, RawTransaction };
