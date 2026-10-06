import path from "node:path";
import type { NextConfig } from "next";

const e2eWallet = process.env.E2E_WALLET === "test";
const e2eWalletFile = e2eWallet ? "./lib/e2e-wallet.ts" : "./lib/e2e-wallet-absent.ts";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      "lifeline-e2e-wallet": e2eWalletFile,
    },
  },
  webpack: (config) => {
    const target = path.join(__dirname, e2eWallet ? "lib/e2e-wallet.ts" : "lib/e2e-wallet-absent.ts");
    const alias = config.resolve.alias;
    if (Array.isArray(alias)) alias.push({ name: "lifeline-e2e-wallet", alias: target });
    else config.resolve.alias = { ...(alias ?? {}), "lifeline-e2e-wallet": target };
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
