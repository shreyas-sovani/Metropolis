export interface MarketMeta {
  perpId: number;
  name: string;
  spark: number[];
  source: "perpl" | "onchain";
}

interface PerplMarket {
  id?: number;
  market_id?: number;
  symbol?: string;
  ticker?: string;
  name?: string;
  config?: { symbol?: string; name?: string; max_leverage?: number };
}

export function marketName(market: PerplMarket): { perpId: number; name: string } | null {
  const perpId = market.market_id ?? market.id;
  if (perpId === undefined) return null;
  const name = market.config?.name || market.name || market.config?.symbol || market.symbol || market.ticker;
  if (!name) return null;
  return { perpId, name };
}

export function sparkFromCandles(body: unknown): number[] {
  const series = body as { d?: { c?: number }[] };
  return (series.d ?? []).flatMap((candle) => (typeof candle.c === "number" ? [candle.c] : []));
}
