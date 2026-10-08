import { DurableObject } from "cloudflare:workers";
import type { Address } from "viem";
import { migrate, type Sql } from "../../src/schema.js";
import { blankHot, HOT_TTL_MS, hydrateHot, refreshHot } from "../../src/hot.js";
import { Lifeline } from "../../src/lifeline.js";
import { pruneHistory } from "../../src/prune.js";
import { registerPool } from "../../src/register.js";
import { noteSaves, resetWatchedCache } from "../../src/saves.js";
import type { PoolRegistration } from "../../src/house.js";

/** Test-only Durable Object. Reports workerd's own rowsRead/rowsWritten counters, the numbers Cloudflare bills. */

export interface Shape {
  now: number;
  pool: number;
  sandbox: number;
  twinPairs: number;
  actions: number;
  historyDays: number;
  legacy: number;
  claims: number;
  unaccepted: number;
  saves: number;
  sandboxHits: number;
  /** Top-ups land on a few accounts. The rest of the armed set has no history. */
  activeProxies?: number;
  /** One in this many confirmed actions never gets dist_after (account disarmed before the next tick). */
  stuckEvery?: number;
}

interface Cursor {
  toArray(): Record<string, unknown>[];
  rowsRead: number;
  rowsWritten: number;
}

interface Storage {
  exec(query: string, ...bindings: unknown[]): Cursor;
}

function meter(real: Storage) {
  const cursors: Cursor[] = [];
  return {
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        const cursor = real.exec(query, ...bindings);
        cursors.push(cursor);
        return cursor;
      },
    } as Sql,
    take() {
      let rowsRead = 0;
      let rowsWritten = 0;
      for (const cursor of cursors) {
        rowsRead += cursor.rowsRead;
        rowsWritten += cursor.rowsWritten;
      }
      const statements = cursors.length;
      cursors.length = 0;
      return { rowsRead, rowsWritten, statements };
    },
  };
}

