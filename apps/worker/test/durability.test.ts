import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import {
  addOpenClaim,
  blankHot,
  claimsToday,
  COLD_TTL_MS,
  HOT_TTL_MS,
  hydrateHot,
  refreshHot,
  releaseCached,
  upsertPool,
} from "../src/hot.js";
import type { PoolRegistration } from "../src/house.js";
import { Lifeline } from "../src/lifeline.js";
import { stampAccepted } from "../src/me.js";
import { ACTION_KEEP_MS, PRUNE_BATCH, PRUNE_INTERVAL_MS, pruneHistory, SANDBOX_HIT_KEEP_MS } from "../src/prune.js";
import { registerPool } from "../src/register.js";
import { noteSaves, resetWatchedCache } from "../src/saves.js";
import { migrate, type Sql } from "../src/schema.js";
import { soakReport } from "../src/tick.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

interface Statement {
  query: string;
  bindings: unknown[];
}

function recording(db: DatabaseSync) {
  const statements: Statement[] = [];
  let changes = 0;
  const sql: Sql = {
    exec(query: string, ...bindings: unknown[]) {
      statements.push({ query, bindings });
      const statement = db.prepare(query);
      if (/^\s*(select|pragma|with)\b/i.test(query)) {
        const rows = statement.all(...(bindings as never[]));
        return { toArray: () => rows as Record<string, unknown>[] };
      }
      changes += Number(statement.run(...(bindings as never[])).changes);
      return { toArray: () => [] };
    },
  };
  return {
    sql,
    statements,
    get changes() {
      return changes;
    },
    reset() {
      statements.length = 0;
      changes = 0;
    },
  };
}

function proxyAt(index: number): Address {
  return getAddress(`0x${index.toString(16).padStart(40, "0")}`);
}

