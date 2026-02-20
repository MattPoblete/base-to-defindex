import "dotenv/config";

const env = process.env.CROSSMINT_ENV ?? "staging";
const isStaging = env === "staging";

export const config = {
  apiKey: process.env.CROSSMINT_SERVER_API_KEY ?? "",
  baseUrl: isStaging
    ? "https://staging.crossmint.com"
    : "https://www.crossmint.com",
  chain: isStaging ? "base-sepolia" : "base",
  token: isStaging ? "usdxm" : "usdc",
  walletEmail: process.env.CROSSMINT_WALLET_EMAIL ?? "",
  isStaging,
};

// Validate required env vars
if (!config.apiKey) {
  throw new Error("CROSSMINT_SERVER_API_KEY is required. See .env.example");
}
if (!config.walletEmail) {
  throw new Error("CROSSMINT_WALLET_EMAIL is required. See .env.example");
}
