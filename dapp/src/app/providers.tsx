"use client";

import { type ReactNode } from "react";
import {
  CrossmintProvider,
  CrossmintAuthProvider,
  CrossmintWalletProvider,
} from "@crossmint/client-sdk-react-ui";
import { CrossmintWalletsProvider } from "@/hooks/useCrossmintWallets";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CrossmintProvider apiKey={process.env.NEXT_PUBLIC_CROSSMINT_API_KEY!}>
      <CrossmintAuthProvider loginMethods={["email", "google"]}>
        <CrossmintWalletProvider
          createOnLogin={{
            chain: "stellar",
            signer: { type: "email" },
          }}
        >
          <CrossmintWalletsProvider>{children}</CrossmintWalletsProvider>
        </CrossmintWalletProvider>
      </CrossmintAuthProvider>
    </CrossmintProvider>
  );
}