function seed(sql: Storage, shape: Shape) {
  const day = 24 * 60 * 60 * 1000;
  const twinLegs = shape.twinPairs * 2;
  const total = shape.pool + shape.sandbox + twinLegs;
  sql.exec(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO pool (proxy, account_id, perp_id, side, leverage, status, created_at, market, role, pair_id)
     SELECT printf('0x%040x', i), CAST(1000 + i AS TEXT), '16', CASE i % 2 WHEN 0 THEN 'long' ELSE 'short' END, '1500',
       CASE WHEN i <= ? THEN (CASE WHEN i <= ? THEN 'claimed' ELSE 'available' END)
            WHEN i <= ? THEN 'sandbox'
            WHEN (i - ?) % 2 = 1 THEN 'twin' ELSE 'unprotected' END,
       1, 'BTC',
       CASE WHEN i <= ? THEN 'pool' WHEN i <= ? THEN 'sandbox'
            WHEN (i - ?) % 2 = 1 THEN 'twin-protected' ELSE 'twin-unprotected' END,
       CASE WHEN i <= ? THEN '' ELSE 'pair-' || CAST((i - ? + 1) / 2 AS TEXT) END
     FROM n`,
    total,
    shape.pool,
    shape.claims,
    shape.pool + shape.sandbox,
    shape.pool + shape.sandbox,
    shape.pool,
    shape.pool + shape.sandbox,
    shape.pool + shape.sandbox,
    shape.pool + shape.sandbox,
    shape.pool + shape.sandbox,
  );
  sql.exec(
    `INSERT INTO mandates (proxy, owner, typed_data, sig, active, budget_used_cns, kind)
     SELECT proxy, proxy, '{}', '0x', 1, '0', 'house' FROM pool WHERE role != 'twin-unprotected'`,
  );
  const armed = Number(sql.exec("SELECT COUNT(*) AS n FROM mandates").toArray()[0]?.n ?? 0);
  const spacing = shape.actions > 0 ? Math.floor((shape.historyDays * day) / shape.actions) : 0;
  sql.exec(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, liq_before, created_at)
     SELECT printf('0x%040x', 1 + (i * 7) % ?), '16', '1000000', printf('0x%064x', i), 1000 + i, '10000',
       CASE WHEN i % ? = 0 THEN NULL ELSE '20000' END,
       CASE WHEN i % 53 = 0 THEN 'reverted' ELSE 'confirmed' END, '',
       CASE WHEN i % 5 = 0 THEN NULL WHEN i % 11 = 0 THEN '' ELSE '123456' END,
       CASE WHEN i <= ? THEN 0 ELSE ? - (? - i) * ? END
     FROM n`,
    shape.actions,
    Math.min(armed, shape.activeProxies ?? armed),
    shape.stuckEvery ?? 100,
    shape.legacy,
    shape.now,
    shape.actions,
    spacing,
  );
  sql.exec(
    `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, liq_before, created_at)
     VALUES (printf('0x%040x', 1), '16', '1', '0xpending', NULL, '1', NULL, 'pending', '', '9', ?)`,
    shape.now,
  );
  sql.exec(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO claims (proxy, privy_user_id, owner, ip, claimed_at, accepted_at)
     SELECT printf('0x%040x', i), 'did:privy:' || i, printf('0x%040x', i), '10.0.0.' || (i % 200),
       ? - (i * 3600000) % (? * 86400000),
       CASE WHEN i <= ? THEN NULL ELSE ? END
     FROM n`,
    shape.claims,
    shape.now,
    Math.max(1, shape.historyDays),
    shape.unaccepted,
    shape.now,
  );
  sql.exec(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO saves (tx_hash, proxy, perp_id, side, pre_liq, cross_block, cross_mark, added_cns, recorded_at)
     SELECT printf('0x%064x', i * 3), printf('0x%040x', 1), '16', 'long', '1', 1, '1', '1', ? - i * 60000 FROM n`,
    shape.saves,
    shape.now,
  );
  sql.exec(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO sandbox_hits (ip, at) SELECT '10.1.0.' || (i % 50), ? - (i * 600000) FROM n`,
    shape.sandboxHits,
    shape.now,
  );
}

export interface Step {
  label: string;
  kind: "hydrate" | "warm" | "watched" | "prune" | "register" | "endpoint" | "migrate" | "sql" | "plan";
  sql?: string;
  bindings?: unknown[];
  path?: string;
  now?: number;
}

const ENV = {
  OPERATOR_PK: "",
  POOL_OWNER_PK: "",
  SPONSOR_PK: "",
  ADMIN_SECRET: "rows",
  PRIVY_APP_ID: "",
  PRIVY_VERIFICATION_KEY: "",
  RPC_URLS_TESTNET: "",
};

function registrations(sql: Storage): PoolRegistration[] {
  return sql
    .exec("SELECT proxy, account_id, perp_id, side, leverage, market, role, pair_id FROM pool ORDER BY rowid")
    .toArray()
    .map((row) => ({
      proxy: String(row.proxy) as Address,
      accountId: String(row.account_id),
      perpId: String(row.perp_id),
      side: row.side === "long" ? "long" : "short",
      leverage: String(row.leverage),
      market: String(row.market),
      role: String(row.role) as PoolRegistration["role"],
      pairId: String(row.pair_id),
    }));
}

export class Rows extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as { shape: Shape; steps: Step[] };
    const real = this.ctx.storage.sql as unknown as Storage;
    migrate(real as unknown as Sql);
    seed(real, body.shape);
    const metered = meter(real);
    const out: Record<string, unknown> = {};
    const hot = blankHot();
    let line: Lifeline | null = null;
    for (const step of body.steps) {
      const now = step.now ?? body.shape.now;
      if (step.kind === "hydrate") {
        hydrateHot(metered.sql, hot, now);
        out[step.label] = metered.take();
      } else if (step.kind === "warm") {
        refreshHot(metered.sql, hot, hot.at + HOT_TTL_MS);
        out[step.label] = metered.take();
      } else if (step.kind === "watched") {
        resetWatchedCache();
        noteSaves(metered.sql, new Map(), now);
        out[step.label] = metered.take();
      } else if (step.kind === "migrate") {
        const versions = migrate(metered.sql);
        out[step.label] = { ...metered.take(), versions };
      } else if (step.kind === "prune") {
        pruneHistory(metered.sql, now, hot);
        out[step.label] = metered.take();
      } else if (step.kind === "register") {
        const entries = registrations(real);
        metered.take();
        await registerPool(metered.sql, entries, async () => ({ owner: entries[0]!.proxy, sig: "0x" }), 1n, hot);
        out[step.label] = metered.take();
      } else if (step.kind === "endpoint") {
        if (!line) {
          const ctx = {
            storage: { sql: metered.sql, getAlarm: async () => now + 1_000, setAlarm: async () => {}, deleteAlarm: async () => {} },
            blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
          };
          line = new Lifeline(this.ctx, ENV as never);
          Object.defineProperty(line, "ctx", { value: ctx });
          metered.take();
        }
        const response = await line.fetch(
          new Request(`http://lifeline${step.path ?? "/health"}`, { headers: { "x-admin-secret": ENV.ADMIN_SECRET } }),
        );
        await response.text();
        out[step.label] = { ...metered.take(), status: response.status };
      } else if (step.kind === "plan") {
        out[step.label] = real
          .exec(`EXPLAIN QUERY PLAN ${step.sql ?? ""}`, ...(step.bindings ?? []))
          .toArray()
          .map((row) => String(row.detail));
      } else {
        const rows = metered.sql.exec(step.sql ?? "", ...(step.bindings ?? [])).toArray();
        out[step.label] = { ...metered.take(), rows: rows.length };
      }
    }
    return Response.json(out);
  }
}

export default {
  async fetch(request: Request, env: { ROWS: DurableObjectNamespace }): Promise<Response> {
    const name = new URL(request.url).searchParams.get("name") ?? "default";
    return env.ROWS.get(env.ROWS.idFromName(name)).fetch(request);
  },
};
