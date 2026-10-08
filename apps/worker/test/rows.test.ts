import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";
import { COLD_TTL_MS, HOT_TTL_MS } from "../src/hot.js";
import type { Shape, Step } from "./rows/harness.js";

/** rowsRead and rowsWritten come from workerd's SQL cursor, the counters Cloudflare bills against the free caps. */
const ROWS_READ_CAP = 5_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_RUNS = 24;

interface Cost {
  rowsRead: number;
  rowsWritten: number;
  status?: number;
}

const STEPS: Step[] = [
  { label: "cold", kind: "hydrate" },
  { label: "warm", kind: "warm" },
  { label: "watched", kind: "watched" },
  { label: "prune", kind: "prune" },
  { label: "register", kind: "register" },
  { label: "health", kind: "endpoint", path: "/health" },
  { label: "healthWarm", kind: "endpoint", path: "/health" },
  { label: "saves", kind: "endpoint", path: "/saves" },
  { label: "savesWarm", kind: "endpoint", path: "/saves" },
];

/** Production on 2026-10-08: 91 pool, 2 sandbox, 7 twin pairs, ~100 armed, ~110 actions on a dozen accounts. */
const CURRENT: Omit<Shape, "now"> = {
  pool: 91,
  sandbox: 2,
  twinPairs: 7,
  actions: 110,
  historyDays: 2,
  legacy: 10,
  claims: 6,
  unaccepted: 1,
  saves: 2,
  sandboxHits: 20,
  activeProxies: 12,
  stuckEvery: 100,
};

/**
 * Stuck open-distance rows need a disarm inside the ~2s between a top-up and its confirmation, so 0.1% is
 * already pessimistic. Each one costs 1,440 reads a day in the hot tier until retention drops it at 30 days.
 */
const GROWN: Omit<Shape, "now"> = {
  pool: 910,
  sandbox: 20,
  twinPairs: 70,
  actions: 55_000,
  historyDays: 45,
  legacy: 10,
  claims: 900,
  unaccepted: 20,
  saves: 1_000,
  sandboxHits: 10_000,
  activeProxies: 300,
  stuckEvery: 1_000,
};

/** Alarm-driven reads per day: the hot tier and watched scan each minute, the roster every COLD_TTL, prune hourly. */
function alarmReadsPerDay(cost: Record<string, Cost>): number {
  const minutes = DAY_MS / HOT_TTL_MS;
  const recycleStamp = 2;
  return (
    (cost.warm!.rowsRead + cost.watched!.rowsRead + recycleStamp) * minutes +
    cost.cold!.rowsRead * (DAY_MS / COLD_TTL_MS) +
    cost.prune!.rowsRead * PRUNE_RUNS
  );
}

describe("rows billed in workerd", () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev("test/rows/harness.ts", {
      config: "test/rows/wrangler.toml",
      local: true,
      logLevel: "error",
      experimental: { disableExperimentalWarning: true },
      persist: false,
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
  });

  async function measure(name: string, shape: Omit<Shape, "now">): Promise<Record<string, Cost>> {
    const response = await worker.fetch(`http://127.0.0.1/?name=${name}-${Date.now()}`, {
      method: "POST",
      body: JSON.stringify({ shape: { now: Date.now(), ...shape }, steps: STEPS }),
    });
    const body = (await response.json()) as Record<string, Cost> & { message?: string };
    expect(response.status, body.message).toBe(200);
    return body;
  }

  it("keeps the alarm loop near 3% of the rows_read cap at production size", async () => {
    const cost = await measure("current", CURRENT);
    const perDay = alarmReadsPerDay(cost);
    console.log("current", JSON.stringify(cost), "alarm rows_read/day", perDay);
    expect(cost.cold!.rowsRead).toBeLessThan(400);
    expect(cost.warm!.rowsRead).toBeLessThan(20);
    expect(cost.watched!.rowsRead).toBeLessThanOrEqual(100);
    expect(cost.healthWarm!.rowsRead).toBe(0);
    expect(cost.savesWarm!.rowsRead).toBe(0);
    expect(cost.register!.rowsWritten).toBe(0);
    expect(perDay / ROWS_READ_CAP).toBeLessThan(0.05);
  }, 60_000);

  it("upgrades a v10 database with legacy rows in workerd, once", async () => {
    const response = await worker.fetch(`http://127.0.0.1/?name=upgrade-${Date.now()}`, {
      method: "POST",
      body: JSON.stringify({
        shape: { now: Date.now(), ...CURRENT },
        steps: [
          { label: "rewind", kind: "sql", sql: "DELETE FROM schema_migrations WHERE version = 11" },
          { label: "restore", kind: "sql", sql: "CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status)" },
          { label: "legacyBefore", kind: "sql", sql: "SELECT id FROM actions WHERE created_at = 0" },
          { label: "upgrade", kind: "migrate" },
          { label: "legacyAfter", kind: "sql", sql: "SELECT id FROM actions WHERE created_at = 0" },
          { label: "again", kind: "migrate" },
          { label: "plan", kind: "plan", sql: "SELECT block FROM actions WHERE proxy = ? AND perp_id = ? AND status = 'confirmed' AND block IS NOT NULL ORDER BY id DESC LIMIT 1", bindings: ["0xa", "16"] },
        ] satisfies Step[],
      }),
    });
    const body = (await response.json()) as Record<string, { rows?: number; rowsRead?: number; rowsWritten?: number; versions?: number[] }> & {
      plan?: string[];
      message?: string;
    };
    expect(response.status, body.message).toBe(200);
    console.log("upgrade", JSON.stringify(body));
    expect(body.legacyBefore!.rows).toBe(CURRENT.legacy);
    expect(body.legacyAfter!.rows).toBe(0);
    expect(body.upgrade!.versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(body.again!.rowsWritten).toBe(0);
    expect(body.plan?.join(" | ")).toContain("idx_actions_last_block");
  }, 60_000);

  it("stays bounded with 10x the pool and 50x the history", async () => {
    const cost = await measure("grown", GROWN);
    const perDay = alarmReadsPerDay(cost);
    console.log("grown", JSON.stringify(cost), "alarm rows_read/day", perDay);
    expect(cost.watched!.rowsRead).toBeLessThanOrEqual(100);
    expect(cost.cold!.rowsRead).toBeLessThan(4_000);
    expect(cost.register!.rowsWritten).toBe(0);
    expect(cost.prune!.rowsWritten).toBeLessThanOrEqual(201);
    expect(cost.healthWarm!.rowsRead).toBe(0);
    expect(perDay / ROWS_READ_CAP).toBeLessThan(0.12);
  }, 120_000);
});
