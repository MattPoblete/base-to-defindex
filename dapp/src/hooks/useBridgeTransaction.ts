"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { EVMWallet, type Wallet } from "@crossmint/wallets-sdk";
import type { Chain } from "@crossmint/client-sdk-react-ui";
import type { RawEvmTransaction } from "@allbridge/bridge-core-sdk";
import {
  buildSendParams,
  checkAllowance,
  buildApproveTransaction,
  buildRawTransaction,
  getTransferStatus,
  FeePaymentMethod,
  ChainSymbol,
} from "@/services/allbridge/bridge.service";
import type { BridgeQuote, BridgeProgress } from "@/services/allbridge/types";

const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_ATTEMPTS = 120; // ~20 minutes

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
  progress: BridgeProgress | null;
  stellarTxId: string | null;
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
  const [progress, setProgress] = useState<BridgeProgress | null>(null);
  const [stellarTxId, setStellarTxId] = useState<string | null>(null);

  const cancelledRef = useRef(false);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setStatus("idle");
    setTxHash(null);
    setError(null);
    setProgress(null);
    setStellarTxId(null);
  }, []);

  const pollTransferStatus = useCallback(
    async (hash: string) => {
      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        if (cancelledRef.current) return;

        try {
          const transferStatus = (await getTransferStatus(
            ChainSymbol.BAS,
            hash
          )) as {
            send: {
              confirmations: number;
              confirmationsNeeded: number;
              amountFormatted: number;
            } | null;
            receive: {
              txId: string;
              amountFormatted: number;
            } | null;
            signaturesCount: number;
            signaturesNeeded: number;
          };

          if (cancelledRef.current) return;

          // Bridge complete: receive side has a txId
          if (transferStatus.receive?.txId) {
            setProgress({
              phase: "complete",
              sendConfirmations:
                transferStatus.send?.confirmations ?? null,
              sendConfirmationsNeeded:
                transferStatus.send?.confirmationsNeeded ?? null,
              signaturesCount: transferStatus.signaturesCount,
              signaturesNeeded: transferStatus.signaturesNeeded,
              receiveTxId: transferStatus.receive.txId,
              receiveAmount: transferStatus.receive.amountFormatted,
              pollAttempt: i + 1,
            });
            setStellarTxId(transferStatus.receive.txId);
            setStatus("done");
            onSuccess?.();
            return;
          }

          // Determine current phase
          let phase: BridgeProgress["phase"] = "sending";
          if (
            transferStatus.send &&
            transferStatus.send.confirmations >=
              transferStatus.send.confirmationsNeeded
          ) {
            phase =
              transferStatus.signaturesCount >=
              transferStatus.signaturesNeeded
                ? "receiving"
                : "signing";
          }

          setProgress({
            phase,
            sendConfirmations:
              transferStatus.send?.confirmations ?? null,
            sendConfirmationsNeeded:
              transferStatus.send?.confirmationsNeeded ?? null,
            signaturesCount: transferStatus.signaturesCount,
            signaturesNeeded: transferStatus.signaturesNeeded,
            receiveTxId: null,
            receiveAmount: null,
            pollAttempt: i + 1,
          });
        } catch (err: unknown) {
          // Allbridge API returns 404 until the tx is indexed — treat as pending
          const is404 =
            err != null &&
            typeof err === "object" &&
            "response" in err &&
            (err as { response?: { status?: number } }).response?.status ===
              404;

          if (is404) {
            if (cancelledRef.current) return;
            setProgress({
              phase: "indexing",
              sendConfirmations: null,
              sendConfirmationsNeeded: null,
              signaturesCount: null,
              signaturesNeeded: null,
              receiveTxId: null,
              receiveAmount: null,
              pollAttempt: i + 1,
            });
          } else {
            console.error("Transfer status poll error:", err);
            // Non-404 errors: continue polling, don't break
          }
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      // Max attempts reached
      if (!cancelledRef.current) {
        setError(
          "Bridge is still processing. Check back later — it may complete in a few minutes."
        );
        setStatus("error");
      }
    },
    [onSuccess]
  );

  const execute = useCallback(async () => {
    if (!quote || !baseWallet || !baseAddress || !stellarAddress) {
      setError("Missing required parameters");
      setStatus("error");
      return;
    }

    try {
      cancelledRef.current = false;
      setStatus("approving");
      setError(null);
      setTxHash(null);
      setProgress(null);
      setStellarTxId(null);

      const evmWallet = EVMWallet.from(baseWallet);

      // Step 1: Check allowance (with gasFeePaymentMethod fix)
      const hasAllowance = await checkAllowance({
        token: quote.sourceToken,
        owner: baseAddress,
        amount: quote.amountToSend,
        messenger: quote.messenger,
        gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
      });

      // Step 2: Approve if needed (with gasFeePaymentMethod fix)
      if (!hasAllowance) {
        const rawApproveTx = (await buildApproveTransaction({
          token: quote.sourceToken,
          owner: baseAddress,
          messenger: quote.messenger,
          gasFeePaymentMethod: FeePaymentMethod.WITH_NATIVE_CURRENCY,
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

      // Step 4: Poll transfer status until bridge completes
      setStatus("confirming");
      await pollTransferStatus(result.hash);
    } catch (err) {
      console.error("Bridge transaction failed:", err);
      setError(err instanceof Error ? err.message : "Bridge transaction failed");
      setStatus("error");
    }
  }, [quote, baseWallet, baseAddress, stellarAddress, pollTransferStatus]);

  return { execute, status, txHash, error, progress, stellarTxId, reset };
}
