import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { ADDRESSES } from "../config/addresses.js";
import { CHAINS, type ChainId } from "../config/chains.js";

/** Read client: public RPC fallback, Multicall3 from PRD §5.2. */
export function createReadClient(
  chainId: ChainId,
  urls: readonly string[],
  timeout = 20_000,
): PublicClient {
  const first = urls[0];
  if (!first) throw new Error(`no RPC urls for chain ${chainId}`);
  const base = CHAINS[chainId];
  return createPublicClient({
    chain: {
      ...base,
      contracts: {
        ...base.contracts,
        multicall3: { address: ADDRESSES[chainId].multicall3 },
      },
    },
    transport: fallback(
      urls.map((url) => http(url, { timeout, retryCount: 1 })),
    ),
    batch: { multicall: { batchSize: 128, wait: 0 } },
  });
}
