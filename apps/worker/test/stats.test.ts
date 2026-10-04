import { describe, expect, it } from "vitest";
import { evaluateStub, maxGapMs } from "../src/stats.js";

describe("keeper stats", () => {
  it("measures the largest gap between ticks", () => {
    expect(maxGapMs([0, 2000, 4000, 11000])).toBe(7000);
    expect(maxGapMs([5])).toBe(0);
  });

  it("keeps the evaluator stub inert", () => {
    expect(evaluateStub(1n)).toBe("skip");
  });
});
