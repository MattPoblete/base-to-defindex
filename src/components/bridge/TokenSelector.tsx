"use client";

import type { SupportedToken } from "@/services/allbridge/config";

interface TokenSelectorProps {
  value: SupportedToken;
  onChange: (token: SupportedToken) => void;
  disabled?: boolean;
}

export function TokenSelector({ value, onChange, disabled }: TokenSelectorProps) {
  return (
    <div className="flex gap-2">
      {(["USDC"] as const).map((token) => (
        <button
          key={token}
          onClick={() => onChange(token)}
          disabled={disabled}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
            value === token
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          {token}
        </button>
      ))}
    </div>
  );
}
