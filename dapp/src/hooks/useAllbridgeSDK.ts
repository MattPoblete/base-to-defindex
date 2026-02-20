"use client";

import { useState, useEffect } from "react";
import type { TokenWithChainDetails } from "@allbridge/bridge-core-sdk";
import { getTokens, ChainSymbol } from "@/services/allbridge/bridge.service";

export function useAllbridgeSDK() {
  const [tokens, setTokens] = useState<TokenWithChainDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTokens() {
      try {
        setLoading(true);
        setError(null);
        const result = await getTokens();
        if (!cancelled) {
          setTokens(result);
        }
      } catch (err) {
        console.error("Failed to load Allbridge tokens:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load tokens");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadTokens();
    return () => {
      cancelled = true;
    };
  }, []);

  const baseTokens = tokens.filter((t) => t.chainSymbol === ChainSymbol.BAS);
  const stellarTokens = tokens.filter(
    (t) =>
      t.chainSymbol === ChainSymbol.STLR ||
      t.chainSymbol === ChainSymbol.SRB
  );

  return {
    tokens,
    baseTokens,
    stellarTokens,
    loading,
    error,
  };
}
