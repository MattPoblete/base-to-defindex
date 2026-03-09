import { ethers } from "ethers";
import { config } from "./config.js";

const API_VERSION = "2025-06-09";

/**
 * Maps a specific chain name to the Crossmint chainType used in wallet locators.
 * e.g. "base" → "evm", "base-sepolia" → "evm", "stellar" → "stellar"
 */
function chainToChainType(chain: string): string {
  if (chain === "stellar" || chain === "stellar-testnet") return "stellar";
  if (chain === "solana" || chain === "solana-devnet") return "solana";
  return "evm";
}

interface PendingApproval {
  signer: { locator: string };
  message: string;
}

interface CrossmintTransaction {
  id: string;
  status: string;
  approvals?: { pending: PendingApproval[] };
  onChain?: {
    txId?: string;
  };
}

/**
 * Thin REST client for Crossmint Wallet API.
 * Uses external-wallet (EVM private key) as the wallet owner for server-side scripts —
 * no email OTP required at any point.
 */
export class CrossmintRestClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly signer: ethers.Wallet;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.signer = new ethers.Wallet(config.evmPrivateKey);
  }

  private get signerLocator(): string {
    return `external-wallet:${this.signer.address}`;
  }

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-API-KEY": this.apiKey,
    };
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}/api/${API_VERSION}/${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = this.buildUrl(path);
    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(
        `Crossmint REST API error ${response.status}: ${JSON.stringify(json)}`
      );
    }

    return json as T;
  }

  /**
   * Gets or creates a server-controlled EVM smart wallet.
   * The wallet owner/locator is email-based (required by Crossmint), but the adminSigner
   * is set to external-wallet — so our private key controls it with no email OTP needed.
   * An alias ("scripts") isolates it from the dapp wallet that shares the same email.
   * Returns { address: the on-chain smart wallet address, locator: Crossmint wallet locator }.
   */
  async getOrCreateEvmScriptsWallet(): Promise<{ address: string; locator: string }> {
    // Try both locator forms — Crossmint may store it with or without ":smart:"
    for (const locator of [
      `email:${config.walletEmail}:evm:smart:alias:scripts`,
      `email:${config.walletEmail}:evm:alias:scripts`,
    ]) {
      try {
        const wallet = await this.request<{ address: string }>(
          "GET",
          `wallets/${encodeURIComponent(locator)}`
        );
        // Use the on-chain address as the transaction locator — always unambiguous
        return { address: wallet.address, locator: wallet.address };
      } catch (err: any) {
        if (!err.message?.includes("404")) throw err;
      }
    }

    console.log(`  EVM scripts wallet not found, creating with external-wallet adminSigner...`);
    const wallet = await this.request<{ address: string }>(
      "POST",
      "wallets",
      {
        chainType: "evm",
        type: "smart",
        owner: `email:${config.walletEmail}`,
        alias: "scripts",
        config: {
          adminSigner: {
            type: "external-wallet",
            address: this.signer.address,
          },
        },
      }
    );
    console.log(`  Created EVM scripts wallet: ${wallet.address}`);
    return { address: wallet.address, locator: wallet.address };
  }

  /**
   * Returns the Stellar wallet address linked to the configured email.
   * Used only as a recipient address — no transactions sent from it.
   * Tries to GET an existing wallet first; if not found, creates a custodial one.
   */
  async getStellarWalletAddress(): Promise<string> {
    const locator = `email:${config.walletEmail}:stellar`;
    try {
      const wallet = await this.request<{ address: string }>(
        "GET",
        `wallets/${encodeURIComponent(locator)}`
      );
      return wallet.address;
    } catch (err: any) {
      if (!err.message?.includes("404")) throw err;

      console.log(`  Stellar wallet not found, creating custodial wallet...`);
      try {
        const wallet = await this.request<{ address: string }>(
          "POST",
          "wallets",
          { chainType: "stellar", type: "mpc", owner: `email:${config.walletEmail}` }
        );
        return wallet.address;
      } catch (createErr: any) {
        throw new Error(
          `Could not create Stellar wallet: ${createErr.message}\n` +
          `Pass your Stellar address as a CLI argument:\n` +
          `  npm run sodax-crossmint -- <YOUR_STELLAR_ADDRESS>`
        );
      }
    }
  }

  /**
   * Sends an EVM transaction via REST API and polls until mined.
   * Uses external-wallet as signer; signs the approval message with the private key.
   * Returns the on-chain transaction hash.
   *
   * @param walletLocator - e.g. "external-wallet:0x...:evm"
   * @param tx            - EVM call parameters
   * @param chain         - specific chain name, e.g. "base" or "base-sepolia"
   */
  async sendTransactionAndGetHash(
    walletLocator: string,
    tx: { to: string; data?: string; value?: string | bigint },
    chain: string
  ): Promise<string> {
    const created = await this.request<CrossmintTransaction>(
      "POST",
      `wallets/${encodeURIComponent(walletLocator)}/transactions`,
      {
        params: {
          calls: [
            {
              to: tx.to,
              data: tx.data ?? "0x",
              value:
                tx.value !== undefined
                  ? typeof tx.value === "bigint"
                    ? `0x${tx.value.toString(16)}`
                    : tx.value
                  : "0x0",
            },
          ],
          chain,
          signer: this.signerLocator,
        },
      }
    );

    console.log(
      `[CrossmintREST] Transaction created: ${created.id} (status: ${created.status})`
    );

    if (created.status === "awaiting-approval") {
      await this.approveTransactionWithKey(walletLocator, created);
    }

    return this.pollForTxHash(walletLocator, created.id);
  }

  /**
   * Signs the pending approval message with the EVM private key and submits it.
   * Works because the private key IS the recovery signer of the wallet.
   */
  private async approveTransactionWithKey(
    walletLocator: string,
    tx: CrossmintTransaction
  ): Promise<void> {
    const pending = tx.approvals?.pending;
    if (!pending || pending.length === 0) {
      console.warn(
        `[CrossmintREST] Transaction ${tx.id} is awaiting-approval but no pending approvals found.`
      );
      return;
    }

    const message = pending[0].message;
    console.log(`[CrossmintREST] Signing approval for tx ${tx.id}...`);

    // Crossmint returns a raw hex message — sign exactly as returned
    const signature = await this.signer.signMessage(ethers.getBytes(message));

    await this.request(
      "POST",
      `wallets/${encodeURIComponent(walletLocator)}/transactions/${tx.id}/approvals`,
      { approvals: [{ signer: this.signerLocator, signature }] }
    );

    console.log(`[CrossmintREST] Approval submitted for tx ${tx.id}.`);
  }

  private async pollForTxHash(
    walletLocator: string,
    transactionId: string,
    maxAttempts = 60,
    intervalMs = 5000
  ): Promise<string> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const tx = await this.request<CrossmintTransaction>(
        "GET",
        `wallets/${encodeURIComponent(walletLocator)}/transactions/${transactionId}`
      );

      if (tx.onChain?.txId) {
        console.log(`[CrossmintREST] Transaction mined! Hash: ${tx.onChain.txId}`);
        return tx.onChain.txId;
      }

      console.log(
        `[CrossmintREST] Attempt ${attempt}/${maxAttempts} — status: ${tx.status}`
      );

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    throw new Error(
      `Transaction ${transactionId} did not confirm within ${maxAttempts} attempts`
    );
  }
}
