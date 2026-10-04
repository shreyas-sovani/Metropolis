import { describe, expect, it } from "vitest";
import {
  AUSD_UNIT,
  MON_TARGETS,
  SPONSOR_FLOOR,
  WEI,
  floorBreaches,
  planMonSends,
  targetShortfalls,
  type Holdings,
  type MonRole,
  type Role,
} from "../src/funding.js";

function monBalances(partial: Partial<Record<MonRole, bigint>>): Record<MonRole, bigint> {
  return {
    OPERATOR: partial.OPERATOR ?? 0n,
    POOL_OWNER: partial.POOL_OWNER ?? 0n,
    MAKER: partial.MAKER ?? 0n,
    CALIBRATION: partial.CALIBRATION ?? 0n,
    TEST_OWNER: partial.TEST_OWNER ?? 0n,
  };
}

function holdings(mon: Partial<Record<Role, bigint>>, ausd: Partial<Record<Role, bigint>> = {}): Holdings {
  const zero = {
    SPONSOR: 0n,
    OPERATOR: 0n,
    POOL_OWNER: 0n,
    MAKER: 0n,
    CALIBRATION: 0n,
    TEST_OWNER: 0n,
  };
  return { mon: { ...zero, ...mon }, ausd: { ...zero, ...ausd } };
}

describe("planMonSends", () => {
  it("fills every target when the sponsor can stay at its floor", () => {
    const sends = planMonSends({
      sponsor: 20n * WEI,
      balances: monBalances({}),
      gasCost: 0n,
    });
    expect(sends.map((send) => send.role)).toEqual([
      "OPERATOR",
      "POOL_OWNER",
      "MAKER",
      "CALIBRATION",
      "TEST_OWNER",
    ]);
    expect(sends.reduce((sum, send) => sum + send.amount, 0n)).toBe(
      5n * WEI + 2n * WEI + WEI / 2n + WEI / 5n + WEI / 5n,
    );
  });

  it("stops before the sponsor floor", () => {
    const sends = planMonSends({
      sponsor: 10n * WEI,
      balances: monBalances({}),
      gasCost: 0n,
    });
    const spent = sends.reduce((sum, send) => sum + send.amount, 0n);
    expect(spent).toBeLessThanOrEqual(10n * WEI - SPONSOR_FLOOR);
    expect(sends[0]).toEqual({ role: "OPERATOR", amount: MON_TARGETS.OPERATOR });
    expect(sends.some((send) => send.role === "MAKER")).toBe(false);
  });

  it("skips a role already at target", () => {
    const sends = planMonSends({
      sponsor: 20n * WEI,
      balances: monBalances({ OPERATOR: MON_TARGETS.OPERATOR }),
      gasCost: 0n,
    });
    expect(sends[0]?.role).toBe("POOL_OWNER");
  });
});

describe("status lines", () => {
  it("prints LOW under a floor and SHORT under a target", () => {
    const state = holdings(
      { SPONSOR: 10n * WEI, OPERATOR: WEI / 2n, MAKER: WEI },
      { MAKER: 1_000n * AUSD_UNIT },
    );
    expect(floorBreaches(state).some((line) => line.startsWith("LOW: OPERATOR MON"))).toBe(true);
    expect(floorBreaches(state).some((line) => line.startsWith("LOW: MAKER AUSD"))).toBe(true);
    expect(targetShortfalls(state).some((line) => line.startsWith("SHORT: POOL_OWNER"))).toBe(true);
  });
});
