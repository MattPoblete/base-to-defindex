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
  stellarChain: isStaging ? "stellar" : "stellar",
  stellarToken: "usdxm",
  walletEmail: process.env.CROSSMINT_WALLET_EMAIL ?? "",
  isStaging,
  nearIntents: {
    baseUrl: "https://1click.chaindefuser.com",
    jwt: process.env.NEAR_INTENTS_JWT ?? "",
  },
  baseUsdcContract: isStaging
    ? "0x14196F08a4Fa0B66B7331bC40dd6bCd8A1dEeA9F" // USDXM on base-sepolia
    : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on base mainnet
  nearIntentsOriginAsset: isStaging
    ? ""
    : "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  clientApiKey: process.env.CROSSMINT_CLIENT_API_KEY ?? "",
  signerType: (process.env.CROSSMINT_SIGNER_TYPE ?? "api-key") as "api-key" | "email",
  evmPrivateKey: process.env.EVM_PRIVATE_KEY ?? "",
  baseRpcUrl: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
  sorobanRpcUrl:
    process.env.SOROBAN_RPC_URL ?? "https://rpc.stellar.org:443",
  stellarHorizonUrl:
    process.env.STELLAR_HORIZON_URL ?? "https://horizon.stellar.org",
};

// Validate Crossmint env vars (warn instead of throw so non-Crossmint scripts can import config)
if (!config.apiKey) {
  console.warn(
    "Warning: CROSSMINT_SERVER_API_KEY is not set. Crossmint scripts will fail."
  );
}
if (!config.walletEmail) {
  console.warn(
    "Warning: CROSSMINT_WALLET_EMAIL is not set. Crossmint scripts will fail."
  );
}
