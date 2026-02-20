import type { BridgeStatus as BridgeStatusType } from "@/hooks/useBridgeTransaction";

const BASESCAN_SEPOLIA_URL = "https://sepolia.basescan.org/tx";

const STATUS_CONFIG: Record<
  BridgeStatusType,
  { label: string; color: string } | null
> = {
  idle: null,
  approving: { label: "Approving token spend...", color: "text-yellow-400" },
  sending: { label: "Sending bridge transaction...", color: "text-yellow-400" },
  confirming: { label: "Confirming transaction...", color: "text-yellow-400" },
  done: { label: "Bridge transaction sent!", color: "text-green-400" },
  error: { label: "Transaction failed", color: "text-red-400" },
};

export function BridgeStatus({
  status,
  txHash,
  error,
  onReset,
}: {
  status: BridgeStatusType;
  txHash: string | null;
  error: string | null;
  onReset: () => void;
}) {
  const config = STATUS_CONFIG[status];
  if (!config) return null;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 space-y-2">
      <div className="flex items-center gap-2">
        {(status === "approving" ||
          status === "sending" ||
          status === "confirming") && (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-blue-400" />
        )}
        <span className={`text-sm font-medium ${config.color}`}>
          {config.label}
        </span>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {txHash && (
        <a
          href={`${BASESCAN_SEPOLIA_URL}/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-blue-400 hover:text-blue-300 truncate"
        >
          View on BaseScan: {txHash}
        </a>
      )}

      {(status === "done" || status === "error") && (
        <button
          onClick={onReset}
          className="text-xs text-gray-400 hover:text-white underline"
        >
          {status === "error" ? "Try again" : "New bridge"}
        </button>
      )}
    </div>
  );
}
