import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { getAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildMandate } from "@lifeline/core";
import { signMandate, serializeMandate } from "../src/house.js";
import { blankHot, hotDue, hydrateHot, insertAction, noteConfirmed } from "../src/hot.js";
import { Lifeline } from "../src/lifeline.js";
import { registerPool } from "../src/register.js";
import { migrate, type Sql } from "../src/schema.js";
import { armPosition } from "../src/arm.js";
import { soakReport, takeNonce } from "../src/tick.js";

const chainState = { owner: "0x0000000000000000000000000000000000000001" };

vi.mock("@lifeline/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lifeline/core")>();
  return {
    ...actual,
    openChain: () => ({
      client: {
        getBalance: async () => 10n ** 20n,
        getBlockNumber: async () => 100n,
        getTransactionCount: async () => 0,
        getTransactionReceipt: async () => {
          throw new Error("not found");
        },
        readContract: async () => chainState.owner,
        call: async () => ({ data: "0x" }),
        multicall: async ({ contracts }: { contracts: { functionName: string }[] }) => {
          const name = contracts[0]?.functionName;
          if (name === "getPositionV2") {
            return contracts.map(() => [
              {
                positionType: 0,
                pricePNS: 100_000_000n,
                lotLNS: 10_000n,
                depositCNS: 500_000_000n,
                premiumPnlCNS: 0n,
              },
              100_000_000n,
              false,
            ]);
          }
          return contracts.map((contract) =>
            contract.functionName === "getPerpetualInfoV2" ? { priceDecimals: 8n, lotDecimals: 4n } : [0n, 500n],
          );
        },
      },
      readAccounts: async (ids: readonly bigint[]) =>
        ids.map((accountId) => ({
          accountId,
          balanceCNS: 0n,
          lockedBalanceCNS: 0n,
          freeCNS: 0n,
          frozen: 0,
          accountAddr: "0x0000000000000000000000000000000000000001" as Address,
          perpIds: [] as number[],
        })),
    }),
  };
});

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROXY = getAddress("0x00000000000000000000000000000000000000a1");
const OTHER = getAddress("0x00000000000000000000000000000000000000a2");

function sqliteSql(db: DatabaseSync): Sql {
  return {
    exec(query: string, ...bindings: unknown[]) {
      const statement = db.prepare(query);
      if (/^\s*(select|pragma|with)\b/i.test(query)) {
        const rows = bindings.length > 0 ? statement.all(...(bindings as never[])) : statement.all();
        return { toArray: () => rows as Record<string, unknown>[] };
      }
      if (bindings.length > 0) statement.run(...(bindings as never[]));
      else statement.run();
      return { toArray: () => [] };
    },
  };
}

function counting(sql: Sql) {
  let reads = 0;
  let execs = 0;
  return {
    get reads() {
      return reads;
    },
    get execs() {
      return execs;
    },
    reset() {
      reads = 0;
      execs = 0;
    },
    exec(query: string, ...bindings: unknown[]) {
      execs += 1;
      if (/^\s*(select|pragma|with)\b/i.test(query)) reads += 1;
      return sql.exec(query, ...bindings);
    },
  };
}

function pool(proxy: Address, role: "pool" | "twin-protected" | "twin-unprotected" = "pool") {
  return {
    proxy,
    accountId: "821",
    perpId: "16",
    side: "long" as const,
    leverage: "1500",
    market: "BTC",
    role,
    pairId: role === "pool" ? "" : "btc-long",
  };
}

