import { describe, expect, it } from "vitest";
import { radarId } from "@lifeline/core";
import { resolveHighlightId } from "../lib/radar-highlight";
import {
  barFraction,
  blockAgo,
  bucketSentence,
  defaultMarketId,
  emptyMarketLine,
  emptyMarketSymbols,
  highlightedBucket,
  marketsForChart,
  penaltySentence,
  priceAtOffset,
} from "../lib/radar-view";

const salt = `0x${"ab".repeat(32)}` as const;

describe("radar market selector", () => {
  const markets = [
    { perpId: 2, symbol: "ETH", atRiskNotionalMicro: "100", buckets: [{ index: 1 }], atRisk: [] },
    { perpId: 1, symbol: "BTC", atRiskNotionalMicro: "50", buckets: [{ index: 2 }], atRisk: [] },
    { perpId: 3, symbol: "SOL", atRiskNotionalMicro: "0", buckets: [], atRisk: [] },
    { perpId: 4, symbol: "TAO", buckets: [], atRisk: [] },
  ];

  it("charts only markets that have buckets, with the most money at risk first", () => {
    expect(marketsForChart(markets).map((market) => market.symbol)).toEqual(["ETH", "BTC"]);
  });

  it("keeps empty markets in one line and still opens on BTC", () => {
    expect(emptyMarketSymbols(markets)).toEqual(["SOL", "TAO"]);
    expect(emptyMarketLine(["SOL", "TAO"])).toBe("No positions near liquidation in SOL, TAO.");
    expect(emptyMarketLine([])).toBeNull();
    expect(defaultMarketId(marketsForChart(markets))).toBe(1);
  });
});

describe("radar chart geometry", () => {
  it("prices a bucket from the mark and writes the hover sentence", () => {
    expect(priceAtOffset("100000000000", -5)).toBe("95000000000");
    const sentence = bucketSentence(
      { side: "long", count: 2, notionalMicro: "200000000", index: 40, idleCount: 1 },
      "100000000000",
    );
    expect(sentence).toBe("2 longs · $200 · liquidate between $95,000 and $95,250 · 1 has idle AUSD.");
    expect(sentence).toContain("longs");
  });

  it("scales bar height with the square root of notional", () => {
    expect(barFraction("4000000", "16000000")).toBeCloseTo(0.5);
    expect(barFraction("0", "10")).toBe(0);
  });

  it("ages a liquidation from the block gap", () => {
    expect(blockAgo("110", 9, 1_000_000)).toBe("1 min ago");
  });
});

describe("radar copy and highlight", () => {
  it("uses the corrected penalty sentence", () => {
    expect(penaltySentence("$12", "$4")).toBe(
      "Of $12 in penalties over 30 days, $4 belonged to accounts whose idle AUSD could have moved the liquidation price at least 1% away.",
    );
  });

  it("turns a practice account into the anonymized id", async () => {
    const address = "0x1111111111111111111111111111111111111111" as const;
    const id = await resolveHighlightId({
      chainId: 10143,
      highlight: address,
      salt,
      lookup: async () => 42n,
    });
    expect(id).toBe(radarId(salt, 10143, 42n));
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(
      await resolveHighlightId({
        chainId: 10143,
        highlight: "not-an-address",
        salt,
        lookup: async () => 42n,
      }),
    ).toBeNull();
    expect(
      await resolveHighlightId({
        chainId: 10143,
        highlight: address,
        salt,
        lookup: async () => {
          throw new Error("missing");
        },
      }),
    ).toBeNull();
  });

  it("points the outline at that position's bucket", () => {
    expect(
      highlightedBucket(
        [{ id: "ab12cd34", side: "long", bucketIndex: 40 }],
        "ab12cd34",
      ),
    ).toEqual({ index: 40, side: "long" });
    expect(highlightedBucket([{ id: "ab12cd34", side: "long" }], "ab12cd34")).toBeNull();
  });
});
