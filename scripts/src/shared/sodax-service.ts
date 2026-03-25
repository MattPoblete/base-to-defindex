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
  BridgeExecutionResult,
  BridgePollResult,
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

  async getQuote(params: SwapParams, maxAttempts = 5): Promise<BridgeQuote> {
    const request: SolverIntentQuoteRequest = {
      token_src: params.srcToken.address,
      token_src_blockchain_id: params.srcToken.chainId as SpokeChainId,
      token_dst: params.dstToken.address,
      token_dst_blockchain_id: params.dstToken.chainId as SpokeChainId,
      amount: params.amountIn,
      quote_type: "exact_input",
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.sodax.swaps.getQuote(request);
      if (result.ok) {
        return {
          amountIn: params.amountIn,
          amountOut: result.value.quoted_amount,
          fee: 0n,
          rawQuote: result.value,
        };
      }
      const errMsg = formatError(result.error);
      if (attempt < maxAttempts) {
        console.log(`  Quote attempt ${attempt}/${maxAttempts} failed (${errMsg}) — retrying in 5s...`);
        await sleep(5000);
      } else {
        throw new Error(`Quote failed after ${maxAttempts} attempts: ${errMsg}`);
      }
    }
    // unreachable
    throw new Error("Quote failed");
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

  async pollStatus(statusHash: string, maxAttempts = 120): Promise<BridgePollResult> {
    console.log(`\n[Status] Polling Sodax status for: ${statusHash}`);

    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      const statusResult = await this.sodax.swaps.getStatus({
        intent_tx_hash: statusHash as `0x${string}`,
      });

      if (statusResult.ok) {
        const status = statusResult.value.status;
        const label = getStatusLabel(status);
        console.log(`  Attempt ${attempts}/${maxAttempts} — Status: ${label}`);

        if (status === SolverIntentStatusCode.SOLVED) {
          const fillTxHash = statusResult.value.fill_tx_hash as `0x${string}` | undefined;

          // Fetch the actual settled output amount from the Hub chain intent state
          let amountReceived = 0n;
          if (fillTxHash) {
            try {
              const intentState = await this.sodax.swaps.getFilledIntent(fillTxHash);
              amountReceived = intentState.receivedOutput;
              console.log(`  Settled output: ${amountReceived} (stroops)`);
            } catch {
              console.warn(`  Could not fetch intent state for ${fillTxHash}, amountReceived=0`);
            }
          }

          // Resolve the Stellar destination tx hash via the packet relay
          let destTxHash = "SOLVED (Dest hash pending)";
          if (fillTxHash) {
            const packetResult = await this.sodax.swaps.getSolvedIntentPacket({
              chainId: SONIC_MAINNET_CHAIN_ID,
              fillTxHash,
            });
            if (packetResult.ok) {
              destTxHash = packetResult.value.dst_tx_hash;
            }
          }

          return { destTxHash, amountReceived };
        } else if (status === SolverIntentStatusCode.FAILED) {
          throw new Error(`Swap failed on-chain: ${status}`);
        }
      }

      await sleep(10000);
    }

    throw new Error("Polling timed out");
  }
}
