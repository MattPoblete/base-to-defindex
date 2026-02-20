"use client";

interface BridgePreviewProps {
  amount: string;
  amountToReceive: string | null;
  fee: string | null;
  estimatedTime: string | null;
  token: string;
  loading: boolean;
  error: string | null;
}

function PreviewRow({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | null;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-400">{label}</span>
      {loading ? (
        <span className="h-4 w-20 animate-pulse rounded bg-gray-700" />
      ) : (
        <span className="text-sm text-white">{value ?? "--"}</span>
      )}
    </div>
  );
}

export function BridgePreview({
  amount,
  amountToReceive,
  fee,
  estimatedTime,
  token,
  loading,
  error,
}: BridgePreviewProps) {
  const hasAmount = parseFloat(amount) > 0;

  if (!hasAmount) return null;

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-0.5">
      <PreviewRow label="You send" value={`${amount} ${token}`} loading={false} />
      <PreviewRow
        label="You receive"
        value={amountToReceive ? `${parseFloat(amountToReceive).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${token}` : null}
        loading={loading}
      />
      <PreviewRow
        label="Bridge fee"
        value={fee ? `${fee} ETH` : null}
        loading={loading}
      />
      <PreviewRow
        label="Est. time"
        value={estimatedTime}
        loading={loading}
      />
    </div>
  );
}
