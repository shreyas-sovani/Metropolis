import { describe, expect, it } from "vitest";
import { formatPrice } from "../lib/format";
import { LANDING_MS, LIQUIDATIONS_MS, MARKETS_MS, pollDue } from "../lib/poll";
import { liquidationTape } from "../lib/tape";

describe("prices and the liquidation tape", () => {
  it("formats a BTC price with one decimal", () => {
    expect(formatPrice("83702300000", 1)).toBe("$83,702.3");
  });

  it("does not print a perp id", () => {
    const line = liquidationTape({ symbol: "BTC", side: "long", notionalMicro: "1501000000", blockNumber: 111200117 });
    expect(line).toBe("BTC long · $1,501 · block 111,200,117");
    expect(line).not.toMatch(/perp \d/);
    expect(line).toContain("$");
  });
});

describe("radar polling", () => {
  it("asks for liquidations at most once a minute and markets at most once every five minutes", () => {
    let liquidations = 0;
    let markets = 0;
    let landing = 0;
    let lastLiquidations: number | null = null;
    let lastMarkets: number | null = null;
    let lastLanding: number | null = null;
    for (let now = 0; now < MARKETS_MS; now += 2_000) {
      if (pollDue(lastLiquidations, now, LIQUIDATIONS_MS)) {
        liquidations += 1;
        lastLiquidations = now;
      }
      if (pollDue(lastMarkets, now, MARKETS_MS)) {
        markets += 1;
        lastMarkets = now;
      }
      if (pollDue(lastLanding, now, LANDING_MS)) {
        landing += 1;
        lastLanding = now;
      }
    }
    expect(liquidations).toBe(5);
    expect(markets).toBe(1);
    expect(landing).toBe(30);
  });
});
