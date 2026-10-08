import { markCrossed } from "@lifeline/core";
import { HISTORY_MS } from "./hot.js";
import type { Sql } from "./schema.js";

/**
 * `liq_before` is `liquidationPricePNS` (price-native), the same unit as `markPNS`
 * from `getPositionV2`. `liquidationMicroFromContract` is that price in micro-dollars
 * and is not what this comparison uses.
 */
export function classifyWatched(input: {
  side: "long" | "short";
  preLiq: bigint;
  mark: bigint;
  open: boolean;
  saved: boolean;
}): "save" | "none" {
  if (input.saved) return "none";
  if (!input.open) return "none";
  if (!markCrossed(input.side, input.preLiq, input.mark)) return "none";
  return "save";
}

export interface WatchedAction {
  txHash: string;
  proxy: string;
  perpId: string;
  accountId: string;
  side: "long" | "short";
  market: string;
  preLiq: string;
  addedCNS: string;
}

export interface MarkView {
  mark: bigint;
  open: boolean;
  block: number;
}

const CACHE_MS = 60_000;
let watchedCache: { at: number; rows: WatchedAction[] } | null = null;
let recorded = 0;

export function resetWatchedCache(): void {
  watchedCache = null;
}

/** Bumps on every save insert, so a cached /saves body knows it is stale. */
export function savesRecorded(): number {
  return recorded;
}

/** Reads at most a week of watched actions through idx_actions_watched_at, never the whole table. */
function loadWatched(sql: Sql, now: number): WatchedAction[] {
  const rows = sql
    .exec(
      `SELECT a.tx_hash, a.proxy, a.perp_id, a.liq_before, a.amount_cns, p.side, p.market, p.account_id
       FROM actions a
       CROSS JOIN pool p ON p.proxy = a.proxy
       WHERE a.status = 'confirmed' AND a.liq_before IS NOT NULL AND a.liq_before != ''
         AND a.tx_hash IS NOT NULL AND a.tx_hash != '' AND a.tx_hash != 'inflight'
         AND a.created_at >= ?
         AND NOT EXISTS (SELECT 1 FROM saves s WHERE s.tx_hash = a.tx_hash)
       LIMIT 40`,
      now - HISTORY_MS,
    )
    .toArray() as {
    tx_hash?: string;
    proxy?: string;
    perp_id?: string;
    liq_before?: string;
    amount_cns?: string;
    side?: string;
    market?: string;
    account_id?: string;
  }[];
  return rows.flatMap((row) => {
    if (!row.tx_hash || !row.proxy || !row.perp_id || !row.liq_before || !row.account_id) return [];
    if (row.side !== "long" && row.side !== "short") return [];
    return [
      {
        txHash: row.tx_hash,
        proxy: row.proxy,
        perpId: row.perp_id,
        accountId: row.account_id,
        side: row.side,
        market: row.market ?? "",
        preLiq: row.liq_before,
        addedCNS: row.amount_cns ?? "0",
      },
    ];
  });
}

/** Watched actions whose mark was not already read this tick. */
export function missingWatched(views: ReadonlyMap<string, MarkView>): WatchedAction[] {
  return (watchedCache?.rows ?? []).filter((row) => !views.has(`${row.proxy}:${row.perpId}`));
}

/** Compare marks already read this tick. The watched-action query runs at most once a minute. */
export function noteSaves(sql: Sql, views: ReadonlyMap<string, MarkView>, now: number): number {
  if (!watchedCache || now - watchedCache.at >= CACHE_MS) {
    watchedCache = { at: now, rows: loadWatched(sql, now) };
  }
  let inserted = 0;
  const left: WatchedAction[] = [];
  for (const row of watchedCache.rows) {
    const view = views.get(`${row.proxy}:${row.perpId}`);
    if (!view) {
      left.push(row);
      continue;
    }
    const decision = classifyWatched({
      side: row.side,
      preLiq: BigInt(row.preLiq),
      mark: view.mark,
      open: view.open,
      saved: false,
    });
    if (!view.open) continue;
    if (decision !== "save") {
      left.push(row);
      continue;
    }
    sql.exec(
      `INSERT OR IGNORE INTO saves (tx_hash, proxy, perp_id, side, pre_liq, cross_block, cross_mark, added_cns, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.txHash,
      row.proxy,
      row.perpId,
      row.side,
      row.preLiq,
      view.block,
      view.mark.toString(),
      row.addedCNS,
      now,
    );
    inserted += 1;
    recorded += 1;
  }
  watchedCache = { at: watchedCache.at, rows: left };
  return inserted;
}
