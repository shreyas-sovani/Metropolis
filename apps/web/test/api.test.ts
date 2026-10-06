import { describe, expect, it } from "vitest";
import { HistoryStore, evaluate, type RadarSnapshot } from "@lifeline/core";
import { sameActionHashes } from "../lib/actions";
import { dryRunMandate, dryRunPosition, sameDryRun, toEvalPosition } from "../lib/account";
import { handleAccount } from "../lib/account-route";
import { handleLiquidations } from "../lib/liquidations";
import { handleRadar } from "../lib/radar";
import { createRefreshCache } from "../lib/refresh-cache";
import type { HistoryPage } from "@lifeline/core";
import type { LiquidationRow } from "@lifeline/core";

function row(block: number): LiquidationRow {
  return {
    blockNumber: block,
    perpId: "1",
    positionType: 0,
    idleAtLiq: "5",
    eligible: false,
    notionalMicro: "100",
    posDepositCNS: "9",
    markPricePNS: "10",
    liqLotLNS: "2",
    accAmountCNS: "0",
  };
}

const snapshot = {
  chainId: 143,
  blockNumber: "1",
  headline: {
    openInterestMicro: "0",
    positionCount: 0,
    atRiskNotionalMicro: "0",
    atRiskCount: 0,
    idleMicro: "0",
    couldProtectNow: 0,
  },
  markets: [],
  positions: [],
} satisfies RadarSnapshot;

describe("/api/liquidations", () => {
  it("collapses 100 concurrent reads into one HyperSync request", async () => {
    const store = new HistoryStore(async (cursor): Promise<HistoryPage> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { rows: [row(cursor + 1)], cursor: cursor + 1 };
    }, 0);
    const responses = await Promise.all(Array.from({ length: 100 }, () => handleLiquidations(store, 1_000)));
    expect(store.hypersyncRequests).toBe(1);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const body = (await responses[0]!.json()) as { totals: { count: number; notionalMicro: string }; rows: LiquidationRow[]; stale: boolean };
    const sum = body.rows.reduce((total, item) => total + BigInt(item.notionalMicro), 0n);
    expect(body.totals.count).toBe(body.rows.length);
    expect(body.totals.notionalMicro).toBe(sum.toString());
    expect(body.stale).toBe(false);
  });

  it("serves the last good history with 200 when HyperSync returns 429", async () => {
    let calls = 0;
    const store = new HistoryStore(async (): Promise<HistoryPage> => {
      calls += 1;
      if (calls > 1) throw new Error("hypersync status 429");
      return { rows: [row(4)], cursor: 5 };
    }, 0);
    expect((await handleLiquidations(store, 0)).status).toBe(200);
    const stale = await handleLiquidations(store, 60_000);
    expect(stale.status).toBe(200);
    expect(((await stale.json()) as { stale: boolean }).stale).toBe(true);
  });
});

describe("/api/radar", () => {
  it("keeps 50 reads over 10s to at most 6 upstream builds and validates the schema", async () => {
    const cache = createRefreshCache<RadarSnapshot>(2_000);
    const load = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return snapshot;
    };
    const started = performance.now();
    const cold = await handleRadar({ chain: "143", now: 0, load, cache, ping: () => undefined });
    expect(cold.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(6_000);
    const warmTimes: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const mark = performance.now();
      const response = await handleRadar({ chain: "143", now: 500, load, cache, ping: () => undefined });
      warmTimes.push(performance.now() - mark);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, s-maxage=2, stale-while-revalidate=10");
    }
    warmTimes.sort((left, right) => left - right);
    expect(warmTimes[Math.floor(warmTimes.length * 0.95)] ?? 999).toBeLessThan(300);
    const loadCache = createRefreshCache<RadarSnapshot>(2_000);
    let loadBuilds = 0;
    const counted = async () => {
      loadBuilds += 1;
      return snapshot;
    };
    const waves = [0, 2_000, 4_000, 6_000, 8_000, 10_000];
    for (const now of waves) {
      await Promise.all(
        Array.from({ length: 50 }, () => handleRadar({ chain: "143", now, load: counted, cache: loadCache, ping: () => undefined })),
      );
    }
    expect(loadBuilds).toBeLessThanOrEqual(6);
    expect((await handleRadar({ chain: "1", now: 0, load, cache, ping: () => undefined })).status).toBe(400);
  });
});

describe("account dry run", () => {
  it("matches evaluate at 4% and 6%", async () => {
    const position = toEvalPosition({
      markPriceValid: true,
      positionType: 0,
      lotLNS: 100n,
      pricePNS: 100_000n,
      depositCNS: 1_000_000n,
      premiumPnlCNS: 0n,
      priceDecimals: 0,
      lotDecimals: 0,
      maintHdths: 2500n,
      markPNS: 90_000n,
    });
    const account = "0x0000000000000000000000000000000000000001" as const;
    const nowSec = 1_000_000n;
    const direct = evaluate(
      dryRunMandate(account, 1n, nowSec),
      position,
      { freeBalanceMicro: 5_000_000n, paused: false, nowSec },
      null,
      10n,
      0n,
    );
    const viaRoute = dryRunPosition({
      account,
      perpId: 1n,
      position,
      freeCNS: 5_000_000n,
      nowSec,
      nowBlock: 10n,
    });
    expect(sameDryRun(direct, viaRoute)).toBe(true);
    expect((await handleAccount(143, "not-an-address")).status).toBe(400);
    if (direct.action === "topUp" && viaRoute.action === "topUp") {
      expect(viaRoute.amountCNS).toBe(direct.amountCNS);
    }
  });
});

describe("actions", () => {
  it("compares tx hashes with the stored rows", () => {
    const rows = [
      { txHash: "0xabc", block: 1, amountCNS: "1", perpId: "16", status: "confirmed" },
      { txHash: "0xdef", block: 2, amountCNS: "2", perpId: "16", status: "confirmed" },
    ];
    expect(sameActionHashes(rows, rows)).toBe(true);
    expect(sameActionHashes(rows, [rows[0]!])).toBe(false);
  });
});
