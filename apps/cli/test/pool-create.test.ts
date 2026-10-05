import { describe, expect, it } from "vitest";
import { accountSide, distanceBand, lotForNotional, targetLeverageHdths } from "../src/commands/pool-create.js";

describe("pool create", () => {
  it("caps leverage at 15x BTC and 12x ETH", () => {
    expect(targetLeverageHdths("BTC", 1500n)).toBe(1500n);
    expect(targetLeverageHdths("BTC", 2000n)).toBe(1500n);
    expect(targetLeverageHdths("ETH", 1500n)).toBe(1200n);
    expect(targetLeverageHdths("ETH", 1000n)).toBe(1000n);
  });

  it("alternates and starts by reducing a maker short", () => {
    expect(accountSide(0, "short")).toBe("short");
    expect(accountSide(1, "short")).toBe("long");
    expect(accountSide(2, "short")).toBe("short");
    expect(accountSide(0, "flat")).toBe("long");
    expect(accountSide(1, "flat")).toBe("short");
  });

  it("uses the BTC and ETH distance bands", () => {
    expect(distanceBand("BTC")).toEqual({ minE6: 20_000n, maxE6: 35_000n });
    expect(distanceBand("ETH")).toEqual({ minE6: 25_000n, maxE6: 45_000n });
  });

  it("sizes a lot for about 1500 AUSD of notional", () => {
    const lot = lotForNotional(860_220n, 1, 4);
    expect(lot).toBeGreaterThan(0n);
    expect(lot).toBeLessThan(10_000n);
  });
});
