import { describe, expect, it } from "vitest";
import { calibrationMark } from "../lib/badge";
import { REVOKED_LABELS, REVOKED_SELECTORS, WITHDRAW_NOTE } from "../lib/copy";
import { forbiddenHit } from "../lib/forbidden";
import { marketName, sparkFromCandles } from "../lib/markets";
import { allowRequest } from "../lib/rate";

describe("calibration badge", () => {
  it("shows the contract-exact link only when calibrated", () => {
    expect(calibrationMark(true)).toEqual({ kind: "exact", label: "Contract-exact" });
    expect(calibrationMark(false)).toEqual({ kind: "est", label: "est." });
  });
});

describe("perpl markets", () => {
  it("reads a display name and falls back when the name is missing", () => {
    expect(marketName({ market_id: 1, config: { name: "Bitcoin" } })).toEqual({ perpId: 1, name: "Bitcoin" });
    expect(marketName({ id: 2 })).toBeNull();
    expect(sparkFromCandles({ d: [{ c: 3 }, { c: 4 }, {}] })).toEqual([3, 4]);
  });
});

describe("plain-language copy", () => {
  it("talks about Lifeline's key, not the internal names", () => {
    expect(WITHDRAW_NOTE).toContain("Lifeline's key");
    expect(forbiddenHit(WITHDRAW_NOTE)).toBeNull();
    expect(REVOKED_SELECTORS).toContain("execOrder");
    expect(forbiddenHit(REVOKED_LABELS.join(" "))).toBeNull();
    expect(REVOKED_LABELS.join(" ")).not.toMatch(/execOrder|selector/i);
  });
});

describe("risk rate limit", () => {
  it("returns 429 after 60 requests in a minute", () => {
    const hits: number[] = [];
    for (let index = 0; index < 60; index += 1) expect(allowRequest(hits, 1_000)).toBe(true);
    expect(allowRequest(hits, 1_000)).toBe(false);
    expect(allowRequest(hits, 61_000)).toBe(true);
  });
});
