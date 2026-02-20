import { WalletConnector } from "@/components/bridge/WalletConnector";
import { BridgeWidget } from "@/components/bridge/BridgeWidget";

export default function BridgePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">
            Base → Stellar Bridge
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Bridge USDC from Base and deposit into DeFindex vaults
          </p>
        </div>

        <WalletConnector />
        <BridgeWidget />
      </div>
    </main>
  );
}
