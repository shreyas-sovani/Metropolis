import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { pickPool } from "../src/claim.js";
import { CLAIM_TTL_MS, pendingCleared, planRecycle, releaseClaim, recycleDue } from "../src/recycle.js";
import type { Sql } from "../src/schema.js";

const pool = getAddress("0x00000000000000000000000000000000000000aa");
const user = getAddress("0x00000000000000000000000000000000000000bb");
const zero = "0x0000000000000000000000000000000000000000";
const proxy = getAddress("0x00000000000000000000000000000000000000cc");

describe("claim recycling", () => {
  it("clears an unaccepted claim after 10 minutes and keeps an accepted one", () => {
    const steps = planRecycle(
      [
        { proxy, claimedAt: 0, owner: pool, pending: user, poolOwner: pool },
        { proxy: user, claimedAt: 0, owner: user, pending: zero, poolOwner: pool },
      ],
      CLAIM_TTL_MS,
    );
    expect(steps).toEqual([
      { proxy, action: "clear" },
      { proxy: user, action: "keep" },
    ]);
    expect(pendingCleared(user)).toBe(false);
    expect(pendingCleared(zero)).toBe(true);
    expect(recycleDue(null, 1)).toBe(true);
    expect(recycleDue(0, 59_000)).toBe(false);
    expect(recycleDue(0, 60_000)).toBe(true);
  });

  it("returns the position to available so it can be claimed again", () => {
    const store = {
      status: "claimed",
      claims: 1,
    };
    const sql: Sql = {
      exec(query: string) {
        if (query.startsWith("UPDATE pool")) store.status = "available";
        if (query.startsWith("DELETE FROM claims")) store.claims = 0;
        return { toArray: () => [] };
      },
    };
    releaseClaim(sql, proxy);
    expect(store).toEqual({ status: "available", claims: 0 });
    const again = pickPool([
      {
        proxy,
        market: "BTC",
        perpId: "16",
        accountId: "1",
        side: "long",
        leverage: "1500",
        distanceE6: 30_000n,
      },
    ]);
    expect(again?.proxy).toBe(proxy);
  });
});
