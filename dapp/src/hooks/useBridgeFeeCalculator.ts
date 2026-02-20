"use client";

import { useState, useEffect, useCallback } from "react";
import { getQuote, ChainSymbol } from "@/services/allbridge/bridge.service";
import type { BridgeQuote } from "@/services/allbridge/types";

export function useBridgeFeeCalculator(
  amount: string,
  token: "USDC" | "USDT" = "USDC"
) {
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculate = useCallback(async () => {
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setQuote(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getQuote({
        amount,
        sourceChain: ChainSymbol.BAS,
        destinationChain: ChainSymbol.SRB,
        tokenSymbol: token,
      });
      setQuote(result);
    } catch (err) {
      console.error("Fee calculation failed:", err);
      setError(err instanceof Error ? err.message : "Fee calculation failed");
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, [amount, token]);

  // Auto-calculate with debounce
  useEffect(() => {
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setQuote(null);
      return;
    }

    const timeout = setTimeout(calculate, 500);
    return () => clearTimeout(timeout);
  }, [amount, calculate]);

  return {
    quote,
    loading,
    error,
    recalculate: calculate,
    // Convenience fields
    amountToReceive: quote?.amountToReceive ?? null,
    fee: quote?.feeFloat ?? null,
    estimatedTime: quote?.estimatedTime ?? null,
  };
}
