import { forgetActions, type HotState } from "./hot.js";
import type { Sql } from "./schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
/** Dashboard activity and twin legs show top-ups from the last 30 days. */
export const ACTION_KEEP_MS = 30 * DAY_MS;
/** The sandbox rate limit only looks back one hour. */
export const SANDBOX_HIT_KEEP_MS = 7 * DAY_MS;
/** Rows deleted per table per run. Each delete also writes every index entry the row had. */
export const PRUNE_BATCH = 100;

export function pruneDue(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= PRUNE_INTERVAL_MS;
}

/**
 * Deletes settled history past the horizon, oldest first, at most PRUNE_BATCH rows per table.
 * Pending actions are never deleted. Claims and saves are not pruned: a claim binds a user to their account
 * and the table is capped by the pool, and saves are the record the product reports.
 */
export function pruneHistory(sql: Sql, now: number, hot?: HotState | null): boolean {
  let last: number | null;
  if (hot?.loaded) {
    last = hot.prunedAt;
  } else {
    const row = sql.exec("SELECT pruned_at FROM keeper_stats WHERE id = 1").toArray()[0] as
      | { pruned_at?: number | null }
      | undefined;
    last = row?.pruned_at == null ? null : Number(row.pruned_at);
  }
  if (!pruneDue(last, now)) return false;
  sql.exec("UPDATE keeper_stats SET pruned_at = ? WHERE id = 1", now);
  if (hot) hot.prunedAt = now;
  const ids = sql
    .exec(
      "SELECT id FROM actions WHERE created_at < ? AND status IN ('confirmed', 'reverted') LIMIT ?",
      now - ACTION_KEEP_MS,
      PRUNE_BATCH,
    )
    .toArray()
    .map((row) => Number(row.id));
  for (const id of ids) sql.exec("DELETE FROM actions WHERE id = ?", id);
  forgetActions(hot, ids);
  sql.exec(
    "DELETE FROM sandbox_hits WHERE id IN (SELECT id FROM sandbox_hits WHERE at < ? LIMIT ?)",
    now - SANDBOX_HIT_KEEP_MS,
    PRUNE_BATCH,
  );
  return true;
}
