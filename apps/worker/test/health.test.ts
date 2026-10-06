import { describe, expect, it } from "vitest";
import { coreEvaluator } from "../src/adapter.js";
import { clientError, healthReport, pausedFlag, WORKER_VERSION } from "../src/health.js";

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
