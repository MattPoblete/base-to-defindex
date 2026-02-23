import type { BridgeStatus as BridgeStatusType } from "@/hooks/useBridgeTransaction";
import type { BridgeProgress } from "@/services/allbridge/types";

const BASESCAN_URL = "https://basescan.org/tx";
const STELLAR_EXPERT_URL = "https://stellar.expert/explorer/public/tx";

const STATUS_CONFIG: Record<
  BridgeStatusType,
  { label: string; color: string } | null
> = {
  idle: null,
  approving: { label: "Approving token spend...", color: "text-yellow-400" },
  sending: { label: "Sending bridge transaction...", color: "text-yellow-400" },
  confirming: { label: "Confirming bridge...", color: "text-yellow-400" },
  done: { label: "Bridge complete!", color: "text-green-400" },
  error: { label: "Transaction failed", color: "text-red-400" },
};

function getProgressLabel(progress: BridgeProgress): string {
  switch (progress.phase) {
    case "indexing":
      return `Waiting for indexing... (attempt ${progress.pollAttempt})`;
    case "sending":
      return progress.sendConfirmations != null &&
        progress.sendConfirmationsNeeded != null
        ? `Confirmations: ${progress.sendConfirmations}/${progress.sendConfirmationsNeeded}`
        : "Waiting for confirmations...";
    case "signing":
      return progress.signaturesCount != null &&
        progress.signaturesNeeded != null
        ? `Signatures: ${progress.signaturesCount}/${progress.signaturesNeeded}`
        : "Collecting validator signatures...";
    case "receiving":
      return "Waiting for receive on Stellar...";
    case "complete":
      return progress.receiveAmount != null
        ? `Received ${progress.receiveAmount} USDC on Stellar`
        : "Bridge complete!";
  }
}

export function BridgeStatus({
  status,
  txHash,
  error,
  progress,
  stellarTxId,
  onReset,
}: {
  status: BridgeStatusType;
  txHash: string | null;
  error: string | null;
  progress: BridgeProgress | null;
  stellarTxId: string | null;
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

      {status === "confirming" && progress && (
        <p className="text-xs text-gray-400">{getProgressLabel(progress)}</p>
      )}

      {status === "done" && progress?.phase === "complete" && (
        <p className="text-xs text-green-300">{getProgressLabel(progress)}</p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {txHash && (
        <a
          href={`${BASESCAN_URL}/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-blue-400 hover:text-blue-300 truncate"
        >
          View on BaseScan: {txHash}
        </a>
      )}

      {stellarTxId && (
        <a
          href={`${STELLAR_EXPERT_URL}/${stellarTxId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-blue-400 hover:text-blue-300 truncate"
        >
          View on Stellar Explorer: {stellarTxId}
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
