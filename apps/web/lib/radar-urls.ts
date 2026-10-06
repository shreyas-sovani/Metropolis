import { rpcUrls, type ChainId } from "@lifeline/core";

/** Dev-only: a dead first URL forces the public-RPC fallback. */
export function radarUrls(chainId: ChainId, deadPrimary: boolean): string[] | undefined {
  if (!deadPrimary) return undefined;
  return ["http://127.0.0.1:9", ...rpcUrls(chainId)];
}
