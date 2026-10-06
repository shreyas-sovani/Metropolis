import type { LiquidationHistory, LiquidationRow } from "./analytics.js";

export const HISTORY_TTL_MS = 60_000;

export interface CachedHistory extends LiquidationHistory {
  cursor: number;
  fetchedAt: number;
  stale: boolean;
}

export interface HistoryPage {
  rows: LiquidationRow[];
  cursor: number;
}

export function historyDue(fetchedAt: number | null, now: number, ttl = HISTORY_TTL_MS): boolean {
  return fetchedAt === null || now - fetchedAt >= ttl;
}

function rowKey(row: LiquidationRow): string {
  return `${row.blockNumber}:${row.perpId}:${row.positionType}:${row.liqLotLNS}:${row.markPricePNS}`;
}

export function recomputeHistory(rows: readonly LiquidationRow[]): LiquidationHistory {
  const ordered = [...rows].sort((left, right) => left.blockNumber - right.blockNumber);
  let notional = 0n;
  let idle = 0n;
  let eligibleCount = 0;
  let eligibleNotional = 0n;
  for (const row of ordered) {
    notional += BigInt(row.notionalMicro);
    idle += BigInt(row.idleAtLiq);
    if (row.eligible) {
      eligibleCount += 1;
      eligibleNotional += BigInt(row.notionalMicro);
    }
  }
  return {
    rows: ordered,
    latest: ordered.slice(-50),
    totals: { count: ordered.length, notionalMicro: notional.toString(), idleAtLiq: idle.toString() },
    eligible: { count: eligibleCount, notionalMicro: eligibleNotional.toString() },
  };
}

export function totalsMatch(history: LiquidationHistory): boolean {
  const again = recomputeHistory(history.rows);
  return (
    again.totals.count === history.totals.count &&
    again.totals.notionalMicro === history.totals.notionalMicro &&
    again.totals.idleAtLiq === history.totals.idleAtLiq &&
    again.eligible.count === history.eligible.count &&
    again.eligible.notionalMicro === history.eligible.notionalMicro
  );
}

export function appendRows(previous: readonly LiquidationRow[], incoming: readonly LiquidationRow[]): LiquidationRow[] {
  const seen = new Set(previous.map(rowKey));
  const rows = [...previous];
  for (const row of incoming) {
    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

/**
 * One full backfill, then a tail from the stored cursor at most once a minute.
 * A failed refresh keeps the last good payload and marks it stale.
 */
export class HistoryStore {
  hypersyncRequests = 0;
  private current: CachedHistory | null = null;
  private flight: Promise<CachedHistory> | null = null;

  constructor(
    private readonly load: (cursor: number) => Promise<HistoryPage>,
    private readonly startBlock: number,
  ) {}

  async get(now: number): Promise<CachedHistory> {
    if (this.current && !historyDue(this.current.fetchedAt, now)) {
      return { ...this.current, stale: false };
    }
    if (!this.flight) {
      this.flight = this.refresh(now).finally(() => {
        this.flight = null;
      });
    }
    return this.flight;
  }

  private async refresh(now: number): Promise<CachedHistory> {
    const cursor = this.current?.cursor ?? this.startBlock;
    this.hypersyncRequests += 1;
    try {
      const page = await this.load(cursor);
      const history = recomputeHistory(appendRows(this.current?.rows ?? [], page.rows));
      this.current = { ...history, cursor: page.cursor, fetchedAt: now, stale: false };
      return this.current;
    } catch {
      if (!this.current) throw new Error("history unavailable");
      return { ...this.current, stale: true };
    }
  }
}
