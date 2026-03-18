import { ethers } from "ethers";
import { privy, buildAuthContext, authorizationPublicKey } from "../shared/privy-client.js";

// Base mainnet CAIP-2 chain identifier
const BASE_MAINNET_CAIP2 = "eip155:8453";

// Idempotency key — reusing this across runs returns the same wallet
const EVM_WALLET_IDEMPOTENCY_KEY = "privy-poc-ethereum-wallet-v1";

/**
 * Creates an EVM wallet on Base mainnet owned by the stored authorization key,
 * or retrieves the existing one via idempotency_key.
 */
export async function getOrCreateEvmWallet() {
  const wallet = await privy.wallets().create({
    chain_type: "ethereum",
    owner: { public_key: authorizationPublicKey },
    idempotency_key: EVM_WALLET_IDEMPOTENCY_KEY,
  });

  return wallet;
}

/**
 * Fetches the native ETH balance for a given address on Base mainnet.
 */
export async function getEvmBalance(address: string): Promise<string> {
  const provider = new ethers.JsonRpcProvider(
    "https://mainnet.base.org",
    { chainId: 8453, name: "base" }
  );
  const balanceWei = await provider.getBalance(address);
  return ethers.formatEther(balanceWei);
}

/**
 * Sends a 0-value test transaction from the Privy wallet to a recipient.
 * Privy handles gas estimation and broadcasting on Tier 3 chains (EVM).
 */
export async function sendTestTransaction(
  walletId: string,
  toAddress: string
): Promise<string> {
  const response = await privy
    .wallets()
    .ethereum()
    .sendTransaction(walletId, {
      caip2: BASE_MAINNET_CAIP2,
      params: {
        transaction: {
          to: toAddress,
          value: "0x0",
          data: "0x",
        },
      },
      authorization_context: buildAuthContext(),
    });

  return (response as any).hash ?? (response as any).transaction_hash;
}
