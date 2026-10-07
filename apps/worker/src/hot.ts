import type { Sql } from "./schema.js";

/** Same shape as the recycle gate: refresh at most once a minute. */
export const HOT_TTL_MS = 60_000;
export const HISTORY_MS = 7 * 24 * 60 * 60 * 1000;
export const HISTORY_LIMIT = 200;

export function hotDue(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= HOT_TTL_MS;
}

export interface PoolRow {
  proxy: string;
  account_id: string;
  perp_id: string;
  side: string;
  leverage: string;
  status: string;
  market: string;
  role: string;
  pair_id: string;
}

export interface MandateRow {
  proxy: string;
  owner: string;
  typed_data: string;
  sig: string;
  active: number;
  budget_used_cns: string;
  kind: string;
}

/** Armed mandate joined to its pool row. Keeper order follows the mandates scan. */
export interface HouseRow extends PoolRow {
  owner: string;
  typed_data: string;
  sig: string;
  active: number;
  budget_used_cns: string;
  kind: string;
}

export interface ActionRow {
  id: number;
  proxy: string;
  perp_id: string;
  amount_cns: string;
  tx_hash: string | null;
  block: number | null;
  dist_before: string | null;
  dist_after: string | null;
  status: string;
  reason: string;
  liq_before: string | null;
}

export interface ClaimRow {
  proxy: string;
  claimed_at: number;
}

export interface HotState {
  at: number;
  loaded: boolean;
  armed: HouseRow[];
  pools: PoolRow[];
  mandates: MandateRow[];
  pending: ActionRow[];
  openDist: ActionRow[];
  lastBlock: Map<string, number>;
  openClaims: ClaimRow[];
  canaryAt: number | null;
  recycledAt: number | null;
  startedAt: number | null;
  maxGapMs: number;
  lastError: string | null;
  canaryProxy: { proxy: string; perp_id: string } | null;
  claimsToday: number;
}

export function blankHot(): HotState {
  return {
    at: 0,
    loaded: false,
    armed: [],
    pools: [],
    mandates: [],
    pending: [],
    openDist: [],
    lastBlock: new Map(),
    openClaims: [],
    canaryAt: null,
    recycledAt: null,
    startedAt: null,
    maxGapMs: 0,
    lastError: null,
    canaryProxy: null,
    claimsToday: 0,
  };
}

export function blockKey(proxy: string, perpId: string): string {
  return `${proxy}:${perpId}`;
}

export function cachedBlock(hot: HotState, proxy: string, perpId: string): bigint | null {
  const block = hot.lastBlock.get(blockKey(proxy, perpId));
  return block === undefined ? null : BigInt(block);
}

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

