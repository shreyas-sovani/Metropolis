import { describe, expect, it } from "vitest";
import { functionSelector } from "@lifeline/core";
import { getAddress } from "viem";
import type { LifelineEnv } from "../src/lifeline.js";
import type { Sql } from "../src/schema.js";
import { judgeCanary } from "../src/tick.js";
import { sandboxArm, sandboxLimited } from "../src/sandbox.js";

describe("sandbox and canary", () => {
  it("rate-limits the eleventh sandbox arm from one address", () => {
    expect(sandboxLimited(9)).toBe(false);
    expect(sandboxLimited(10)).toBe(true);
  });

  it("returns 404 when demo mode is pointed at a twin", async () => {
    const sql: Sql = {
      exec(query: string) {
        if (query.includes("COUNT")) return { toArray: () => [{ n: 0 }] };
        if (query.includes("FROM pool")) return { toArray: () => [{ perp_id: "16", role: "twin-protected" }] };
        return { toArray: () => [] };
      },
    };
    const response = await sandboxArm(
      sql,
      { RPC_URLS_TESTNET: "http://127.0.0.1:9", POOL_OWNER_PK: "0x" } as LifelineEnv,
      { proxy: getAddress("0x00000000000000000000000000000000000000a1"), ip: "203.0.113.8" },
      1,
    );
    expect(response.status).toBe(404);
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
