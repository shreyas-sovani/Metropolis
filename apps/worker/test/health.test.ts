import { describe, expect, it } from "vitest";
import { coreEvaluator } from "../src/adapter.js";
import { clientError, healthReport, needsAlarm, pausedFlag, WORKER_VERSION } from "../src/health.js";

describe("worker health", () => {
  it("reports a clean scaffold with degraded false", () => {
    expect(
      healthReport({
        lastAlarmAt: null,
        ticksLast10m: 0,
        lastError: null,
        paused: false,
        poolAvailable: 0,
      }),
    ).toEqual({
      lastAlarmAt: null,
      ticksLast10m: 0,
      degraded: false,
      paused: false,
      poolAvailable: 0,
      version: WORKER_VERSION,
    });
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
