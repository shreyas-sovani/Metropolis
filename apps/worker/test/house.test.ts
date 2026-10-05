import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mandateDomain, mandateTypes, recoverSigner } from "@lifeline/core";
import {
  HOUSE_BUDGET_CNS,
  HOUSE_EXPIRY_SEC,
  HOUSE_MAX_PER_ACTION_CNS,
  breachTerms,
  houseMandate,
  parseRegistrations,
} from "../src/house.js";

const KEY = `0x${"44".repeat(32)}` as const;
const NOW = 1_700_000_000n;
const PROXY = getAddress("0x00000000000000000000000000000000000000aa");

describe("house mandates", () => {
  it("signs 1.5/2.5 for a pool account and 4/6 for a protected twin", async () => {
    const account = privateKeyToAccount(KEY);
    const pool = houseMandate({ account: PROXY, perpId: 16n, role: "pool", nowSec: NOW });
    const twin = houseMandate({ account: PROXY, perpId: 48n, role: "twin-protected", nowSec: NOW });
    expect(houseMandate({ account: PROXY, perpId: 16n, role: "twin-unprotected", nowSec: NOW })).toBeNull();
    if (!pool || !twin) throw new Error("missing mandate");
    expect(pool.triggerBps).toBe(150);
    expect(pool.targetBps).toBe(250);
    expect(twin.triggerBps).toBe(400);
    expect(twin.targetBps).toBe(600);
    expect(pool.maxPerActionCNS).toBe(HOUSE_MAX_PER_ACTION_CNS);
    expect(pool.budgetCNS).toBe(HOUSE_BUDGET_CNS);
    expect(twin.budgetCNS).toBe(300_000_000n);
    expect(pool.expiry).toBe(NOW + HOUSE_EXPIRY_SEC);
    expect(pool.nonce).toBe(0n);
    const signature = await account.signTypedData({
      domain: mandateDomain(),
      types: mandateTypes,
      primaryType: "Mandate",
      message: pool,
    });
    expect(await recoverSigner(pool, signature)).toBe(account.address);
  });

  it("places a breach trigger above the current distance", () => {
    expect(breachTerms(27_000n)).toEqual({ triggerBps: 320, targetBps: 520 });
  });

  it("rejects a registration entry with a bad proxy", () => {
    expect(() =>
      parseRegistrations({
        entries: [{ proxy: "nope", accountId: "1", perpId: "16", side: "long", leverage: "1500", market: "BTC", role: "pool" }],
      }),
    ).toThrow(/proxy/);
  });
});
