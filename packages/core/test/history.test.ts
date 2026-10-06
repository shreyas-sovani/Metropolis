import { describe, expect, it } from "vitest";
import { retryAfterMs } from "../src/hypersync/client.js";
import { HistoryStore, historyDue, totalsMatch, type HistoryPage } from "../src/hypersync/history.js";
import type { LiquidationRow } from "../src/hypersync/analytics.js";

function row(block: number, notional = "1000", idle = "50"): LiquidationRow {
  return {
    blockNumber: block,
    perpId: "16",
    positionType: 0,
    idleAtLiq: idle,
    eligible: true,
    notionalMicro: notional,
    posDepositCNS: "10",
    markPricePNS: String(block),
    liqLotLNS: "1",
    accAmountCNS: "0",
  };
}

describe("history cache", () => {
  it("serves one HyperSync read to a burst inside 60s", async () => {
    let calls = 0;
    const store = new HistoryStore(async (cursor): Promise<HistoryPage> => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { rows: [row(cursor + 1)], cursor: cursor + 2 };
    }, 100);
    const burst = await Promise.all(Array.from({ length: 100 }, () => store.get(1_000)));
    expect(store.hypersyncRequests).toBe(1);
    expect(calls).toBe(1);
    expect(burst.every((item) => item.stale === false)).toBe(true);
    expect(totalsMatch(burst[0]!)).toBe(true);
    const again = await Promise.all(Array.from({ length: 100 }, () => store.get(30_000)));
    expect(store.hypersyncRequests).toBe(1);
    expect(again[0]?.rows).toHaveLength(1);
    expect(historyDue(1_000, 61_000)).toBe(true);
  });

  it("returns the last good history when the tail refresh is rate limited", async () => {
    let calls = 0;
    const store = new HistoryStore(async (cursor): Promise<HistoryPage> => {
      calls += 1;
      if (calls > 1) throw new Error("hypersync status 429");
      return { rows: [row(cursor), row(cursor + 1, "250")], cursor: cursor + 5 };
    }, 10);
    const first = await store.get(0);
    expect(first.stale).toBe(false);
    expect(totalsMatch(first)).toBe(true);
    const stale = await store.get(60_000);
    expect(stale.stale).toBe(true);
    expect(stale.rows).toEqual(first.rows);
    expect(stale.totals).toEqual(first.totals);
    expect(store.hypersyncRequests).toBe(2);
  });

  it("appends only the tail after the cursor", async () => {
    const pages = [
      { rows: [row(1, "10", "1"), row(2, "20", "2")], cursor: 3 },
      { rows: [row(2, "20", "2"), row(4, "40", "4")], cursor: 5 },
    ];
    const store = new HistoryStore(async () => pages.shift() ?? { rows: [], cursor: 5 }, 0);
    await store.get(0);
    const next = await store.get(60_000);
    expect(next.rows.map((item) => item.blockNumber)).toEqual([1, 2, 4]);
    expect(next.totals.notionalMicro).toBe("70");
    expect(next.totals.idleAtLiq).toBe("7");
    expect(totalsMatch(next)).toBe(true);
  });

  it("reads retry-after as seconds and a reset timestamp", () => {
    expect(retryAfterMs("2", 0, 1_000)).toBe(2_000);
    expect(retryAfterMs(null, 0, 500)).toBe(500);
    expect(retryAfterMs("1700000001", 1_700_000_000_000, 5_000)).toBe(1_000);
  });
});