/** A small copy of production: house pool, one twin pair, a claim, keeper history, and a save. */
function seed(sql: Sql) {
  for (let i = 1; i <= 8; i += 1) {
    const role = i <= 6 ? "pool" : i === 7 ? "twin-protected" : "twin-unprotected";
    sql.exec(
      `INSERT INTO pool (proxy, account_id, perp_id, side, leverage, status, created_at, market, role, pair_id)
       VALUES (?, ?, '16', 'long', '1500', ?, 1, 'BTC', ?, ?)`,
      proxyAt(i),
      String(800 + i),
      role === "pool" ? "available" : role === "twin-protected" ? "twin" : "unprotected",
      role,
      role === "pool" ? "" : "btc-long",
    );
    if (role !== "twin-unprotected") {
      sql.exec(
        `INSERT INTO mandates (proxy, owner, typed_data, sig, active, budget_used_cns, kind) VALUES (?, ?, '{}', '0x', 1, '0', 'house')`,
        proxyAt(i),
        proxyAt(i),
      );
    }
  }
  const action = (proxy: Address, status: string, createdAt: number, extra: { dist?: string | null; liq?: string | null; hash?: string } = {}) =>
    sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, liq_before, created_at)
       VALUES (?, '16', '1', ?, ?, '1', ?, ?, '', ?, ?)`,
      proxy,
      extra.hash ?? `0x${Math.round(Math.random() * 1e15).toString(16)}`,
      status === "pending" ? null : 100,
      extra.dist === undefined ? "9" : extra.dist,
      status,
      extra.liq === undefined ? "123" : extra.liq,
      createdAt,
    );
  action(proxyAt(1), "pending", NOW - 40 * DAY, { dist: null });
  action(proxyAt(1), "pending", NOW, { dist: null });
  action(proxyAt(1), "confirmed", NOW - 40 * DAY);
  action(proxyAt(2), "confirmed", NOW - 40 * DAY, { dist: null });
  action(proxyAt(2), "reverted", NOW - 35 * DAY);
  action(proxyAt(3), "confirmed", NOW - 2 * DAY, { hash: "0xsaved" });
  action(proxyAt(3), "confirmed", NOW - DAY, { dist: null });
  action(proxyAt(7), "confirmed", NOW - DAY, { liq: null });
  sql.exec(
    `INSERT INTO claims (proxy, privy_user_id, owner, ip, claimed_at, accepted_at) VALUES (?, 'did:privy:a', ?, '1.1.1.1', ?, NULL)`,
    proxyAt(4),
    proxyAt(40),
    NOW - 20 * 60 * 1000,
  );
  sql.exec(
    `INSERT INTO claims (proxy, privy_user_id, owner, ip, claimed_at, accepted_at) VALUES (?, 'did:privy:b', ?, '1.1.1.2', ?, ?)`,
    proxyAt(5),
    proxyAt(50),
    NOW - 3 * DAY,
    NOW - 3 * DAY,
  );
  sql.exec(
    `INSERT INTO saves (tx_hash, proxy, perp_id, side, pre_liq, cross_block, cross_mark, added_cns, recorded_at)
     VALUES ('0xsaved', ?, '16', 'long', '123', 1, '1', '1', ?)`,
    proxyAt(3),
    NOW - DAY,
  );
  sql.exec("INSERT INTO sandbox_hits (ip, at) VALUES ('1.1.1.1', ?)", NOW - 10 * DAY);
  sql.exec("INSERT INTO sandbox_hits (ip, at) VALUES ('1.1.1.1', ?)", NOW - 60_000);
}

const ENV = {
  OPERATOR_PK: "",
  POOL_OWNER_PK: "",
  SPONSOR_PK: "",
  ADMIN_SECRET: "durability",
  PRIVY_APP_ID: "",
  PRIVY_VERIFICATION_KEY: "",
  RPC_URLS_TESTNET: "",
};

function lifeline(sql: Sql) {
  let ready = Promise.resolve();
  const ctx = {
    storage: { sql, getAlarm: async () => Date.now() + 1_000, setAlarm: async () => {}, deleteAlarm: async () => {} },
    blockConcurrencyWhile(fn: () => Promise<void>) {
      ready = fn();
    },
  };
  const line = new Lifeline(ctx as never, ENV);
  return { line, ready: () => ready };
}

function registrations(db: DatabaseSync): PoolRegistration[] {
  return (db.prepare("SELECT proxy, account_id, perp_id, side, leverage, market, role, pair_id FROM pool ORDER BY rowid").all() as Record<string, string>[]).map(
    (row) => ({
      proxy: row.proxy as Address,
      accountId: row.account_id!,
      perpId: row.perp_id!,
      side: row.side === "short" ? "short" : "long",
      leverage: row.leverage!,
      market: row.market!,
      role: row.role as PoolRegistration["role"],
      pairId: row.pair_id!,
    }),
  );
}

function planOf(db: DatabaseSync, statement: Statement): string[] {
  return (db.prepare(`EXPLAIN QUERY PLAN ${statement.query}`).all(...(statement.bindings as never[])) as { detail: string }[]).map(
    (row) => row.detail,
  );
}

/** History tables grow forever. A plan step that walks one of them must go through a bounded index. */
const BOUNDED_SCANS = new Set(["idx_actions_pending", "idx_actions_confirmed_open", "idx_claims_unaccepted", "idx_saves_recorded"]);

function unboundedSteps(plan: readonly string[]): string[] {
  return plan.filter((step) => {
    const scan = /^SCAN (actions|claims|saves|sandbox_hits|a|s)\b/.exec(step);
    if (!scan) return false;
    const index = /USING (?:COVERING )?INDEX (\w+)/.exec(step)?.[1];
    return !index || !BOUNDED_SCANS.has(index);
  });
}

const EXPECTED: { label: string; match: RegExp; index: string }[] = [
  { label: "last action block per armed row", match: /ORDER BY id DESC LIMIT 1/, index: "idx_actions_last_block" },
  { label: "claims in the last day", match: /FROM claims WHERE claimed_at >= \?/, index: "idx_claims_claimed" },
  { label: "open claims", match: /accepted_at IS NULL AND pool\.role/, index: "idx_claims_unaccepted" },
  { label: "pending actions", match: /FROM actions WHERE status = 'pending'/, index: "idx_actions_pending" },
  { label: "open distances", match: /status = 'confirmed' AND dist_after IS NULL/, index: "idx_actions_confirmed_open" },
  { label: "watched actions", match: /a\.created_at >= \?/, index: "idx_actions_watched_at" },
  { label: "/saves watched count", match: /SELECT COUNT\(\*\) AS n FROM \(\s*SELECT 1 FROM actions/, index: "idx_actions_watched_at" },
  { label: "/saves list", match: /FROM saves ORDER BY recorded_at DESC/, index: "idx_saves_recorded" },
  { label: "action retention", match: /SELECT id FROM actions WHERE created_at < \?/, index: "idx_actions_created" },
  { label: "sandbox hit retention", match: /FROM sandbox_hits WHERE at < \?/, index: "idx_sandbox_hits_at" },
  { label: "soak window", match: /WHERE created_at >= \?\s+ORDER BY created_at DESC/, index: "idx_actions_created" },
  { label: "/actions for one account", match: /FROM actions WHERE proxy = \? ORDER BY id$/, index: "actions_proxy" },
  { label: "twin leg history", match: /tx_hash LIKE '0x%'/, index: "actions_proxy" },
];

describe("durability", () => {
  it("plans every recurring query as an index seek, never a history-table scan", async () => {
    const db = new DatabaseSync(":memory:");
    const rec = recording(db);
    migrate(rec.sql);
    seed(rec.sql);
    rec.reset();

    const hot = blankHot();
    hydrateHot(rec.sql, hot, NOW);
    refreshHot(rec.sql, hot, NOW + HOT_TTL_MS);
    resetWatchedCache();
    noteSaves(rec.sql, new Map(), NOW);
    pruneHistory(rec.sql, NOW, hot);
    await registerPool(rec.sql, registrations(db), async () => ({ owner: proxyAt(1), sig: "0x" }), 1n, hot);
    soakReport(rec.sql, NOW);
    stampAccepted(rec.sql, proxyAt(4), proxyAt(40), NOW, hot);
    const { line, ready } = lifeline(rec.sql);
    await ready();
    for (const path of ["/saves", `/actions?account=${proxyAt(1)}`, "/twins", "/admin/mandates", "/health"]) {
      const response = await line.fetch(new Request(`http://lifeline${path}`, { headers: { "x-admin-secret": ENV.ADMIN_SECRET } }));
      expect(response.status, path).toBe(200);
    }

    const planned = rec.statements
      .filter((statement) => /^\s*(select|update|delete)\b/i.test(statement.query))
      .map((statement) => ({ query: statement.query.replace(/\s+/g, " ").trim(), plan: planOf(db, statement) }));
    const offenders = planned.flatMap((row) => unboundedSteps(row.plan).map((step) => `${step} :: ${row.query}`));
    expect(offenders).toEqual([]);
    for (const expected of EXPECTED) {
      const hits = planned.filter((row) => expected.match.test(row.query));
      expect(hits.length, `${expected.label} was not executed`).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit.plan.join(" | "), expected.label).toContain(`INDEX ${expected.index}`);
        expect(hit.plan.join(" | "), expected.label).toMatch(/SEARCH|SCAN \w+ USING/);
      }
    }
  });

  it("rejects the v10 index set that read every confirmed action per armed row on 2026-10-08", () => {
    const db = new DatabaseSync(":memory:");
    const rec = recording(db);
    migrate(rec.sql);
    for (const name of ["idx_actions_pending", "idx_actions_last_block", "idx_actions_watched_at", "idx_actions_created"]) {
      rec.sql.exec(`DROP INDEX ${name}`);
    }
    rec.sql.exec("CREATE INDEX idx_actions_status ON actions(status)");
    const plans = [
      "SELECT block FROM actions WHERE proxy = ? AND perp_id = ? AND status = 'confirmed' AND block IS NOT NULL ORDER BY id DESC LIMIT 1",
      "SELECT id FROM actions WHERE status = 'confirmed' AND dist_after IS NULL",
    ].map((query) => planOf(db, { query, bindings: query.includes("?") ? ["0xa", "16"] : [] }).join(" | "));
    expect(plans[0]).toContain("idx_actions_status");
    expect(plans[0]).not.toContain(`INDEX ${EXPECTED[0]!.index}`);
    expect(plans[1]).toContain("idx_actions_status");
    expect(plans[1]).not.toContain("INDEX idx_actions_confirmed_open");
  });

  it("serves warm ticks from memory, reloads in-flight work every minute and the roster every COLD_TTL", () => {
    const db = new DatabaseSync(":memory:");
    const rec = recording(db);
    migrate(rec.sql);
    seed(rec.sql);
    const hot = blankHot();
    hydrateHot(rec.sql, hot, NOW);
    rec.reset();

    expect(refreshHot(rec.sql, hot, NOW + HOT_TTL_MS - 1)).toBe(false);
    expect(rec.statements).toHaveLength(0);

    expect(refreshHot(rec.sql, hot, NOW + HOT_TTL_MS)).toBe(true);
    expect(rec.statements).toHaveLength(4);
    expect(rec.statements.some((statement) => /FROM (pool|mandates|claims)\b/.test(statement.query))).toBe(false);
    rec.reset();

    expect(refreshHot(rec.sql, hot, NOW + COLD_TTL_MS)).toBe(true);
    expect(rec.statements.some((statement) => /FROM pool\b/.test(statement.query))).toBe(true);
    expect(rec.statements.some((statement) => /FROM mandates\b/.test(statement.query))).toBe(true);
  });

  it("hydrates the same roster, keeper order, and recycle order as the old joins", () => {
    const db = new DatabaseSync(":memory:");
    const rec = recording(db);
    migrate(rec.sql);
    seed(rec.sql);
    const hot = blankHot();
    hydrateHot(rec.sql, hot, NOW);
    const joined = db
      .prepare(
        `SELECT p.proxy, m.kind, m.budget_used_cns FROM mandates m JOIN pool p ON p.proxy = m.proxy WHERE m.active = 1 ORDER BY m.rowid`,
      )
      .all() as { proxy: string; kind: string; budget_used_cns: string }[];
    expect(hot.armed.map((row) => [row.proxy, row.kind, row.budget_used_cns])).toEqual(
      joined.map((row) => [row.proxy, row.kind, row.budget_used_cns]),
    );
    expect(hot.armed.map((row) => row.proxy)).not.toContain(proxyAt(8));
    expect(hot.canaryProxy).toEqual({ proxy: proxyAt(1), perp_id: "16" });
    expect(hot.openClaims).toEqual([{ proxy: proxyAt(4), claimed_at: NOW - 20 * 60 * 1000 }]);
    expect(hot.lastBlock.get(`${proxyAt(3)}:16`)).toBe(100);
    expect(hot.pending.map((row) => row.status)).toEqual(["pending", "pending"]);
    expect(claimsToday(hot, NOW)).toBe(1);
  });

  it("keeps the cached roster coherent between reloads", () => {
    const db = new DatabaseSync(":memory:");
    const rec = recording(db);
    migrate(rec.sql);
    seed(rec.sql);
    const hot = blankHot();
    hydrateHot(rec.sql, hot, NOW);

    stampAccepted(rec.sql, proxyAt(4), proxyAt(40), NOW, hot);
    expect(hot.openClaims).toEqual([]);
    expect(claimsToday(hot, NOW)).toBe(1);

    addOpenClaim(hot, { proxy: proxyAt(6), claimed_at: NOW });
    expect(claimsToday(hot, NOW)).toBe(2);
    expect(claimsToday(hot, NOW + DAY)).toBe(1);
    releaseCached(hot, proxyAt(6));
    expect(claimsToday(hot, NOW)).toBe(1);

    const pool = hot.pools.find((row) => row.proxy === proxyAt(3))!;
    upsertPool(hot, { ...pool, perp_id: "48" }, false);
    rec.reset();
    expect(refreshHot(rec.sql, hot, NOW + 1)).toBe(true);
    expect(rec.statements.some((statement) => /FROM pool\b/.test(statement.query))).toBe(true);
  });

  it("migration v11 backfills only created_at = 0 rows and re-applies as a no-op", () => {
    const db = new DatabaseSync(":memory:");
    const rec = recording(db);
    migrate(rec.sql);
    const legacy = (proxy: Address, hash: string) =>
      rec.sql.exec(
        `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, liq_before, created_at)
         VALUES (?, '16', '1', ?, 1, '1', '9', 'confirmed', '', '123', 0)`,
        proxy,
        hash,
      );
    legacy(proxyAt(1), "0xaccepted");
    legacy(proxyAt(2), "0xclaimed");
    legacy(proxyAt(3), "0xunclaimed");
    rec.sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, liq_before, created_at)
       VALUES (?, '16', '1', '0xdated', 1, '1', '9', 'confirmed', '', '123', 777)`,
      proxyAt(1),
    );
    rec.sql.exec(
      `INSERT INTO claims (proxy, privy_user_id, owner, ip, claimed_at, accepted_at) VALUES (?, 'u1', ?, 'ip', 1000, 2000)`,
      proxyAt(1),
      proxyAt(10),
    );
    rec.sql.exec(
      `INSERT INTO claims (proxy, privy_user_id, owner, ip, claimed_at, accepted_at) VALUES (?, 'u2', ?, 'ip', 3000, NULL)`,
      proxyAt(2),
      proxyAt(20),
    );
    rec.sql.exec("CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status)");
    rec.sql.exec("DELETE FROM schema_migrations WHERE version = 11");

    const before = Date.now();
    migrate(rec.sql);
    const created = new Map(
      (db.prepare("SELECT tx_hash, created_at FROM actions").all() as { tx_hash: string; created_at: number }[]).map((row) => [
        row.tx_hash,
        Number(row.created_at),
      ]),
    );
    expect(created.get("0xaccepted")).toBe(2000);
    expect(created.get("0xclaimed")).toBe(3000);
    expect(created.get("0xunclaimed")).toBeGreaterThanOrEqual(before);
    expect(created.get("0xdated")).toBe(777);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((row) => row.name);
    expect(indexes).not.toContain("idx_actions_status");
    expect(indexes).not.toContain("idx_actions_watched");
    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_actions_pending",
        "idx_actions_last_block",
        "idx_actions_watched_at",
        "idx_actions_created",
        "idx_claims_claimed",
        "idx_saves_recorded",
        "idx_sandbox_hits_at",
      ]),
    );
    expect((db.prepare("PRAGMA table_info(keeper_stats)").all() as { name: string }[]).map((row) => row.name)).toContain("pruned_at");

    const snapshot = () => JSON.stringify([db.prepare("SELECT * FROM actions ORDER BY id").all(), db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all()]);
    const settled = snapshot();
    rec.sql.exec("DELETE FROM schema_migrations WHERE version = 11");
    expect(migrate(rec.sql)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(migrate(rec.sql)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(snapshot()).toBe(settled);
  });

  it("prunes settled history past the horizon in bounded hourly batches", () => {
    const db = new DatabaseSync(":memory:");
    const rec = recording(db);
    migrate(rec.sql);
    seed(rec.sql);
    for (let i = 0; i < PRUNE_BATCH + 20; i += 1) {
      rec.sql.exec(
        `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, liq_before, created_at)
         VALUES (?, '16', '1', ?, 1, '1', '9', 'confirmed', '', '123', ?)`,
        proxyAt(6),
        `0xbulk${i}`,
        NOW - ACTION_KEEP_MS - DAY - i,
      );
    }
    const hot = blankHot();
    hydrateHot(rec.sql, hot, NOW);
    const stuck = hot.openDist.find((row) => row.proxy === proxyAt(2));
    expect(stuck).toBeDefined();
    const count = (where: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM actions WHERE ${where}`).get() as { n: number }).n);
    const old = `created_at < ${NOW - ACTION_KEEP_MS}`;
    const oldSettled = count(`${old} AND status != 'pending'`);

    expect(pruneHistory(rec.sql, NOW, hot)).toBe(true);
    expect(oldSettled - count(`${old} AND status != 'pending'`)).toBe(PRUNE_BATCH);
    expect(count(`${old} AND status = 'pending'`)).toBe(1);
    expect(count(`created_at >= ${NOW - ACTION_KEEP_MS}`)).toBe(4);
    expect(hot.prunedAt).toBe(NOW);

    expect(pruneHistory(rec.sql, NOW + PRUNE_INTERVAL_MS - 1, hot)).toBe(false);
    expect(pruneHistory(rec.sql, NOW + PRUNE_INTERVAL_MS, hot)).toBe(true);
    expect(count(`${old} AND status != 'pending'`)).toBe(0);
    expect(count(`${old} AND status = 'pending'`)).toBe(1);
    expect(hot.openDist.some((row) => row.id === stuck?.id)).toBe(false);
    expect(hot.pending).toHaveLength(2);
    const hits = (db.prepare("SELECT at FROM sandbox_hits").all() as { at: number }[]).map((row) => Number(row.at));
    expect(hits.every((at) => at >= NOW - SANDBOX_HIT_KEEP_MS)).toBe(true);
    expect(hits).toHaveLength(1);
    expect(count("1 = 1")).toBeGreaterThan(0);
    expect(Number((db.prepare("SELECT COUNT(*) AS n FROM claims").get() as { n: number }).n)).toBe(2);
    expect(Number((db.prepare("SELECT COUNT(*) AS n FROM saves").get() as { n: number }).n)).toBe(1);
  });

  it("re-registering an unchanged pool writes nothing and still applies real changes", async () => {
    const db = new DatabaseSync(":memory:");
    const rec = recording(db);
    migrate(rec.sql);
    seed(rec.sql);
    const entries = registrations(db);
    const sign = async () => ({ owner: proxyAt(1), sig: "0x" as const });
    rec.sql.exec("UPDATE pool SET status = 'claimed' WHERE proxy = ?", proxyAt(4));
    rec.sql.exec("UPDATE pool SET status = 'reserve' WHERE proxy = ?", proxyAt(5));
    await registerPool(rec.sql, entries, sign, 1n);
    rec.reset();

    await registerPool(rec.sql, entries, sign, 1n);
    expect(rec.changes).toBe(0);
    const status = (proxy: Address) => (db.prepare("SELECT status FROM pool WHERE proxy = ?").get(proxy) as { status: string }).status;
    expect(status(proxyAt(4))).toBe("claimed");
    expect(status(proxyAt(5))).toBe("available");

    rec.sql.exec("UPDATE pool SET status = 'reserve' WHERE proxy = ?", proxyAt(5));
    rec.reset();
    await registerPool(
      rec.sql,
      entries.map((entry) => (entry.proxy === proxyAt(4) ? { ...entry, reopen: true } : entry)),
      sign,
      1n,
    );
    expect(status(proxyAt(5))).toBe("available");
    expect(status(proxyAt(4))).toBe("available");
    expect(rec.changes).toBeGreaterThan(0);
  });

  it("serves repeat /saves from memory until a save is recorded", async () => {
    const db = new DatabaseSync(":memory:");
    const rec = recording(db);
    migrate(rec.sql);
    seed(rec.sql);
    const { line, ready } = lifeline(rec.sql);
    await ready();
    const saves = async () => (await (await line.fetch(new Request("http://lifeline/saves"))).json()) as { count: number; watched: number };

    rec.reset();
    expect(await saves()).toMatchObject({ count: 1, watched: 2 });
    expect(rec.statements.length).toBeGreaterThan(0);
    rec.reset();
    expect(await saves()).toMatchObject({ count: 1 });
    expect(rec.statements).toHaveLength(0);

    resetWatchedCache();
    const marks = new Map([[`${proxyAt(1)}:16`, { mark: 1n, open: true, block: 9 }]]);
    rec.sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, liq_before, created_at)
       VALUES (?, '16', '1', '0xcrossed', 1, '1', '9', 'confirmed', '', '100', ?)`,
      proxyAt(1),
      Date.now(),
    );
    expect(noteSaves(rec.sql, marks, Date.now())).toBeGreaterThan(0);
    rec.reset();
    expect((await saves()).count).toBeGreaterThan(1);
    expect(rec.statements.length).toBeGreaterThan(0);
  });
});
