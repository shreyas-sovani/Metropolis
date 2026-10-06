import { describe, expect, it } from "vitest";
import { entriesMatch, lotForLeverage, twinLeverage } from "../src/commands/twins-create.js";
import { rankMarkets, returnVariance } from "../src/mark-rank.js";

describe("twins", () => {
  it("caps SOL at 10x and keeps a lower initial margin", () => {
    expect(twinLeverage(1000n, 1500n)).toBe(1000n);
    expect(twinLeverage(1000n, 800n)).toBe(800n);
    expect(twinLeverage(1500n, 2000n)).toBe(1500n);
  });

  it("ranks the market with the larger relative moves first", () => {
    expect(returnVariance([100n, 100n, 100n])).toBe(0);
    const ranked = rankMarkets([
      { symbol: "MON", prices: [100n, 101n, 99n, 103n] },
      { symbol: "ZEC", prices: [1000n, 1000n, 1001n, 1000n] },
      { symbol: "PUMP", prices: [5n] },
    ]);
    expect(ranked.map((row) => row.symbol)).toEqual(["MON", "ZEC"]);
    expect(ranked[0]?.variance).toBeGreaterThan(ranked[1]?.variance ?? 0);
  });

  it("sizes a 3x leg inside a 180 AUSD margin", () => {
    const lot = lotForLeverage(3111n, 5, 0, 300n);
    expect(lot).toBeGreaterThan(0n);
    const notionalMicro = (lot * 3111n * 1_000_000n) / 100_000n;
    expect(notionalMicro).toBeLessThanOrEqual(180n * 1_000_000n * 3n);
  });

  it("matches entries within 0.1%", () => {
    expect(entriesMatch(860_000n, 860_500n)).toBe(true);
    expect(entriesMatch(860_000n, 870_000n)).toBe(false);
    expect(entriesMatch(0n, 1n)).toBe(false);
  });
});
