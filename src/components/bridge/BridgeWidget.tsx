"use client";

import { useState, useCallback } from "react";
import { useCrossmintWallets } from "@/hooks/useCrossmintWallets";
import { useBridgeFeeCalculator } from "@/hooks/useBridgeFeeCalculator";
import { useBridgeTransaction } from "@/hooks/useBridgeTransaction";
import type { SupportedToken } from "@/services/allbridge/config";
import { ChainSelector } from "./ChainSelector";
import { TokenSelector } from "./TokenSelector";
import { AmountInput } from "./AmountInput";
import { BridgePreview } from "./BridgePreview";
import { BridgeStatus } from "./BridgeStatus";

export function BridgeWidget() {
  const {
    allWalletsReady,
    baseBalances,
    baseWallet,
    baseAddress,
    stellarAddress,
    fetchBalances,
  } = useCrossmintWallets();
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<SupportedToken>("USDC");

  const { quote, amountToReceive, fee, estimatedTime, loading, error } =
    useBridgeFeeCalculator(amount, token);

  const handleBridgeSuccess = useCallback(() => {
    fetchBalances();
  }, [fetchBalances]);

  const bridge = useBridgeTransaction({
    quote,
    baseWallet,
    baseAddress,
    stellarAddress,
    onSuccess: handleBridgeSuccess,
  });

  const isBridging =
    bridge.status === "approving" ||
    bridge.status === "sending" ||
    bridge.status === "confirming";

  const usdcBalance = baseBalances?.usdc?.amount ?? null;

  const numAmount = parseFloat(amount);
  const numBalance = usdcBalance ? parseFloat(usdcBalance) : 0;
  const canBridge =
    allWalletsReady &&
    !isNaN(numAmount) &&
    numAmount > 0 &&
    numAmount <= numBalance &&
    !loading &&
    !error &&
    !isBridging &&
    bridge.status !== "done";

  const handleReset = useCallback(() => {
    bridge.reset();
    setAmount("");
  }, [bridge]);

  if (!allWalletsReady) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 text-center">
        <p className="text-sm text-gray-500">
          Connect your wallets to start bridging
        </p>
      </div>
    );
  }

  function getButtonText() {
    if (bridge.status === "approving") return "Approving...";
    if (bridge.status === "sending") return "Bridging...";
    if (bridge.status === "confirming") return "Confirming...";
    if (bridge.status === "done") return "Bridge Complete";
    if (!amount || numAmount <= 0) return "Enter amount";
    if (numAmount > numBalance) return "Insufficient balance";
    if (loading) return "Calculating...";
    if (error) return "Quote unavailable";
    return "Bridge";
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Bridge</h3>
        <ChainSelector />
      </div>

      <TokenSelector
        value={token}
        onChange={setToken}
        disabled={isBridging}
      />

      <AmountInput
        value={amount}
        onChange={setAmount}
        balance={usdcBalance}
        token={token}
        disabled={isBridging || bridge.status === "done"}
      />

      <BridgePreview
        amount={amount}
        amountToReceive={amountToReceive}
        fee={fee}
        estimatedTime={estimatedTime}
        token={token}
        loading={loading}
        error={error}
      />

      {bridge.status !== "idle" && (
        <BridgeStatus
          status={bridge.status}
          txHash={bridge.txHash}
          error={bridge.error}
          onReset={handleReset}
        />
      )}

      <button
        disabled={!canBridge}
        onClick={bridge.execute}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
      >
        {getButtonText()}
      </button>
    </div>
  );
}
