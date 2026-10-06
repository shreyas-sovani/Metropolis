export interface TwinLegRow {
  pairId: string;
  market: string;
  side: string;
  perpId: string;
  role: string;
  proxy: string;
  mandate: string;
}

export interface TwinPairView {
  id: string;
  market: string;
  side: string;
  perpId: string;
  protected: { proxy: string; mandate: string } | null;
  unprotected: { proxy: string; mandate: string } | null;
}

/** Group registered legs into pairs. Protected keeps the house mandate; unprotected does not. */
export function assembleTwinPairs(rows: readonly TwinLegRow[]): TwinPairView[] {
  const pairs = new Map<string, TwinPairView>();
  for (const row of rows) {
    if (!row.pairId) continue;
    const pair = pairs.get(row.pairId) ?? {
      id: row.pairId,
      market: row.market,
      side: row.side,
      perpId: row.perpId,
      protected: null,
      unprotected: null,
    };
    const leg = { proxy: row.proxy, mandate: row.mandate || "none" };
    if (row.role === "twin-protected") pair.protected = leg;
    if (row.role === "twin-unprotected") pair.unprotected = leg;
    pairs.set(row.pairId, pair);
  }
  return [...pairs.values()].sort((left, right) => left.id.localeCompare(right.id));
}
