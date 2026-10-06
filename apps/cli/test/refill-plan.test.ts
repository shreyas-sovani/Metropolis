import { describe, expect, it } from "vitest";
import { nextRefillSide } from "../src/refill-plan.js";

const target = { available: 30, perSide: 12, inBand: 10 };

describe("pool refill plan", () => {
  it("opens the thinner side until both sides and the band are full", () => {
    expect(nextRefillSide({ available: 0, long: 0, short: 0, inBand: 0 }, target)).toBe("long");
    expect(nextRefillSide({ available: 10, long: 4, short: 6, inBand: 3 }, target)).toBe("long");
    expect(nextRefillSide({ available: 20, long: 12, short: 8, inBand: 10 }, target)).toBe("short");
    expect(nextRefillSide({ available: 24, long: 12, short: 12, inBand: 9 }, target)).toBe("long");
  });

  it("sends nothing once every target is met", () => {
    expect(nextRefillSide({ available: 30, long: 16, short: 14, inBand: 10 }, target)).toBeNull();
    expect(nextRefillSide({ available: 40, long: 20, short: 20, inBand: 15 }, target)).toBeNull();
  });
});
