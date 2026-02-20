"use client";

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  balance: string | null;
  token: string;
  disabled?: boolean;
}

export function AmountInput({
  value,
  onChange,
  balance,
  token,
  disabled,
}: AmountInputProps) {
  const numBalance = balance ? parseFloat(balance) : 0;
  const numValue = parseFloat(value);
  const exceedsBalance = !isNaN(numValue) && numValue > numBalance && numBalance > 0;

  function handleMax() {
    if (balance) {
      onChange(balance);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm text-gray-400">Amount</label>
        {balance !== null && (
          <span className="text-xs text-gray-500">
            Balance: {parseFloat(balance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {token}
          </span>
        )}
      </div>

      <div
        className={`flex items-center rounded-lg border bg-gray-800 px-4 py-3 transition-colors ${
          exceedsBalance ? "border-red-500" : "border-gray-700 focus-within:border-blue-500"
        }`}
      >
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) {
              onChange(v);
            }
          }}
          disabled={disabled}
          className="flex-1 bg-transparent text-lg text-white outline-none placeholder:text-gray-600 disabled:opacity-50"
        />
        <span className="ml-2 text-sm font-medium text-gray-400">{token}</span>
        {balance && (
          <button
            onClick={handleMax}
            disabled={disabled}
            className="ml-2 rounded bg-gray-700 px-2 py-0.5 text-xs font-medium text-blue-400 hover:bg-gray-600 disabled:opacity-50"
          >
            MAX
          </button>
        )}
      </div>

      {exceedsBalance && (
        <p className="text-xs text-red-400">Insufficient balance</p>
      )}
    </div>
  );
}
