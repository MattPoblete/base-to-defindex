"use client";

import { useState, useCallback } from "react";
import { useCrossmintWallets } from "@/hooks/useCrossmintWallets";
import type { Balances } from "@crossmint/client-sdk-react-ui";
import { FundWalletButton } from "./FundWalletButton";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatBalance(amount: string) {
  const num = parseFloat(amount);
  if (isNaN(num) || num === 0) return "0";
  if (num < 1) return num.toFixed(4);
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function BalanceDisplay({ balances, loading }: { balances: Balances | null; loading: boolean }) {
  if (loading) {
    return <span className="text-xs text-gray-500 animate-pulse">Loading...</span>;
  }
  if (!balances) {
    return <span className="text-xs text-gray-600">--</span>;
  }

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <span className="text-xs text-gray-300">
        {formatBalance(balances.nativeToken.amount)} <span className="text-gray-500">{balances.nativeToken.symbol.toUpperCase()}</span>
      </span>
      <span className="text-xs text-gray-300">
        {formatBalance(balances.usdc.amount)} <span className="text-gray-500">USDC</span>
      </span>
      {balances.tokens
        .filter((t) => t.symbol !== balances.nativeToken.symbol && t.symbol !== "usdc")
        .map((t) => (
          <span key={t.symbol} className="text-xs text-gray-300">
            {formatBalance(t.amount)} <span className="text-gray-500">{t.symbol.toUpperCase()}</span>
          </span>
        ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="ml-2 text-gray-500 hover:text-white transition-colors"
      title="Copy address"
    >
      {copied ? (
        <svg className="h-3.5 w-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

function WalletRow({
  label,
  address,
  status,
  balances,
  balancesLoading,
}: {
  label: string;
  address: string | undefined;
  status: string;
  balances: Balances | null;
  balancesLoading: boolean;
}) {
  return (
    <div className="py-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-400">{label}</span>
        {status === "loaded" && address ? (
          <span className="flex items-center font-mono text-sm text-white">
            {shortenAddress(address)}
            <CopyButton text={address} />
          </span>
        ) : status === "loading" ? (
          <span className="text-sm text-yellow-400 animate-pulse">
            Creating...
          </span>
        ) : status === "error" ? (
          <span className="text-sm text-red-400">Error</span>
        ) : (
          <span className="text-sm text-gray-500">--</span>
        )}
      </div>
      {status === "loaded" && (
        <BalanceDisplay balances={balances} loading={balancesLoading} />
      )}
    </div>
  );
}

export function WalletConnector() {
  const {
    login,
    logout,
    user,
    isAuthenticated,
    authStatus,
    stellarWallet,
    stellarAddress,
    stellarStatus,
    stellarBalances,
    baseWallet,
    baseAddress,
    baseStatus,
    baseBalances,
    fetchBalances,
    balancesLoading,
    allWalletsReady,
  } = useCrossmintWallets();

  if (authStatus === "initializing") {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-6">
        <p className="text-center text-gray-400 animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 text-center">
        <h3 className="mb-2 text-lg font-semibold text-white">
          Connect Wallet
        </h3>
        <p className="mb-4 text-sm text-gray-400">
          Login to create your Base and Stellar wallets
        </p>
        <button
          onClick={() => login()}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          Login with Crossmint
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Wallets</h3>
        <button
          onClick={() => logout()}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          Logout
        </button>
      </div>

      {user?.email && (
        <p className="mb-3 text-xs text-gray-500">{user.email}</p>
      )}

      <div className="divide-y divide-gray-800">
        <WalletRow
          label="Base"
          address={baseAddress}
          status={baseStatus}
          balances={baseBalances}
          balancesLoading={balancesLoading}
        />
        <WalletRow
          label="Stellar"
          address={stellarAddress}
          status={stellarStatus}
          balances={stellarBalances}
          balancesLoading={balancesLoading}
        />
      </div>

      {allWalletsReady && (
        <div className="mt-3 flex gap-2">
          <FundWalletButton wallet={baseWallet} label="Fund Base" onFunded={fetchBalances} />
          <FundWalletButton wallet={stellarWallet} label="Fund Stellar" onFunded={fetchBalances} />
        </div>
      )}

      {allWalletsReady && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-green-400">Both wallets ready</span>
          <button
            onClick={fetchBalances}
            disabled={balancesLoading}
            className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {balancesLoading ? "Refreshing..." : "Refresh balances"}
          </button>
        </div>
      )}
    </div>
  );
}
