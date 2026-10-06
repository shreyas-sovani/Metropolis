import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { claimGate, pickPool, type PoolCandidate } from "../src/claim.js";

const btc = (distanceE6: bigint, proxy: string): PoolCandidate => ({
  proxy: getAddress(proxy),
  market: "BTC",
  perpId: "16",
  accountId: "1",
  side: "long",
  leverage: "1500",
  distanceE6,
});

describe("claim selection", () => {
  it("prefers the closest BTC position that is still above the house trigger", () => {
    const picked = pickPool([
      btc(10_000n, "0x00000000000000000000000000000000000000a1"),
      btc(40_000n, "0x00000000000000000000000000000000000000a2"),
      btc(20_000n, "0x00000000000000000000000000000000000000a3"),
      { ...btc(16_000n, "0x00000000000000000000000000000000000000a4"), market: "ETH" },
    ]);
    expect(picked?.proxy).toBe(getAddress("0x00000000000000000000000000000000000000a3"));
  });

  it("picks the demo band before a closer position under the house target", () => {
    const picked = pickPool([
      btc(20_000n, "0x00000000000000000000000000000000000000a1"),
      btc(32_000n, "0x00000000000000000000000000000000000000a2"),
      { ...btc(30_000n, "0x00000000000000000000000000000000000000a4"), market: "ETH" },
    ]);
    expect(picked?.proxy).toBe(getAddress("0x00000000000000000000000000000000000000a2"));
  });

  it("uses a non-BTC position in the demo band before a BTC position outside it", () => {
    const picked = pickPool([
      btc(20_000n, "0x00000000000000000000000000000000000000a1"),
      { ...btc(30_000n, "0x00000000000000000000000000000000000000a4"), market: "ETH" },
    ]);
    expect(picked?.market).toBe("ETH");
  });

  it("offers a reserve position only when nothing closer is free", () => {
    const reserved = btc(70_000n, "0x00000000000000000000000000000000000000b1");
    reserved.reserve = true;
    const closer = btc(20_000n, "0x00000000000000000000000000000000000000b2");
    expect(pickPool([reserved, closer])?.proxy).toBe(closer.proxy);
    expect(pickPool([reserved])?.proxy).toBe(reserved.proxy);
  });

  it("uses another market only when no BTC position is above the trigger", () => {
    const picked = pickPool([
      btc(10_000n, "0x00000000000000000000000000000000000000a1"),
      { ...btc(18_000n, "0x00000000000000000000000000000000000000a4"), market: "ETH" },
    ]);
    expect(picked?.market).toBe("ETH");
  });

  it("rejects a repeat user, a fourth IP claim, and an empty pool", () => {
    expect(claimGate({ existingUser: true, ipCount: 0, available: 3 }).ok).toBe(false);
    expect(claimGate({ existingUser: true, ipCount: 0, available: 3 })).toMatchObject({ status: 409 });
    expect(claimGate({ existingUser: false, ipCount: 3, available: 3 })).toMatchObject({ status: 429 });
    expect(claimGate({ existingUser: false, ipCount: 0, available: 0 })).toEqual({
      ok: false,
      status: 503,
      body: { error: "empty", sandbox: true },
    });
    expect(claimGate({ existingUser: false, ipCount: 2, available: 1 })).toEqual({ ok: true });
  });
});