function int(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function poolFrom(row: Record<string, unknown>): PoolRow {
  return {
    proxy: str(row.proxy),
    account_id: str(row.account_id),
    perp_id: str(row.perp_id),
    side: str(row.side),
    leverage: str(row.leverage),
    status: str(row.status),
    market: str(row.market),
    role: str(row.role),
    pair_id: str(row.pair_id),
  };
}

function mandateFrom(row: Record<string, unknown>): MandateRow {
  return {
    proxy: str(row.proxy),
    owner: str(row.owner),
    typed_data: str(row.typed_data),
    sig: str(row.sig),
    active: int(row.active) ?? 0,
    budget_used_cns: str(row.budget_used_cns),
    kind: str(row.kind),
  };
}

function actionFrom(row: Record<string, unknown>): ActionRow {
  return {
    id: int(row.id) ?? 0,
    proxy: str(row.proxy),
    perp_id: str(row.perp_id),
    amount_cns: str(row.amount_cns),
    tx_hash: textOrNull(row.tx_hash),
    block: int(row.block),
    dist_before: textOrNull(row.dist_before),
    dist_after: textOrNull(row.dist_after),
    status: str(row.status),
    reason: str(row.reason),
    liq_before: textOrNull(row.liq_before),
  };
}

function houseFrom(pool: PoolRow, mandate: MandateRow): HouseRow {
  return { ...pool, ...mandate, active: 1 };
}

/** One indexed read of the hot tables. Callers serve ticks from the result until HOT_TTL_MS. */
export function hydrateHot(sql: Sql, hot: HotState, now: number): void {
  const pools = sql
    .exec("SELECT proxy, account_id, perp_id, side, leverage, status, market, role, pair_id FROM pool")
    .toArray()
    .map((row) => poolFrom(row));
  const mandates = sql
    .exec("SELECT proxy, owner, typed_data, sig, active, budget_used_cns, kind FROM mandates")
    .toArray()
    .map((row) => mandateFrom(row));
  const armedRows = sql
    .exec(
      `SELECT p.proxy, p.account_id, p.perp_id, p.role, p.side, p.status, p.market, p.leverage, p.pair_id,
              m.owner, m.typed_data, m.sig, m.active, m.budget_used_cns, m.kind
       FROM mandates m JOIN pool p ON p.proxy = m.proxy WHERE m.active = 1`,
    )
    .toArray();
  const pending = sql
    .exec(
      `SELECT id, proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, liq_before
       FROM actions WHERE status = 'pending'`,
    )
    .toArray()
    .map((row) => actionFrom(row));
  const openDist = sql
    .exec(
      `SELECT id, proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, liq_before
       FROM actions WHERE status = 'confirmed' AND dist_after IS NULL`,
    )
    .toArray()
    .map((row) => actionFrom(row));
  const claims = sql
    .exec(
      `SELECT claims.proxy, claims.claimed_at FROM claims
       JOIN pool ON pool.proxy = claims.proxy
       WHERE claims.accepted_at IS NULL AND pool.role = 'pool'`,
    )
    .toArray();
  const canary = sql.exec("SELECT proxy, perp_id FROM pool WHERE role = 'pool' LIMIT 1").toArray()[0];
  const stats = sql
    .exec("SELECT started_at, max_gap_ms, canary_at, recycled_at FROM keeper_stats WHERE id = 1")
    .toArray()[0];
  const health = sql.exec("SELECT last_error FROM health_state WHERE id = 1").toArray()[0];
  const lastBlock = new Map<string, number>();
  for (const row of armedRows) {
    const proxy = str(row.proxy);
    const perpId = str(row.perp_id);
    const block = sql
      .exec(
        "SELECT block FROM actions WHERE proxy = ? AND perp_id = ? AND status = 'confirmed' AND block IS NOT NULL ORDER BY id DESC LIMIT 1",
        proxy,
        perpId,
      )
      .toArray()[0];
    const value = int(block?.block);
    if (value !== null) lastBlock.set(blockKey(proxy, perpId), value);
  }

  hot.pools = pools;
  hot.mandates = mandates;
  hot.armed = armedRows.map((row) => houseFrom(poolFrom(row), mandateFrom(row)));
  hot.pending = pending;
  hot.openDist = openDist;
  hot.lastBlock = lastBlock;
  hot.openClaims = claims.flatMap((row) => {
    const proxy = str(row.proxy);
    const claimed = int(row.claimed_at);
    if (!proxy || claimed === null) return [];
    return [{ proxy, claimed_at: claimed }];
  });
  hot.canaryProxy =
    canary?.proxy && canary.perp_id ? { proxy: str(canary.proxy), perp_id: str(canary.perp_id) } : null;
  hot.startedAt = int(stats?.started_at);
  hot.maxGapMs = int(stats?.max_gap_ms) ?? 0;
  hot.canaryAt = int(stats?.canary_at);
  hot.recycledAt = int(stats?.recycled_at);
  hot.lastError = health?.last_error == null ? null : String(health.last_error);
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const today = sql.exec("SELECT COUNT(*) AS n FROM claims WHERE claimed_at >= ?", dayAgo).toArray()[0];
  hot.claimsToday = int(today?.n) ?? 0;
  hot.at = now;
  hot.loaded = true;
}

export function registrationCounts(hot: HotState | null | undefined): { registered: number; mandates: number } | null {
  if (!hot?.loaded) return null;
  return {
    registered: hot.pools.length,
    mandates: hot.mandates.filter((row) => row.active === 1 && row.kind === "house").length,
  };
}

export function upsertPool(hot: HotState | null | undefined, row: PoolRow, reopen: boolean): void {
  if (!hot?.loaded) return;
  const existing = hot.pools.find((item) => item.proxy === row.proxy);
  const status = existing && existing.status === "claimed" && !reopen ? existing.status : row.status;
  const next = { ...row, status };
  if (existing) {
    if (existing.perp_id !== next.perp_id) hot.lastBlock.delete(blockKey(existing.proxy, existing.perp_id));
    Object.assign(existing, next);
  } else hot.pools.push(next);
  const armed = hot.armed.find((item) => item.proxy === row.proxy);
  if (armed) {
    armed.account_id = next.account_id;
    armed.perp_id = next.perp_id;
    armed.side = next.side;
    armed.leverage = next.leverage;
    armed.status = next.status;
    armed.market = next.market;
    armed.role = next.role;
    armed.pair_id = next.pair_id;
  }
  if (!hot.canaryProxy && next.role === "pool") hot.canaryProxy = { proxy: next.proxy, perp_id: next.perp_id };
  if (reopen) hot.openClaims = hot.openClaims.filter((claim) => claim.proxy !== row.proxy);
}

export function dropMandate(hot: HotState | null | undefined, proxy: string): void {
  if (!hot?.loaded) return;
  hot.mandates = hot.mandates.filter((row) => row.proxy !== proxy);
  hot.armed = hot.armed.filter((row) => row.proxy !== proxy);
}

export function putMandate(hot: HotState | null | undefined, mandate: MandateRow): void {
  if (!hot?.loaded) return;
  const index = hot.mandates.findIndex((row) => row.proxy === mandate.proxy);
  if (index >= 0) hot.mandates[index] = mandate;
  else hot.mandates.push(mandate);
  const pool = hot.pools.find((row) => row.proxy === mandate.proxy);
  const armedIndex = hot.armed.findIndex((row) => row.proxy === mandate.proxy);
  if (mandate.active !== 1 || !pool) {
    if (armedIndex >= 0) hot.armed.splice(armedIndex, 1);
    return;
  }
  const next = houseFrom(pool, mandate);
  if (armedIndex >= 0) hot.armed[armedIndex] = next;
  else hot.armed.push(next);
}

export function setBudget(hot: HotState | null | undefined, proxy: string, budget: string): void {
  if (!hot?.loaded) return;
  const mandate = hot.mandates.find((row) => row.proxy === proxy);
  if (mandate) mandate.budget_used_cns = budget;
  const armed = hot.armed.find((row) => row.proxy === proxy);
  if (armed) armed.budget_used_cns = budget;
}

export function setPoolStatus(hot: HotState | null | undefined, proxy: string, status: string): void {
  if (!hot?.loaded) return;
  for (const row of hot.pools) if (row.proxy === proxy) row.status = status;
  for (const row of hot.armed) if (row.proxy === proxy) row.status = status;
}

/** Matches `UPDATE pool SET status = 'claimed' WHERE status = 'available'`. Reserve rows stay put. */
export function markClaimed(hot: HotState | null | undefined, proxy: string): void {
  if (!hot?.loaded) return;
  for (const row of hot.pools) if (row.proxy === proxy && row.status === "available") row.status = "claimed";
  for (const row of hot.armed) if (row.proxy === proxy && row.status === "available") row.status = "claimed";
}

export function addOpenClaim(hot: HotState | null | undefined, claim: ClaimRow): void {
  if (!hot?.loaded) return;
  hot.openClaims = hot.openClaims.filter((row) => row.proxy !== claim.proxy);
  hot.openClaims.push(claim);
}

export function acceptCached(hot: HotState | null | undefined, proxy: string): void {
  if (!hot?.loaded) return;
  hot.openClaims = hot.openClaims.filter((claim) => claim.proxy !== proxy);
}

export function releaseCached(hot: HotState | null | undefined, proxy: string): void {
  if (!hot?.loaded) return;
  for (const row of hot.pools) if (row.proxy === proxy && row.role === "pool") row.status = "available";
  for (const row of hot.armed) if (row.proxy === proxy && row.role === "pool") row.status = "available";
  hot.openClaims = hot.openClaims.filter((claim) => claim.proxy !== proxy);
}

export function insertedId(sql: Sql): number {
  const row = sql.exec("SELECT last_insert_rowid() AS id").toArray()[0];
  return int(row?.id) ?? 0;
}

export function insertAction(
  sql: Sql,
  hot: HotState | null | undefined,
  row: {
    proxy: string;
    perp_id: string;
    amount_cns: string;
    tx_hash: string | null;
    dist_before: string | null;
    status: string;
    reason: string;
    liq_before: string | null;
    created_at: number;
  },
): number {
  sql.exec(
    `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, liq_before, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?)`,
    row.proxy,
    row.perp_id,
    row.amount_cns,
    row.tx_hash,
    row.dist_before,
    row.status,
    row.reason,
    row.liq_before,
    row.created_at,
  );
  const id = insertedId(sql);
  if (hot?.loaded && row.status === "pending") {
    hot.pending.push({
      id,
      proxy: row.proxy,
      perp_id: row.perp_id,
      amount_cns: row.amount_cns,
      tx_hash: row.tx_hash,
      block: null,
      dist_before: row.dist_before,
      dist_after: null,
      status: "pending",
      reason: row.reason,
      liq_before: row.liq_before,
    });
  }
  return id;
}

export function noteConfirmed(hot: HotState | null | undefined, id: number, block: number): void {
  if (!hot?.loaded) return;
  const row = hot.pending.find((item) => item.id === id);
  hot.pending = hot.pending.filter((item) => item.id !== id);
  if (!row) return;
  row.status = "confirmed";
  row.block = block;
  row.dist_after = null;
  hot.openDist = hot.openDist.filter((item) => item.id !== id);
  hot.openDist.push(row);
  hot.lastBlock.set(blockKey(row.proxy, row.perp_id), block);
}

export function noteReverted(hot: HotState | null | undefined, id: number): void {
  if (!hot?.loaded) return;
  hot.pending = hot.pending.filter((item) => item.id !== id);
  hot.openDist = hot.openDist.filter((item) => item.id !== id);
}

export function noteDistance(hot: HotState | null | undefined, id: number): void {
  if (!hot?.loaded) return;
  hot.openDist = hot.openDist.filter((item) => item.id !== id);
}

export function noteDistanceHash(hot: HotState | null | undefined, hash: string): void {
  if (!hot?.loaded) return;
  hot.openDist = hot.openDist.filter((item) => item.tx_hash !== hash);
  hot.pending = hot.pending.filter((item) => item.tx_hash !== hash);
}

export function forgetInflight(hot: HotState | null | undefined, proxy: string): void {
  if (!hot?.loaded) return;
  hot.pending = hot.pending.filter((item) => !(item.proxy === proxy && item.tx_hash === "inflight"));
}

export function hashInflight(hot: HotState | null | undefined, proxy: string, hash: string): void {
  if (!hot?.loaded) return;
  const row = hot.pending.find((item) => item.proxy === proxy && item.tx_hash === "inflight");
  if (row) row.tx_hash = hash;
}

export function confirmInflight(hot: HotState | null | undefined, proxy: string, hash: string, block: number): void {
  if (!hot?.loaded) return;
  const row = hot.pending.find((item) => item.proxy === proxy && item.tx_hash === "inflight");
  hot.pending = hot.pending.filter((item) => !(item.proxy === proxy && item.tx_hash === "inflight"));
  if (!row) return;
  row.tx_hash = hash;
  row.status = "confirmed";
  row.block = block;
  row.dist_after = null;
  hot.openDist = hot.openDist.filter((item) => item.id !== row.id);
  hot.openDist.push(row);
  hot.lastBlock.set(blockKey(row.proxy, row.perp_id), block);
}
