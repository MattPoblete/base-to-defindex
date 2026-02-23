"use client";

import { useState, useCallback } from "react";
import { StellarWallet, type Wallet } from "@crossmint/wallets-sdk";
import type { Chain } from "@crossmint/client-sdk-react-ui";
import {
  TransactionBuilder,
  Networks,
  Account,
  Asset,
  Operation,
} from "@stellar/stellar-sdk";

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_ASSET = new Asset("USDC", USDC_ISSUER);

function buildChangeTrustXdr(sourceAddress: string): string {
  // Build a changeTrust transaction. Crossmint's API will re-sign and
  // route it through the smart wallet, so we use a minimal source account.
  const account = new Account(sourceAddress, "0");
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

export function TrustlineButton({
  wallet,
  onSuccess,
}: {
  wallet: Wallet<Chain> | undefined;
  onSuccess?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    setError(null);
    try {
      const stellarWallet = StellarWallet.from(wallet);
      const xdr = buildChangeTrustXdr(wallet.address);
      await stellarWallet.sendTransaction({
        transaction: xdr,
        contractId: wallet.address,
      });
      setDone(true);
      onSuccess?.();
    } catch (err) {
      console.error("Trustline creation failed:", err);
      setError(err instanceof Error ? err.message : "Trustline creation failed");
    } finally {
      setLoading(false);
    }
  }, [wallet, onSuccess]);

  if (!wallet) return null;

  return (
    <div className="space-y-1">
      <button
        onClick={handleCreate}
        disabled={loading || done}
        className="w-full rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
      >
        {loading ? "Creating trustline..." : done ? "USDC Trustline OK" : "Add USDC Trustline"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
