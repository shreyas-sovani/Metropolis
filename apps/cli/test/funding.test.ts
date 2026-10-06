import { describe, expect, it } from "vitest";
import {
  AUSD_TARGETS,
  AUSD_UNIT,
  MON_TARGETS,
  SPONSOR_FLOOR,
  WEI,
  budgetLine,
  floorBreaches,
  judgingMonBudget,
  nextFaucetRole,
  parseFloorSpec,
  planMonSends,
  remainingMonSends,
  targetShortfalls,
  type AusdRole,
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

describe("resume", () => {
  it("does not send the in-flight top-up again", () => {
    const balances = monBalances({ OPERATOR: 4n * WEI });
    const first = planMonSends({ sponsor: 20n * WEI, balances, gasCost: 0n });
    expect(first[0]).toEqual({ role: "OPERATOR", amount: WEI });
    const second = remainingMonSends({
      sponsor: 20n * WEI,
      balances,
      gasCost: 0n,
      inFlight: { role: "OPERATOR", amount: WEI },
    });
    expect(second.some((send) => send.role === "OPERATOR")).toBe(false);
    const after = monBalances({ ...balances, OPERATOR: 5n * WEI });
    const third = planMonSends({ sponsor: 19n * WEI, balances: after, gasCost: 0n });
    expect(third.some((send) => send.role === "OPERATOR")).toBe(false);
    const spent = (first[0]?.amount ?? 0n) + third.filter((send) => send.role === "OPERATOR").reduce((sum, send) => sum + send.amount, 0n);
    expect(spent).toBe(WEI);
  });

  it("holds the next faucet drip while one is in flight", () => {
    const balances = {
      POOL_OWNER: 0n,
      MAKER: 0n,
      CALIBRATION: 0n,
      TEST_OWNER: 0n,
    } satisfies Record<AusdRole, bigint>;
    expect(nextFaucetRole(balances, null)).toBe("POOL_OWNER");
    expect(nextFaucetRole(balances, "POOL_OWNER")).toBeNull();
    balances.POOL_OWNER = AUSD_TARGETS.POOL_OWNER;
    expect(nextFaucetRole(balances, null)).toBe("MAKER");
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

  it("prices the judging budget at 31.14 MON", () => {
    expect(judgingMonBudget()).toBe(31_140_000_000_000_000_000n);
    expect(budgetLine(judgingMonBudget())).toBe("budget ok need=31.1400 sponsor=31.1400");
    expect(budgetLine(31n * WEI)).toBe("budget short need=31.1400 sponsor=31.0000 shortfall=0.1400");
  });

  it("exits non-zero when a temporary floor is above the balance", () => {
    const state = holdings({ SPONSOR: 12n * WEI, OPERATOR: 5n * WEI, POOL_OWNER: 2n * WEI, MAKER: WEI });
    const override = parseFloorSpec("SPONSOR:MON:1000000");
    const lines = floorBreaches(state, [override]);
    expect(lines.some((line) => line.startsWith("LOW: SPONSOR MON"))).toBe(true);
    expect(lines.length > 0).toBe(true);
  });
});
