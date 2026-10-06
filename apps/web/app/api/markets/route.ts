import { createRefreshCache } from "../../../lib/refresh-cache";
import { marketName, sparkFromCandles, type MarketMeta } from "../../../lib/markets";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

const PERPL = "https://app.perpl.xyz/api";
const cache = createRefreshCache<MarketMeta[]>(300_000);

async function load(): Promise<MarketMeta[]> {
  const context = await fetch(`${PERPL}/v1/pub/context`);
  if (!context.ok) throw new Error("context");
  const body = (await context.json()) as { markets?: unknown[] };
  const named = (body.markets ?? []).flatMap((item) => {
    const market = marketName(item as Parameters<typeof marketName>[0]);
    return market ? [market] : [];
  });
  const to = Date.now();
  const from = to - 24 * 60 * 60 * 1000;
  const sparks = await Promise.all(
    named.slice(0, 12).map(async (market) => {
      try {
        const response = await fetch(`${PERPL}/v1/market-data/${market.perpId}/candles/3600/${from}-${to}`);
        if (!response.ok) return [];
        return sparkFromCandles(await response.json());
      } catch {
        return [];
      }
    }),
  );
  return named.slice(0, 12).map((market, index) => ({
    perpId: market.perpId,
    name: market.name,
    spark: sparks[index] ?? [],
    source: "perpl" as const,
  }));
}

export async function GET(): Promise<Response> {
  try {
    const markets = await cache.read("perpl", Date.now(), load);
    return Response.json(
      { markets, source: "perpl" },
      { headers: { "cache-control": "public, s-maxage=300" } },
    );
  } catch {
    return Response.json({ markets: [], source: "onchain" }, { headers: { "cache-control": "public, s-maxage=30" } });
  }
}
