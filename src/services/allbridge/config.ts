import { ChainSymbol, type NodeRpcUrls } from "@allbridge/bridge-core-sdk";

export const ALLBRIDGE_NODE_URLS: NodeRpcUrls = {
  [ChainSymbol.BAS]: process.env.NEXT_PUBLIC_BASE_RPC_URL!,
  [ChainSymbol.SRB]: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL!,
  [ChainSymbol.STLR]: process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL!,
};

export const SUPPORTED_TOKENS = ["USDC"] as const;
export type SupportedToken = (typeof SUPPORTED_TOKENS)[number];
