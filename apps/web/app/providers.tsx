"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { monad, monadTestnet } from "viem/chains";
import type { ReactNode } from "react";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export function Providers({ children }: { children: ReactNode }) {
  if (!appId) return children;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet, monad],
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          showWalletUIs: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
