import crypto from "crypto";
import { PrivyClient } from "@privy-io/node";
import { config } from "./config.js";

/**
 * Singleton Privy client initialized with App ID and App Secret.
 * TEE execution must be enabled in the Privy Dashboard for Tier 2 chains (Stellar)
 * and server-side wallet access.
 */
export const privy = new PrivyClient({
  appId: config.privy.appId,
  appSecret: config.privy.appSecret,
});

/**
 * Returns an AuthorizationContext that signs requests with the stored
 * P-256 authorization private key. This replaces the need for any user
 * OTP or interactive auth — equivalent to Crossmint's external-wallet pattern.
 */
export function buildAuthContext() {
  return {
    authorization_private_keys: [config.privy.authorizationPrivateKey],
  };
}

/**
 * Derives the base64-encoded DER public key from a Privy authorization private key.
 *
 * The Dashboard exports private keys in the format:
 *   wallet-auth:<base64-PKCS8-DER>
 *
 * A PKCS8 private key embeds the public key, so we can extract it without
 * needing the user to copy/store the public key separately.
 *
 * The returned value is a raw base64-encoded SPKI DER public key,
 * which is what Privy's `owner: { public_key }` field expects.
 */
export function derivePublicKey(privKeyStr: string): string {
  // Strip the "wallet-auth:" prefix if present
  const base64Der = privKeyStr.replace(/^wallet-auth:/, "");
  const derBuffer = Buffer.from(base64Der, "base64");

  const privateKey = crypto.createPrivateKey({
    key: derBuffer,
    format: "der",
    type: "pkcs8",
  });

  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });

  return Buffer.from(publicKeyDer).toString("base64");
}

/** Lazily derived public key (computed once from the stored private key). */
export const authorizationPublicKey = derivePublicKey(
  config.privy.authorizationPrivateKey
);
