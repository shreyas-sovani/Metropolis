import { radarSnapshotSchema, type ChainId, type RadarSnapshot } from "@lifeline/core";
import { jsonError, parseChain, pingHealth } from "./http";
import { createRefreshCache } from "./refresh-cache";

export const radarCache = createRefreshCache<RadarSnapshot>(2_000);

export async function handleRadar(input: {
  chain: string | null;
  now: number;
  load: (chainId: ChainId) => Promise<RadarSnapshot>;
  cache?: ReturnType<typeof createRefreshCache<RadarSnapshot>>;
  ping?: () => void;
}): Promise<Response> {
  const chainId = parseChain(input.chain);
  if (!chainId) return jsonError("chain", 400);
  const cache = input.cache ?? radarCache;
  try {
    const snapshot = await cache.read(String(chainId), input.now, () => input.load(chainId), input.ping ?? pingHealth);
    const parsed = radarSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) return jsonError("schema", 500);
    return Response.json(parsed.data, {
      headers: { "cache-control": "public, s-maxage=2, stale-while-revalidate=10" },
    });
  } catch {
    return jsonError("rpc", 502);
  }
}
