import "dotenv/config";
import { 
  BASE_MAINNET_CHAIN_ID, 
  STELLAR_MAINNET_CHAIN_ID,
  SONIC_MAINNET_CHAIN_ID
} from "@sodax/sdk";

const env = process.env.CROSSMINT_ENV ?? "staging";
const isStaging = env === "staging";

export const SOROSWAP_EARN_USDC_VAULT="CA2FIPJ7U6BG3N7EOZFI74XPJZOEOD4TYWXFVCIO5VDCHTVAGS6F4UKK"
export const XLM_DEFINDEX_VAULT_TESTNET = "CCLV4H7WTLJQ7ATLHBBQV2WW3OINF3FOY5XZ7VPHZO7NH3D2ZS4GFSF6"

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
  stellarUsdcContract: isStaging
    ? "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75" // TODO: Verify testnet USDCXM or similar
    : "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", // USDC on stellar mainnet
  nearIntentsOriginAsset: isStaging
    ? ""
    : "nep141:base-0x833589fcd6edb6e08f4c7c32D4f71b54bda02913.omft.near",
  clientApiKey: process.env.CROSSMINT_CLIENT_API_KEY ?? "",
  signerType: (process.env.CROSSMINT_SIGNER_TYPE ?? "api-key") as "api-key" | "email",
  evmPrivateKey: process.env.EVM_PRIVATE_KEY ?? "",
  stellarServerKey: process.env.STELLAR_SERVER_KEY ?? "",
  baseRpcUrl: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
  sorobanRpcUrl:
    process.env.SOROBAN_RPC_URL ?? "https://rpc.stellar.org:443",
  stellarHorizonUrl:
    process.env.STELLAR_HORIZON_URL ?? "https://horizon.stellar.org",
  
  // Sodax specific
  sodax: {
    baseUsdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    stellarUsdc: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    usdcDecimals: 6,
    stellarDecimals: 7,
    baseChainId: BASE_MAINNET_CHAIN_ID,
    stellarChainId: STELLAR_MAINNET_CHAIN_ID,
    hubChainId: SONIC_MAINNET_CHAIN_ID,
  },
  
  // Common Bridge Params
  bridge: {
    amount: "0.1",
    usdcDecimals: 6,
  },

  // DeFindex vault deposit (optional)
  defindexApiUrl: process.env.DEFINDEX_API_URL ?? "https://api.defindex.io",
  defindexVaultAddress: SOROSWAP_EARN_USDC_VAULT,
  defindexApiKey: process.env.DEFINDEX_API_KEY ?? "",

  // Privy server-wallet config
  privy: {
    appId: process.env.PRIVY_APP_ID ?? "",
    appSecret: process.env.PRIVY_APP_SECRET ?? "",
    // Dashboard-generated format: "wallet-auth:<base64-PKCS8-DER>"
    // Public key is derived from this at runtime — no need to store it separately.
    authorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY ?? "",
  },
};

// Validate Crossmint env vars (warn instead of throw so non-Crossmint scripts can import config)
if (!config.apiKey && !config.evmPrivateKey) {
  console.warn(
    "Warning: Neither CROSSMINT_SERVER_API_KEY nor EVM_PRIVATE_KEY is set. Most scripts will fail."
  );
}
