import { formatAgo, formatPct, formatUsd, formatUsdCompact } from "./format";

/** Buckets run from −15% to +15% in 0.25% steps: indexes 0 through 120. */
export const BUCKET_SLOTS = 121;
const AXIS_MIN = -15;
const AXIS_SPAN = 30;

export interface RadarMarketLike {
  perpId: number;
  symbol: string;
  atRiskNotionalMicro?: string;
  buckets: readonly unknown[];
  atRisk?: readonly { notionalMicro: string }[];
}

export function atRiskNotional(market: RadarMarketLike): bigint {
  if (market.atRiskNotionalMicro) return BigInt(market.atRiskNotionalMicro);
  return (market.atRisk ?? []).reduce((sum, row) => sum + BigInt(row.notionalMicro || "0"), 0n);
}

/** Markets with liquidation buckets, closest money first. Empty books stay out of the chart. */
export function marketsForChart<T extends RadarMarketLike>(markets: readonly T[]): T[] {
  return markets
    .filter((market) => market.buckets.length > 0)
    .sort((left, right) => {
      const diff = atRiskNotional(right) - atRiskNotional(left);
      if (diff > 0n) return 1;
      if (diff < 0n) return -1;
      return left.symbol.localeCompare(right.symbol);
    });
}

export function emptyMarketSymbols<T extends RadarMarketLike>(markets: readonly T[]): string[] {
  return markets.filter((market) => market.buckets.length === 0).map((market) => market.symbol);
}

export function emptyMarketLine(symbols: readonly string[]): string | null {
  if (symbols.length === 0) return null;
  return `No positions near liquidation in ${symbols.join(", ")}.`;
}

/** BTC when it has a chart, otherwise the first chip. */
export function defaultMarketId(markets: readonly { perpId: number; symbol: string }[]): number | null {
  return markets.find((market) => market.symbol === "BTC")?.perpId ?? markets[0]?.perpId ?? null;
}

/** Mark price shifted by `pct` percent. `pct` is −15 … +15. */
export function priceAtOffset(markMicro: string, pct: number): string {
  const mark = BigInt(markMicro || "0");
  const bps = BigInt(Math.round(pct * 100));
  const scaled = 10_000n + bps;
  if (scaled <= 0n) return "0";
  return ((mark * scaled) / 10_000n).toString();
}

export function axisTicks(markMicro: string): { pct: number; price: string; pctLabel: string }[] {
  const ticks = [];
  for (let pct = -15; pct <= 15; pct += 5) {
    const price = formatUsd(priceAtOffset(markMicro, pct));
    const pctLabel = pct === 0 ? "0%" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
    ticks.push({ pct, price, pctLabel });
  }
  return ticks;
}

export function bucketPriceSpan(markMicro: string, index: number): { low: string; high: string } {
  const start = AXIS_MIN + index * 0.25;
  const end = start + 0.25;
  const left = priceAtOffset(markMicro, Math.min(start, end));
  const right = priceAtOffset(markMicro, Math.max(start, end));
  return { low: formatUsd(left), high: formatUsd(right) };
}

export function bucketSentence(
  bucket: { side: "long" | "short"; count: number; notionalMicro: string; index: number; idleCount?: number },
  markMicro: string,
): string {
  const side = bucket.side === "long" ? "longs" : "shorts";
  const span = bucketPriceSpan(markMicro, bucket.index);
  const idle = bucket.idleCount ?? 0;
  const verb = idle === 1 ? "has" : "have";
  return `${bucket.count} ${side} · ${formatUsdCompact(bucket.notionalMicro)} · liquidate between ${span.low} and ${span.high} · ${idle} ${verb} idle AUSD.`;
}

/** Square-root bar height, 0…1, against the tallest bucket on the chart. */
export function barFraction(notionalMicro: string, maxMicro: string): number {
  const notional = Number(notionalMicro);
  const max = Number(maxMicro);
  if (!Number.isFinite(notional) || !Number.isFinite(max) || max <= 0 || notional <= 0) return 0;
  return Math.sqrt(notional) / Math.sqrt(max);
}

/** 0 at −15%, 1 at +15%. */
export function axisFraction(pct: number): number {
  return (pct - AXIS_MIN) / AXIS_SPAN;
}

export function bucketLeft(index: number): number {
  return index / BUCKET_SLOTS;
}

export function penaltySentence(paid: string, avoidable: string): string {
  return `Of ${paid} in penalties over 30 days, ${avoidable} belonged to accounts whose idle AUSD could have moved the liquidation price at least 1% away.`;
}

export function riskSentence(row: {
  id: string;
  market: string;
  side: string;
  notionalMicro: string;
  distanceE6: string;
  freeMicro: string;
}): string {
  return `${row.id} · ${row.market} ${row.side} · ${formatUsd(row.notionalMicro)} · ${formatPct(row.distanceE6)} from liquidation · ${formatUsd(row.freeMicro)} idle AUSD.`;
}

export function highlightedBucket(
  rows: readonly { id: string; side: "long" | "short"; bucketIndex?: number }[],
  highlightId: string | undefined,
): { index: number; side: "long" | "short" } | null {
  if (!highlightId) return null;
  const row = rows.find((item) => item.id === highlightId && item.bucketIndex !== undefined);
  if (!row || row.bucketIndex === undefined) return null;
  return { index: row.bucketIndex, side: row.side };
}

/** Rough age of a past block, using a 1 second block time. */
export function blockAgo(nowBlock: string, thenBlock: number, nowMs: number, blockMs = 1_000): string {
  const delta = Math.max(0, Number(nowBlock) - thenBlock);
  return formatAgo(nowMs - delta * blockMs, nowMs);
}
