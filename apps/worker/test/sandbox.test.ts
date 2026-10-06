import { describe, expect, it } from "vitest";
import { functionSelector } from "@lifeline/core";
import { judgeCanary } from "../src/tick.js";
import { sandboxLimited } from "../src/sandbox.js";

describe("sandbox and canary", () => {
  it("rate-limits the fourth sandbox arm", () => {
    expect(sandboxLimited(2)).toBe(false);
    expect(sandboxLimited(3)).toBe(true);
  });

  it("sets degraded when the canary targets a revoked selector", () => {
    const revoked = functionSelector("execOrder");
    expect(judgeCanary(revoked, false)).toEqual({ degraded: true, reason: "canary revert" });
    expect(judgeCanary(functionSelector("increasePositionCollateral"), false)).toEqual({
      degraded: false,
      reason: null,
    });
    expect(judgeCanary(functionSelector("increasePositionCollateral"), true)).toEqual({
      degraded: true,
      reason: "canary revert",
    });
  });
});
