"use client";

import { useState, useCallback } from "react";
import type { Wallet } from "@crossmint/wallets-sdk";
import type { Chain } from "@crossmint/client-sdk-react-ui";

export function FundWalletButton({
  wallet,
  label,
  onFunded,
}: {
  wallet: Wallet<Chain> | undefined;
  label?: string;
  onFunded?: () => void;
}) {
  const [funding, setFunding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFund = useCallback(async () => {
    if (!wallet) return;
    setFunding(true);
    setError(null);
    try {
      await wallet.stagingFund(10);
      onFunded?.();
    } catch (err) {
      console.error("Failed to fund wallet:", err);
      setError(err instanceof Error ? err.message : "Funding failed");
    } finally {
      setFunding(false);
    }
  }, [wallet, onFunded]);

  if (!wallet) return null;

  const displayLabel = label ?? "Fund Wallet";

  return (
    <div className="flex-1 space-y-1">
      <button
        onClick={handleFund}
        disabled={funding}
        className="w-full rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
      >
        {funding ? "Funding..." : `${displayLabel} (10 USDXM)`}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
