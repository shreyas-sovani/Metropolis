export const VOLATILE_CANDIDATES = ["MON", "PUMP", "NEAR", "ZEC"] as const;

/** Variance of successive relative mark moves. Higher means a more volatile market. */
export function returnVariance(prices: readonly bigint[]): number | null {
  if (prices.length < 3) return null;
  const moves: number[] = [];
  for (let index = 1; index < prices.length; index += 1) {
    const previous = prices[index - 1];
    const next = prices[index];
    if (previous === undefined || next === undefined || previous <= 0n) continue;
    moves.push(Number(next - previous) / Number(previous));
  }
  if (moves.length < 2) return null;
  const mean = moves.reduce((sum, value) => sum + value, 0) / moves.length;
  return moves.reduce((sum, value) => sum + (value - mean) ** 2, 0) / moves.length;
}

export function rankMarkets(
  samples: readonly { symbol: string; prices: readonly bigint[] }[],
): { symbol: string; variance: number; samples: number }[] {
  const ranked = [];
  for (const sample of samples) {
    const variance = returnVariance(sample.prices);
    if (variance === null) continue;
    ranked.push({ symbol: sample.symbol, variance, samples: sample.prices.length });
  }
  ranked.sort((left, right) => right.variance - left.variance || left.symbol.localeCompare(right.symbol));
  return ranked;
}
