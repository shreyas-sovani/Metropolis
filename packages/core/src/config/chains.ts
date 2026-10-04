import { monad, monadTestnet, type Chain } from "viem/chains";

export const MAINNET_ID = 143 as const;
export const TESTNET_ID = 10143 as const;
export const CHAIN_IDS = [MAINNET_ID, TESTNET_ID] as const;
export type ChainId = (typeof CHAIN_IDS)[number];

if (monad.id !== MAINNET_ID) {
  throw new Error(`viem monad.id ${monad.id} !== ${MAINNET_ID}`);
}
if (monadTestnet.id !== TESTNET_ID) {
  throw new Error(`viem monadTestnet.id ${monadTestnet.id} !== ${TESTNET_ID}`);
}

export const CHAINS: Record<ChainId, Chain> = {
  [MAINNET_ID]: monad,
  [TESTNET_ID]: monadTestnet,
};

/**
 * Public RPC order from PRD §5.7: rpc.monad.xyz, then Monad infra, then Alchemy.
 * Testnet docs publish no Alchemy URL; pass one in via `rpcUrls`.
 */
export const PUBLIC_RPC_URLS: Record<ChainId, readonly string[]> = {
  [MAINNET_ID]: [
    "https://rpc.monad.xyz",
    "https://rpc-mainnet.monadinfra.com",
    "https://rpc1.monad.xyz",
  ],
  [TESTNET_ID]: [
    "https://testnet-rpc.monad.xyz",
    "https://rpc-testnet.monadinfra.com",
  ],
};

export function rpcUrls(chainId: ChainId, alchemyUrl?: string): string[] {
  const urls = [...PUBLIC_RPC_URLS[chainId]];
  if (alchemyUrl && !urls.includes(alchemyUrl)) urls.push(alchemyUrl);
  return urls;
}
