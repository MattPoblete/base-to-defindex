/**
 * Optional utility: generate a P-256 authorization keypair programmatically.
 *
 * NOTE: The easiest approach is to create the key directly in the Privy Dashboard:
 *   Dashboard → Your App → Wallets → Authorization keys → New key
 *   Copy the displayed private key (wallet-auth:... format) into .env.
 *   The public key is derived from it at runtime automatically.
 *
 * Use this script only if you prefer to generate keys locally (e.g. CI/CD secrets).
 * Usage:  pnpm privy-keygen
 */
import { generateP256KeyPair } from "@privy-io/node";

const { privateKey, publicKey } = await generateP256KeyPair();

console.log("──────────────────────────────────────────────────────────────");
console.log("Privy P-256 Authorization Keypair (programmatically generated)");
console.log("──────────────────────────────────────────────────────────────");
console.log("\nAdd the private key to your .env:\n");
console.log(`PRIVY_AUTHORIZATION_PRIVATE_KEY=${privateKey}`);
console.log("\n⚠️  You must ALSO register the PUBLIC KEY in Privy Dashboard:");
console.log("   Dashboard → Your App → Wallets → Authorization keys → New key");
console.log(`\n   Public key (paste into Dashboard):\n   ${publicKey}`);
console.log("\nℹ️  If you create the key via Dashboard instead, the private key");
console.log("   is displayed as wallet-auth:<base64> — just paste that into .env.");
console.log("──────────────────────────────────────────────────────────────");
