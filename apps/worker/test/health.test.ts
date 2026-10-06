import { describe, expect, it } from "vitest";
import { coreEvaluator } from "../src/adapter.js";
import {
  clientError,
  countBySide,
  countInBand,
  healthReport,
  isOpsLow,
  needsAlarm,
  pausedFlag,
  WORKER_VERSION,
} from "../src/health.js";
import { opsDue } from "../src/ops.js";

describe("worker health", () => {
  it("reports a clean scaffold with degraded false", () => {
    expect(
      healthReport({
        lastAlarmAt: null,
        ticksLast10m: 0,
        lastError: null,
        paused: false,
        poolAvailable: 0,
        sponsorWei: 0n,
        operatorWei: 0n,
        poolInBand: 0,
        poolBySide: { long: 0, short: 0 },
      }),
    ).toEqual({
      lastAlarmAt: null,
      ticksLast10m: 0,
      degraded: false,
      paused: false,
      poolAvailable: 0,
      sponsorMon: "0.0000",
      operatorMon: "0.0000",
      poolInBand: 0,
      poolBySide: { long: 0, short: 0 },
      low: true,
      version: WORKER_VERSION,
    });
  });

  it("flips low only under a floor", () => {
    const healthy = {
      sponsorWei: 3n * 10n ** 18n,
      operatorWei: 10n ** 18n,
      poolAvailable: 10,
      poolInBand: 5,
    };
    expect(isOpsLow(healthy)).toBe(false);
    expect(isOpsLow({ ...healthy, sponsorWei: healthy.sponsorWei - 1n })).toBe(true);
    expect(isOpsLow({ ...healthy, operatorWei: healthy.operatorWei - 1n })).toBe(true);
    expect(isOpsLow({ ...healthy, poolAvailable: 9 })).toBe(true);
    expect(isOpsLow({ ...healthy, poolInBand: 4 })).toBe(true);
    expect(countInBand([24_999n, 25_000n, 35_000n, 35_001n])).toBe(2);
    expect(countBySide(["long", "short", "long", "reserve"])).toEqual({ long: 2, short: 1 });
    expect(opsDue(null, 1_000)).toBe(true);
    expect(opsDue(1_000, 60_999)).toBe(false);
    expect(opsDue(1_000, 61_000)).toBe(true);
  });

  it("treats only an explicit pause flag as paused", () => {
    expect(pausedFlag("true")).toBe(true);
    expect(pausedFlag("1")).toBe(true);
    expect(pausedFlag("false")).toBe(false);
    expect(pausedFlag(undefined)).toBe(false);
  });

  it("re-arms when the alarm is missing or the last tick is stale", () => {
    expect(needsAlarm(null, null, 1_000)).toBe(true);
    expect(needsAlarm(500, 900, 1_000)).toBe(true);
    expect(needsAlarm(2_000, 1_000, 1_500)).toBe(false);
    expect(needsAlarm(20_000, 1_000, 12_000)).toBe(true);
  });

  it("still reports reads while paused", () => {
    const report = healthReport({
      lastAlarmAt: 10,
      ticksLast10m: 4,
      lastError: null,
      paused: true,
      poolAvailable: 2,
      sponsorWei: 4n * 10n ** 18n,
      operatorWei: 2n * 10n ** 18n,
      poolInBand: 5,
      poolBySide: { long: 1, short: 1 },
    });
    expect(report.paused).toBe(true);
    expect(report.degraded).toBe(false);
    expect(report.poolAvailable).toBe(2);
  });

  it("strips RPC URLs from client errors", () => {
    const error = new Error("HTTP request failed. URL: https://rpc.example/v2/secret body") as Error & {
      shortMessage?: string;
      status?: number;
    };
    error.shortMessage = "HTTP request failed.";
    error.status = 429;
    expect(clientError(error)).toBe("status 429 HTTP request failed.");
  });

  it("reaches the core evaluator through the adapter", () => {
    expect(typeof coreEvaluator()).toBe("function");
  });
});
