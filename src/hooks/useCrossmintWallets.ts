"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAuth,
  useWallet,
  useCrossmint,
  StellarWallet,
  type Balances,
  type Chain,
} from "@crossmint/client-sdk-react-ui";
import { CrossmintWallets, type Wallet } from "@crossmint/wallets-sdk";

type WalletStatus = "not-loaded" | "loading" | "loaded" | "error";

export function useCrossmintWallets() {
  const { login, logout, user, status: authStatus } = useAuth();
  const { crossmint } = useCrossmint();
  // Stellar wallet comes from createOnLogin in the provider
  const { wallet: stellarRawWallet, status: stellarProviderStatus } = useWallet();

  // Base wallet is created programmatically via CrossmintWallets SDK
  const [baseWallet, setBaseWallet] = useState<Wallet<Chain> | undefined>(undefined);
  const [baseStatus, setBaseStatus] = useState<WalletStatus>("not-loaded");

  // Balances
  const [stellarBalances, setStellarBalances] = useState<Balances | null>(null);
  const [baseBalances, setBaseBalances] = useState<Balances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function createBaseWallet() {
      if (!crossmint || !user?.email || stellarProviderStatus !== "loaded") return;

      try {
        setBaseStatus("loading");
        const wallets = CrossmintWallets.from(crossmint);
        const wallet = await wallets.getOrCreateWallet({
          chain: "base-sepolia", // TODO: "base" for mainnet
          signer: { type: "email", email: user.email },
        });
        if (!cancelled) {
          setBaseWallet(wallet);
          setBaseStatus("loaded");
        }
      } catch (error) {
        console.error("Failed to create Base wallet:", error);
        if (!cancelled) {
          setBaseStatus("error");
        }
      }
    }

    createBaseWallet();

    return () => {
      cancelled = true;
    };
  }, [crossmint, user?.email, stellarProviderStatus]);

  const fetchBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      const results = await Promise.allSettled([
        stellarRawWallet?.balances() ?? Promise.reject("no wallet"),
        baseWallet?.balances() ?? Promise.reject("no wallet"),
      ]);

      if (results[0].status === "fulfilled") {
        setStellarBalances(results[0].value);
      }
      if (results[1].status === "fulfilled") {
        setBaseBalances(results[1].value);
      }
    } catch (error) {
      console.error("Failed to fetch balances:", error);
    } finally {
      setBalancesLoading(false);
    }
  }, [stellarRawWallet, baseWallet]);

  // Auto-fetch balances when both wallets are ready
  useEffect(() => {
    if (stellarRawWallet && baseWallet) {
      fetchBalances();
    }
  }, [stellarRawWallet, baseWallet, fetchBalances]);

  // Derive Stellar wallet status from provider status
  const stellarStatus: WalletStatus =
    stellarProviderStatus === "loaded"
      ? "loaded"
      : stellarProviderStatus === "in-progress"
        ? "loading"
        : stellarProviderStatus === "error"
          ? "error"
          : "not-loaded";

  const allReady = stellarStatus === "loaded" && baseStatus === "loaded";

  return {
    // Auth
    login,
    logout,
    user,
    isAuthenticated: authStatus === "logged-in",
    authStatus,

    // Stellar wallet (auto-created via createOnLogin)
    stellarWallet: stellarRawWallet,
    stellarAddress: stellarRawWallet?.address,
    stellarReady: stellarStatus === "loaded",
    stellarStatus,
    stellarBalances,
    // Helper to get typed StellarWallet for sendTransaction
    getStellarWallet: () =>
      stellarRawWallet ? StellarWallet.from(stellarRawWallet) : undefined,

    // Base wallet (created via CrossmintWallets SDK)
    baseWallet,
    baseAddress: baseWallet?.address,
    baseReady: baseStatus === "loaded",
    baseStatus,
    baseBalances,

    // Balances
    fetchBalances,
    balancesLoading,

    // Overall
    allWalletsReady: allReady,
  };
}
