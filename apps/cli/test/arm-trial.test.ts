import { describe, expect, it } from "vitest";
import { distanceInTargetBand, median } from "../src/commands/arm-trial.js";

describe("arm trial band", () => {
  it("accepts a distance inside the W5 band and rejects one outside it", () => {
    expect(distanceInTargetBand(60_604n)).toBe(true);
    expect(distanceInTargetBand(58_000n)).toBe(true);
    expect(distanceInTargetBand(65_000n)).toBe(true);
    expect(distanceInTargetBand(57_999n)).toBe(false);
    expect(distanceInTargetBand(65_001n)).toBe(false);
  });

  it("takes the middle sample as p50", () => {
    expect(median([2500, 100, 900, 400, 1200])).toBe(900);
  });
});
