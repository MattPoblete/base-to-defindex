import { Keypair } from "@stellar/stellar-base";
import { config } from "./config.js";

interface CrossmintTransaction {
  id: string;
  status: string;
  approvals?: { pending: Array<{ signer: { locator: string }; message: string }> };
  onChain?: { txId?: string };
}

export class DefindexService {
  private readonly stellarWalletLocator: string;
  private readonly keypair: ReturnType<typeof Keypair.fromSecret>;
  private readonly signerLocator: string;

  constructor(stellarWalletLocator: string) {
    this.stellarWalletLocator = stellarWalletLocator;
    this.keypair = Keypair.fromSecret(config.stellarServerKey);
    this.signerLocator = `external-wallet:${this.keypair.publicKey()}`;
  }

  async depositToVault(
    vaultAddress: string,
    amountStroops: bigint,
    callerAddress: string
  ): Promise<string> {
    console.log(`  [DeFindex] Depositing: ${amountStroops} stroops`);
    const slippage = 50 / 10000; // 0.5%
    const amountMin = BigInt(Math.floor(Number(amountStroops) * (1 - slippage)));

    const tx = await this.createContractCallTx(vaultAddress, "deposit", {
      amounts_desired: [amountStroops.toString()],
      amounts_min: [amountMin.toString()],
      from: callerAddress,
      invest: true,
    });

    if (tx.status === "awaiting-approval") {
      await this.approveWithStellarKey(tx);
    }

    return this.pollForTxHash(tx.id);
  }

  private buildUrl(path: string): string {
    return `${config.baseUrl}/api/2025-06-09/${path}`;
  }

  private get headers(): Record<string, string> {
    return { "Content-Type": "application/json", "X-API-KEY": config.apiKey };
  }

  private async createContractCallTx(
    contractId: string,
    method: string,
    args: Record<string, unknown>
  ): Promise<CrossmintTransaction> {
    const url = this.buildUrl(
      `wallets/${encodeURIComponent(this.stellarWalletLocator)}/transactions`
    );
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        params: {
          transaction: { type: "contract-call", contractId, method, args },
          signer: this.signerLocator,
        },
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(`Crossmint API error ${response.status}: ${JSON.stringify(json)}`);
    }
    return json as CrossmintTransaction;
  }

  private async approveWithStellarKey(tx: CrossmintTransaction): Promise<void> {
    const pending = tx.approvals?.pending;
    if (!pending?.length) {
      console.log(`  [DeFindex] No pending approvals found on tx ${tx.id}`);
      return;
    }

    const message = pending[0].message;
    const messageBytes = Buffer.from(message, "base64");
    console.log(`  [DeFindex] Signing message (base64, ${messageBytes.length} bytes): ${message.slice(0, 32)}...`);

    const signature = this.keypair.sign(messageBytes).toString("base64");
    console.log(`  [DeFindex] Signer: ${this.signerLocator}`);

    const url = this.buildUrl(
      `wallets/${encodeURIComponent(this.stellarWalletLocator)}/transactions/${tx.id}/approvals`
    );
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ approvals: [{ signer: this.signerLocator, signature }] }),
    });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(`Crossmint approval error ${response.status}: ${JSON.stringify(json)}`);
    }
    console.log(`  [DeFindex] Approval response: ${JSON.stringify(json)}`);
  }

  private async pollForTxHash(
    transactionId: string,
    maxAttempts = 60,
    intervalMs = 5000
  ): Promise<string> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const url = this.buildUrl(
        `wallets/${encodeURIComponent(this.stellarWalletLocator)}/transactions/${transactionId}`
      );
      const response = await fetch(url, { headers: this.headers });
      const tx = (await response.json()) as CrossmintTransaction;

      if (tx.onChain?.txId) return tx.onChain.txId;

      console.log(`  [DeFindex] Attempt ${attempt}/${maxAttempts} — status: ${tx.status}`);

      if (tx.status === "awaiting-approval") {
        await this.approveWithStellarKey(tx);
      }

      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`DeFindex deposit tx did not confirm within ${maxAttempts} attempts`);
  }
}
