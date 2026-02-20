"use client";

import { useState, useCallback } from "react";
import { EVMWallet, type Wallet } from "@crossmint/wallets-sdk";
import type { Chain } from "@crossmint/client-sdk-react-ui";
import type { RawEvmTransaction } from "@allbridge/bridge-core-sdk";
import {
  buildSendParams,
  checkAllowance,
  buildApproveTransaction,
  buildRawTransaction,
  Messenger,
} from "@/services/allbridge/bridge.service";
import type { BridgeQuote } from "@/services/allbridge/types";

export type BridgeStatus =
  | "idle"
  | "approving"
  | "sending"
  | "confirming"
  | "done"
  | "error";

interface UseBridgeTransactionResult {
  execute: () => Promise<void>;
  status: BridgeStatus;
  txHash: string | null;
  error: string | null;
  reset: () => void;
}

export function useBridgeTransaction(params: {
  quote: BridgeQuote | null;
  baseWallet: Wallet<Chain> | undefined;
  baseAddress: string | undefined;
  stellarAddress: string | undefined;
  onSuccess?: () => void;
}): UseBridgeTransactionResult {
  const { quote, baseWallet, baseAddress, stellarAddress, onSuccess } = params;

  const [status, setStatus] = useState<BridgeStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setTxHash(null);
    setError(null);
  }, []);

  const execute = useCallback(async () => {
    if (!quote || !baseWallet || !baseAddress || !stellarAddress) {
      setError("Missing required parameters");
      setStatus("error");
      return;
    }

    try {
      setStatus("approving");
      setError(null);
      setTxHash(null);

      const evmWallet = EVMWallet.from(baseWallet);

      // Step 1: Check allowance
      const hasAllowance = await checkAllowance({
        token: quote.sourceToken,
        owner: baseAddress,
        amount: quote.amountToSend,
        messenger: quote.messenger,
      });

      // Step 2: Approve if needed
      if (!hasAllowance) {
        const rawApproveTx = (await buildApproveTransaction({
          token: quote.sourceToken,
          owner: baseAddress,
          messenger: quote.messenger,
        })) as RawEvmTransaction;

        await evmWallet.sendTransaction({
          to: rawApproveTx.to!,
          data: rawApproveTx.data as `0x${string}`,
          value: rawApproveTx.value ? BigInt(rawApproveTx.value) : undefined,
        });
      }

      // Step 3: Build and send bridge transaction
      setStatus("sending");

      const sendParams = buildSendParams({
        quote,
        fromAddress: baseAddress,
        toAddress: stellarAddress,
      });

      const rawSendTx = (await buildRawTransaction(
        sendParams
      )) as RawEvmTransaction;

      const result = await evmWallet.sendTransaction({
        to: rawSendTx.to!,
        data: rawSendTx.data as `0x${string}`,
        value: rawSendTx.value ? BigInt(rawSendTx.value) : undefined,
      });

      setTxHash(result.hash);
      setStatus("done");
      onSuccess?.();
    } catch (err) {
      console.error("Bridge transaction failed:", err);
      setError(err instanceof Error ? err.message : "Bridge transaction failed");
      setStatus("error");
    }
  }, [quote, baseWallet, baseAddress, stellarAddress, onSuccess]);

  return { execute, status, txHash, error, reset };
}
