"use client";

export function ChainSelector() {
  return (
    <div className="flex items-center gap-3">
      <ChainBadge label="Base" active />
      <svg
        className="h-4 w-4 text-gray-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13 7l5 5m0 0l-5 5m5-5H6"
        />
      </svg>
      <ChainBadge label="Stellar" active />
    </div>
  );
}

function ChainBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active
          ? "bg-gray-800 text-white"
          : "bg-gray-900 text-gray-500"
      }`}
    >
      {label}
    </span>
  );
}
