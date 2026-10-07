export interface TwinLegRow {
  pairId: string;
  market: string;
  side: string;
  perpId: string;
  role: string;
  proxy: string;
  mandate: string;
}

export interface TwinAction {
  txHash: string;
  block: number | null;
  amountCNS: string;
}

export interface TwinLegView {
  proxy: string;
  mandate: string;
  distanceE6: string | null;
  distanceError?: "rpc";
  actions: TwinAction[];
  outcome: string;
}

export interface TwinPairView {
  id: string;
  market: string;
  side: string;
  perpId: string;
  protected: TwinLegView | null;
  unprotected: TwinLegView | null;
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
    const leg = { proxy: row.proxy, mandate: row.mandate || "none", distanceE6: null, actions: [], outcome: "alive" };
    if (row.role === "twin-protected") pair.protected = leg;
    if (row.role === "twin-unprotected") pair.unprotected = leg;
    pairs.set(row.pairId, pair);
  }
  return [...pairs.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Open and still short of liquidation is alive. A non-positive distance has crossed. */
export function twinOutcome(open: boolean, distanceE6: bigint | null, block: number | null): string {
  if (!open) return `liquidated at block ${block ?? 0}`;
  if (distanceE6 !== null && distanceE6 <= 0n) return `crossed liq at block ${block ?? 0}`;
  return "alive";
}
