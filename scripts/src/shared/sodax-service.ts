import { 
  Sodax, 
  EvmSpokeProvider, 
  SolverIntentQuoteRequest,
  CreateIntentParams,
  Result,
  IntentError,
  Intent,
  SolverExecutionResponse,
  IntentDeliveryInfo,
  IntentErrorCode,
  SolverIntentStatusCode,
  SONIC_MAINNET_CHAIN_ID
} from "@sodax/sdk";
import { IEvmWalletProvider, Address, Hash, SpokeChainId } from "@sodax/types";
import { 
  IBridgeService, 
  SwapParams, 
  BridgeQuote, 
  BridgeExecutionResult 
} from "./bridge-types.js";
import { 
  formatError, 
  getStatusLabel, 
  sleep, 
  handleAllowance 
} from "./sodax.js";
import { ethers } from "ethers";

export class SodaxBridgeService implements IBridgeService {
  constructor(private sodax: Sodax) {}

  async getQuote(params: SwapParams): Promise<BridgeQuote> {
    const request: SolverIntentQuoteRequest = {
      token_src: params.srcToken.address,
      token_src_blockchain_id: params.srcToken.chainId as SpokeChainId,
      token_dst: params.dstToken.address,
      token_dst_blockchain_id: params.dstToken.chainId as SpokeChainId,
      amount: params.amountIn,
      quote_type: "exact_input",
    };

    const result = await this.sodax.swaps.getQuote(request);
    if (!result.ok) throw new Error(`Quote failed: ${formatError(result.error)}`);

    return {
      amountIn: params.amountIn,
      amountOut: result.value.quoted_amount,
      fee: 0n, // Sodax fee is usually baked into the quote or handled by relayer
      rawQuote: result.value,
    };
  }

  async executeSwap(
    signer: IEvmWalletProvider, 
    params: SwapParams, 
    quote: BridgeQuote
  ): Promise<BridgeExecutionResult> {
    const evmAddress = await signer.getWalletAddress();
    
    // Setup provider for Sodax
    const spokeProvider = new EvmSpokeProvider(
      signer as any,
      this.sodax.config.spokeChainConfig[params.srcToken.chainId as SpokeChainId] as any
    );

    const slippageBps = params.slippageBps ?? 100; // Default 1%
    const minOutputAmount = (quote.amountOut * BigInt(10000 - slippageBps)) / 10000n;

    const intentParams: CreateIntentParams = {
      inputToken: params.srcToken.address,
      outputToken: params.dstToken.address,
      inputAmount: params.amountIn,
      minOutputAmount,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      allowPartialFill: false,
      srcChain: params.srcToken.chainId as SpokeChainId,
      dstChain: params.dstToken.chainId as SpokeChainId,
      srcAddress: evmAddress,
      dstAddress: params.dstAddress,
      solver: '0x0000000000000000000000000000000000000000',
      data: "0x",
    };

    // Check allowance
    await handleAllowance(this.sodax.swaps, intentParams, spokeProvider, signer as any);

    // Execute swap
    const swapResult = await this.sodax.swaps.swap({
      intentParams,
      spokeProvider: spokeProvider as any,
    });

    if (!swapResult.ok) {
      throw new Error(`Swap execution failed: ${swapResult.error.code} - ${formatError(swapResult.error.data)}`);
    }

    const [solverResponse, _intent, deliveryInfo] = swapResult.value;

    return {
      srcTxHash: deliveryInfo.srcTxHash as string,
      statusHash: (solverResponse.intent_hash || deliveryInfo.srcTxHash) as string
    };
  }

  async pollStatus(statusHash: string, maxAttempts = 120): Promise<string> {
    console.log(`\n[Status] Polling Sodax status for: ${statusHash}`);
    
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      const statusResult = await this.sodax.swaps.getStatus({ intent_tx_hash: statusHash as `0x${string}` });

      if (statusResult.ok) {
        const status = statusResult.value.status;
        const label = getStatusLabel(status);
        console.log(`  Attempt ${attempts}/${maxAttempts} — Status: ${label}`);
        
        if (status === SolverIntentStatusCode.SOLVED) {
          if (statusResult.value.fill_tx_hash) {
            const deliveryPacketResult = await this.sodax.swaps.getSolvedIntentPacket({
              chainId: SONIC_MAINNET_CHAIN_ID,
              fillTxHash: statusResult.value.fill_tx_hash as `0x${string}`
            });

            if (deliveryPacketResult.ok) {
              return deliveryPacketResult.value.dst_tx_hash;
            }
          }
          return "SOLVED (Dest hash pending)";
        } else if (status === SolverIntentStatusCode.FAILED) {
          throw new Error(`Swap failed on-chain: ${status}`);
        }
      }
      
      await sleep(10000);
    }

    throw new Error("Polling timed out");
  }
}
