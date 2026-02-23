"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
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

interface CrossmintWalletsState {
  // Auth
  login: () => void;
  logout: () => void;
  user: { email?: string } | undefined;
  isAuthenticated: boolean;
  authStatus: string;

  // Stellar
  stellarWallet: Wallet<Chain> | undefined;
  stellarAddress: string | undefined;
  stellarReady: boolean;
  stellarStatus: WalletStatus;
  stellarBalances: Balances | null;
  getStellarWallet: () => StellarWallet | undefined;

  // Base
  baseWallet: Wallet<Chain> | undefined;
  baseAddress: string | undefined;
  baseReady: boolean;
  baseStatus: WalletStatus;
  baseBalances: Balances | null;

  // Balances
  fetchBalances: () => Promise<void>;
  balancesLoading: boolean;

  // Overall
  allWalletsReady: boolean;
}

const CrossmintWalletsContext = createContext<CrossmintWalletsState | null>(
  null
);

export function CrossmintWalletsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { login, logout, user, status: authStatus } = useAuth();
  const { crossmint } = useCrossmint();
  const {
    wallet: stellarRawWallet,
    status: stellarProviderStatus,
    onAuthRequired,
  } = useWallet();

  const [baseWallet, setBaseWallet] = useState<Wallet<Chain> | undefined>(
    undefined
  );
  const [baseStatus, setBaseStatus] = useState<WalletStatus>("not-loaded");

  const [stellarBalances, setStellarBalances] = useState<Balances | null>(null);
  const [baseBalances, setBaseBalances] = useState<Balances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function createBaseWallet() {
      if (!crossmint || !user?.email || stellarProviderStatus !== "loaded")
        return;

      try {
        setBaseStatus("loading");
        const wallets = CrossmintWallets.from(crossmint);
        const wallet = await wallets.getOrCreateWallet({
          chain: "base",
          signer: { type: "email", email: user.email, onAuthRequired },
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
  }, [crossmint, user?.email, stellarProviderStatus, onAuthRequired]);

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

  useEffect(() => {
    if (stellarRawWallet && baseWallet) {
      fetchBalances();
    }
  }, [stellarRawWallet, baseWallet, fetchBalances]);

  const stellarStatus: WalletStatus =
    stellarProviderStatus === "loaded"
      ? "loaded"
      : stellarProviderStatus === "in-progress"
        ? "loading"
        : stellarProviderStatus === "error"
          ? "error"
          : "not-loaded";

  const allReady = stellarStatus === "loaded" && baseStatus === "loaded";

  const value: CrossmintWalletsState = {
    login,
    logout,
    user,
    isAuthenticated: authStatus === "logged-in",
    authStatus,

    stellarWallet: stellarRawWallet,
    stellarAddress: stellarRawWallet?.address,
    stellarReady: stellarStatus === "loaded",
    stellarStatus,
    stellarBalances,
    getStellarWallet: () =>
      stellarRawWallet ? StellarWallet.from(stellarRawWallet) : undefined,

    baseWallet,
    baseAddress: baseWallet?.address,
    baseReady: baseStatus === "loaded",
    baseStatus,
    baseBalances,

    fetchBalances,
    balancesLoading,

    allWalletsReady: allReady,
  };

  return (
    <CrossmintWalletsContext.Provider value={value}>
      {children}
    </CrossmintWalletsContext.Provider>
  );
}

export function useCrossmintWallets(): CrossmintWalletsState {
  const context = useContext(CrossmintWalletsContext);
  if (!context) {
    throw new Error(
      "useCrossmintWallets must be used within CrossmintWalletsProvider"
    );
  }
  return context;
}