describe("hot cache", () => {
  it("refreshes on the same 60s gate as recycle", () => {
    expect(hotDue(null, 1)).toBe(true);
    expect(hotDue(0, 59_999)).toBe(false);
    expect(hotDue(0, 60_000)).toBe(true);
  });

  it("hydrates armed mandates, pending actions, and open distances from a fresh database", () => {
    const db = new DatabaseSync(":memory:");
    const sql = sqliteSql(db);
    migrate(sql);
    const names = sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'index'")
      .toArray()
      .map((row) => String(row.name));
    expect(names).toEqual(
      expect.arrayContaining([
        "idx_actions_status",
        "idx_actions_confirmed_open",
        "idx_pool_role",
        "idx_pool_status",
        "idx_claims_unaccepted",
      ]),
    );
    const openIndex = String(
      sql.exec("SELECT sql FROM sqlite_master WHERE name = 'idx_actions_confirmed_open'").toArray()[0]?.sql,
    );
    const claimIndex = String(sql.exec("SELECT sql FROM sqlite_master WHERE name = 'idx_claims_unaccepted'").toArray()[0]?.sql);
    expect(openIndex).toContain("dist_after IS NULL");
    expect(claimIndex).toContain("accepted_at IS NULL");

    sql.exec(
      `INSERT INTO pool (proxy, account_id, perp_id, side, leverage, status, created_at, market, role, pair_id)
       VALUES (?, '821', '16', 'long', '1500', 'available', 1, 'BTC', 'pool', '')`,
      PROXY,
    );
    sql.exec(
      `INSERT INTO pool (proxy, account_id, perp_id, side, leverage, status, created_at, market, role, pair_id)
       VALUES (?, '822', '16', 'short', '1500', 'available', 1, 'BTC', 'pool', '')`,
      OTHER,
    );
    const typed = serializeMandate(
      buildMandate({
        account: PROXY,
        perpIds: [16n],
        triggerBps: 150,
        targetBps: 250,
        maxPerActionCNS: 150_000_000n,
        budgetCNS: 300_000_000n,
        expiry: 2_000_000_000n,
        nonce: 0n,
      }),
    );
    sql.exec(
      `INSERT INTO mandates (proxy, owner, typed_data, sig, active, budget_used_cns, kind) VALUES (?, ?, ?, '0x', 1, '0', 'house')`,
      PROXY,
      PROXY,
      typed,
    );
    sql.exec(
      `INSERT INTO mandates (proxy, owner, typed_data, sig, active, budget_used_cns, kind) VALUES (?, ?, ?, '0x', 0, '0', 'house')`,
      OTHER,
      OTHER,
      typed,
    );
    sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, created_at)
       VALUES (?, '16', '1', NULL, NULL, '1', NULL, 'pending', '', 1)`,
      PROXY,
    );
    sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, created_at)
       VALUES (?, '16', '1', '0xabc', NULL, '1', NULL, 'confirmed', '', 1)`,
      PROXY,
    );
    sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, created_at)
       VALUES (?, '16', '1', '0xdef', 12, '1', '9', 'confirmed', '', 1)`,
      PROXY,
    );
    const hot = blankHot();
    hydrateHot(sql, hot, 50_000);
    expect(hot.loaded).toBe(true);
    expect(hot.armed.map((row) => row.proxy)).toEqual([PROXY]);
    expect(hot.armed[0]?.kind).toBe("house");
    expect(hot.armed[0]?.perp_id).toBe("16");
    expect(hot.mandates.find((row) => row.proxy === OTHER)?.active).toBe(0);
    expect(hot.pending).toHaveLength(1);
    expect(hot.openDist.map((row) => row.tx_hash)).toEqual(["0xabc"]);
    expect(hot.lastBlock.get(`${PROXY}:16`)).toBe(12);
    expect(hot.canaryProxy).toEqual({ proxy: PROXY, perp_id: "16" });
    expect(hot.at).toBe(50_000);
  });

  it("serves a warm tick and /health with zero storage SQL", async () => {
    const db = new DatabaseSync(":memory:");
    const sql = counting(sqliteSql(db));
    let alarmAt: number | null = null;
    let ready = Promise.resolve();
    const ctx = {
      storage: {
        sql,
        getAlarm: async () => alarmAt,
        setAlarm: async (at: number) => {
          alarmAt = at;
        },
        deleteAlarm: async () => {
          alarmAt = null;
        },
      },
      blockConcurrencyWhile(fn: () => Promise<void>) {
        ready = fn();
      },
    };
    const line = new Lifeline(ctx as never, {
      OPERATOR_PK: KEY,
      POOL_OWNER_PK: KEY,
      SPONSOR_PK: KEY,
      ADMIN_SECRET: "hot",
      PRIVY_APP_ID: "",
      PRIVY_VERIFICATION_KEY: "",
      RPC_URLS_TESTNET: "http://127.0.0.1:9",
      LIFELINE_PAUSED: "1",
    });
    await ready;
    const typed = serializeMandate(
      buildMandate({
        account: PROXY,
        perpIds: [16n],
        triggerBps: 150,
        targetBps: 250,
        maxPerActionCNS: 150_000_000n,
        budgetCNS: 300_000_000n,
        expiry: 2_000_000_000n,
        nonce: 0n,
      }),
    );
    sql.exec(
      `INSERT INTO pool (proxy, account_id, perp_id, side, leverage, status, created_at, market, role, pair_id)
       VALUES (?, '821', '16', 'long', '1500', 'available', 1, 'BTC', 'pool', '')`,
      PROXY,
    );
    sql.exec(
      `INSERT INTO mandates (proxy, owner, typed_data, sig, active, budget_used_cns, kind) VALUES (?, ?, ?, '0x', 1, '0', 'house')`,
      PROXY,
      PROXY,
      typed,
    );
    sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, created_at)
       VALUES (?, '16', '1', NULL, NULL, '1', NULL, 'pending', '', ?)`,
      PROXY,
      Date.now(),
    );
    sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, created_at)
       VALUES (?, '16', '1', '0xabc', NULL, '1', NULL, 'confirmed', '', ?)`,
      PROXY,
      Date.now(),
    );
    const now = Date.now();
    sql.exec("UPDATE keeper_stats SET canary_at = ?, recycled_at = ? WHERE id = 1", now, now);
    sql.reset();

    await line.alarm();
    const hydratedReads = sql.reads;
    const filled = sql.exec("SELECT dist_after FROM actions WHERE tx_hash = '0xabc'").toArray()[0] as { dist_after?: string };
    expect(filled?.dist_after, "keeper tick should record distance from the cached open action").toBeTruthy();
    expect(hydratedReads).toBeGreaterThan(0);
    sql.reset();

    const health = await line.fetch(new Request("http://lifeline/health"));
    const body = (await health.json()) as { degraded?: boolean; poolAvailable?: number; paused?: boolean };
    expect(health.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ degraded: false, poolAvailable: 1, paused: true });
    expect(sql.execs).toBe(0);
    sql.reset();

    await line.alarm();
    expect(sql.execs).toBe(0);
    expect(sql.reads).toBe(0);
  });

  it("updates the cache in the same path as register, arm, and action saves", async () => {
    const db = new DatabaseSync(":memory:");
    const sql = sqliteSql(db);
    migrate(sql);
    const hot = blankHot();
    hot.loaded = true;
    hot.pools.push({
      proxy: OTHER,
      account_id: "1",
      perp_id: "16",
      side: "short",
      leverage: "1500",
      status: "available",
      market: "BTC",
      role: "pool",
      pair_id: "",
    });
    const counts = await registerPool(sql, [pool(PROXY)], (message) => signMandate(KEY, message), 1_700_000_000n, hot);
    expect(counts).toEqual({ registered: 2, mandates: 1 });
    expect(hot.pools.map((row) => row.proxy)).toEqual(expect.arrayContaining([OTHER, PROXY]));
    expect(hot.armed.find((row) => row.proxy === PROXY)?.kind).toBe("house");
    expect(hot.mandates.find((row) => row.proxy === PROXY)?.active).toBe(1);

    const userKey = generatePrivateKey();
    const user = privateKeyToAccount(userKey);
    chainState.owner = user.address;
    const armed = blankHot();
    hydrateHot(sql, armed, Date.now());
    const message = buildMandate({
      account: PROXY,
      perpIds: [16n],
      triggerBps: 400,
      targetBps: 600,
      maxPerActionCNS: 150_000_000n,
      budgetCNS: 300_000_000n,
      expiry: BigInt(Math.floor(Date.now() / 1000) + 86_400),
      nonce: 1n,
    });
    const signed = await signMandate(userKey, message);
    const response = await armPosition(
      sql,
      {
        OPERATOR_PK: KEY,
        POOL_OWNER_PK: KEY,
        SPONSOR_PK: KEY,
        ADMIN_SECRET: "",
        PRIVY_APP_ID: "",
        PRIVY_VERIFICATION_KEY: "",
        RPC_URLS_TESTNET: "http://127.0.0.1:9",
        LIFELINE_PAUSED: "1",
      },
      { userId: "user", address: user.address, ip: "127.0.0.1" },
      {
        mandate: {
          account: message.account,
          perpIds: message.perpIds.map((id) => id.toString()),
          triggerBps: message.triggerBps,
          targetBps: message.targetBps,
          maxPerActionCNS: message.maxPerActionCNS.toString(),
          budgetCNS: message.budgetCNS.toString(),
          expiry: message.expiry.toString(),
          nonce: message.nonce.toString(),
        },
        signature: signed.sig,
      },
      Date.now(),
      armed,
    );
    const armBody = (await response.json()) as { skipped?: boolean; error?: string; reason?: string };
    expect(response.status, JSON.stringify(armBody)).toBe(200);
    expect(armBody.skipped).toBe(true);
    expect(armed.mandates.find((row) => row.proxy === PROXY)?.kind).toBe("user");
    expect(armed.armed.find((row) => row.proxy === PROXY)?.kind).toBe("user");

    const saving = blankHot();
    saving.loaded = true;
    saving.pending.push({
      id: 7,
      proxy: OTHER,
      perp_id: "16",
      amount_cns: "1",
      tx_hash: null,
      block: null,
      dist_before: null,
      dist_after: null,
      status: "pending",
      reason: "",
      liq_before: null,
    });
    const id = insertAction(sql, saving, {
      proxy: PROXY,
      perp_id: "16",
      amount_cns: "5",
      tx_hash: "0xabc",
      dist_before: "1",
      status: "pending",
      reason: "",
      liq_before: "9",
      created_at: Date.now(),
    });
    expect(saving.pending.map((row) => row.id)).toEqual([7, id]);
    noteConfirmed(saving, id, 44);
    expect(saving.pending.map((row) => row.id)).toEqual([7]);
    expect(saving.openDist.find((row) => row.id === id)?.block).toBe(44);
    expect(saving.lastBlock.get(`${PROXY}:16`)).toBe(44);
  });

  it("keeps the operator nonce on a synchronous keys read", async () => {
    const db = new DatabaseSync(":memory:");
    const sql = counting(sqliteSql(db));
    migrate(sql);
    sql.reset();
    const nonce = await takeNonce(
      sql,
      { getTransactionCount: async () => 4 } as never,
      "operator",
      getAddress("0x0000000000000000000000000000000000000001"),
    );
    expect(nonce).toBe(4);
    expect(sql.reads).toBeGreaterThan(0);
    const stored = sql.exec("SELECT next_nonce FROM keys WHERE name = 'operator'").toArray()[0] as { next_nonce?: number };
    expect(Number(stored?.next_nonce)).toBe(5);
  });

  it("bounds soak history to seven days and 200 rows", () => {
    const db = new DatabaseSync(":memory:");
    const sql = sqliteSql(db);
    migrate(sql);
    const now = Date.now();
    sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, created_at)
       VALUES ('old', '16', '1', '0xold', 1, NULL, NULL, 'confirmed', '', ?)`,
      now - 8 * 24 * 60 * 60 * 1000,
    );
    sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, created_at)
       VALUES ('legacy', '16', '1', '0xlegacy', 1, NULL, NULL, 'confirmed', '', 0)`,
    );
    sql.exec(
      `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, created_at)
       VALUES ('new', '16', '1', '0xnew', 1, NULL, NULL, 'confirmed', '', ?)`,
      now,
    );
    const windowed = (soakReport(sql, now).recent as { proxy?: string }[]).map((row) => row.proxy);
    expect(windowed).not.toContain("old");
    expect(windowed).toEqual(expect.arrayContaining(["legacy", "new"]));
    for (let i = 0; i < 200; i += 1) {
      sql.exec(
        `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason, created_at)
         VALUES ('bulk', '16', '1', ?, 1, NULL, NULL, 'confirmed', '', ?)`,
        `0x${(i + 10).toString(16)}`,
        now,
      );
    }
    expect(soakReport(sql, now).recent).toHaveLength(200);
    sql.exec(
      `SELECT tx_hash, block, amount_cns, liq_before, proxy FROM actions
       WHERE status = 'confirmed' AND liq_before IS NOT NULL AND liq_before != ''
         AND (created_at = 0 OR created_at >= ?)
       ORDER BY id DESC LIMIT ?`,
      now - 7 * 24 * 60 * 60 * 1000,
      200,
    );
    sql.exec(
      `SELECT tx_hash, block, amount_cns FROM (
         SELECT id, tx_hash, block, amount_cns FROM actions
         WHERE proxy = ? AND status = 'confirmed' AND tx_hash LIKE '0x%'
         ORDER BY id DESC LIMIT ?
       ) AS recent ORDER BY id`,
      "new",
      200,
    );
  });
});
