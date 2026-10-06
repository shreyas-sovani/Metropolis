import { describe, expect, it } from "vitest";
import {
  TEST_NOW_LABEL,
  armDefaults,
  armExplanation,
  armedWaitCopy,
  testNowTerms,
} from "../src/lifeline/mandate.js";

function triggerE6(bps: number): bigint {
  return BigInt(bps) * 100n;
}

describe("arm defaults", () => {
  it("keeps the 4%/6% demo when the position is near 2.7%", () => {
    expect(armDefaults(28_300n)).toEqual({ triggerBps: 400, targetBps: 600 });
    expect(armDefaults(25_000n)).toEqual({ triggerBps: 400, targetBps: 600 });
    expect(armDefaults(60_000n)).toEqual({ triggerBps: 700, targetBps: 900 });
    expect(armDefaults(150_000n)).toEqual({ triggerBps: 1600, targetBps: 1800 });
  });

  it("stays above the live distance from 1.5% through 15%", () => {
    for (let distance = 15_000n; distance <= 150_000n; distance += 100n) {
      const terms = armDefaults(distance);
      expect(terms.triggerBps).toBeGreaterThanOrEqual(400);
      expect(terms.targetBps).toBeLessThanOrEqual(2000);
      expect(terms.triggerBps).toBeLessThan(terms.targetBps);
      expect(triggerE6(terms.triggerBps) > distance).toBe(true);
      const uncapped = terms.triggerBps + 200;
      expect(terms.targetBps).toBe(uncapped > 2000 ? 2000 : uncapped);
    }
  });

  it("shows the explanatory copy and a test that fires now", () => {
    const terms = armDefaults(28_300n);
    expect(armExplanation(28_300n, terms)).toBe(
      "Your position is 2.8% from liquidation. Lifeline will act below 4% and restore 6%.",
    );
    expect(armedWaitCopy(300)).toBe("Armed: Lifeline will act when distance falls below 3%.");
    expect(TEST_NOW_LABEL).toBe("Test Lifeline now");
    const test = testNowTerms(28_300n);
    expect(triggerE6(test.triggerBps) > 28_300n).toBe(true);
    expect(test.targetBps).toBe(test.triggerBps + 200);
  });
});
