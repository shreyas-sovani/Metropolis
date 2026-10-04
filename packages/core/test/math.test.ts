import { describe, expect, it } from "vitest";
import { replayPosition } from "../src/math/replay.js";
import {
  MICRO,
  bucketIndex,
  couldProtectNow,
  distanceE6,
  isAtRisk,
  isDust,
  liquidationPriceMicro,
  lotFromNotional,
  maintenanceMargin,
  sizeTopUp,
} from "../src/math/index.js";

const sideLong = 1n as const;
const sideShort = -1n as const;

function dollars(micro: bigint): number {
  return Number(micro) / Number(MICRO);
}

function demoPosition(depositDollars = 100n) {
  const entryMicro = 85_260n * MICRO;
  const lot = lotFromNotional(entryMicro, 1_500n * MICRO);
  return {
    side: sideLong,
    entryMicro,
    lot,
    depositMicro: depositDollars * MICRO,
    fundingMicro: 0n,
    mmf: 25n,
    markMicro: entryMicro,
  };
}

describe("liquidation math", () => {
  it("matches the docs example exactly", () => {
    const entryMicro = 100_000n * MICRO;
    const lot = lotFromNotional(entryMicro, entryMicro);
    expect(maintenanceMargin(100_000n * MICRO, 25n)).toBe(4_000n * MICRO);
    const liq = liquidationPriceMicro({
      side: sideLong,
      entryMicro,
      lot,
      depositMicro: 10_000n * MICRO,
      fundingMicro: 0n,
      mmf: 25n,
    });
    expect(liq).toBe(94_000n * MICRO);
  });

  it("matches the PRD demo within a dollar and half an AUSD", () => {
    const position = demoPosition();
    const liq = liquidationPriceMicro(position);
    expect(Math.abs(dollars(liq) - 82_986)).toBeLessThanOrEqual(1);
    const distance = distanceE6(sideLong, position.markMicro, liq);
    expect(Math.abs(Number(distance) / 10_000 - 2.67)).toBeLessThan(0.02);
    const add = sizeTopUp({
      ...position,
      triggerBps: 400n,
      targetBps: 600n,
      maxPerActionMicro: 150n * MICRO,
      freeBalanceMicro: 300n * MICRO,
      budgetLeftMicro: 300n * MICRO,
      lastActionBlock: null,
      currentBlock: 10n,
    });
    expect(Math.abs(dollars(add) - 50)).toBeLessThanOrEqual(0.5);
    const after = liquidationPriceMicro({ ...position, depositMicro: position.depositMicro + add });
    expect(Math.abs(dollars(after) - 80_144)).toBeLessThanOrEqual(1);
  });

  it("mirrors a short around the entry", () => {
    const entryMicro = 100_000n * MICRO;
    const shared = {
      entryMicro,
      lot: lotFromNotional(entryMicro, entryMicro),
      depositMicro: 10_000n * MICRO,
      fundingMicro: 0n,
      mmf: 25n,
    };
    const longLiq = liquidationPriceMicro({ ...shared, side: sideLong });
    const shortLiq = liquidationPriceMicro({ ...shared, side: sideShort });
    expect(longLiq + shortLiq).toBe(2n * entryMicro);
    expect(distanceE6(sideLong, entryMicro, longLiq)).toBe(
      distanceE6(sideShort, entryMicro, shortLiq),
    );
  });

  it("lets each cap bind on its own", () => {
    const base = {
      ...demoPosition(),
      triggerBps: 400n,
      targetBps: 600n,
      lastActionBlock: null,
      currentBlock: 10n,
    };
    expect(
      sizeTopUp({
        ...base,
        maxPerActionMicro: 10n * MICRO,
        freeBalanceMicro: 300n * MICRO,
        budgetLeftMicro: 300n * MICRO,
      }),
    ).toBe(10n * MICRO);
    expect(
      sizeTopUp({
        ...base,
        maxPerActionMicro: 150n * MICRO,
        freeBalanceMicro: 7n * MICRO,
        budgetLeftMicro: 300n * MICRO,
      }),
    ).toBe(7n * MICRO);
    expect(
      sizeTopUp({
        ...base,
        maxPerActionMicro: 150n * MICRO,
        freeBalanceMicro: 300n * MICRO,
        budgetLeftMicro: 12n * MICRO,
      }),
    ).toBe(12n * MICRO);
  });

  it("skips when distance is safe, the add is under 5 AUSD, or the cooldown is open", () => {
    const safe = {
      side: sideLong,
      entryMicro: 100_000n * MICRO,
      lot: lotFromNotional(100_000n * MICRO, 100_000n * MICRO),
      depositMicro: 20_000n * MICRO,
      fundingMicro: 0n,
      mmf: 25n,
      markMicro: 100_000n * MICRO,
      triggerBps: 400n,
      targetBps: 600n,
      maxPerActionMicro: 150n * MICRO,
      freeBalanceMicro: 300n * MICRO,
      budgetLeftMicro: 300n * MICRO,
      lastActionBlock: null,
      currentBlock: 10n,
    };
    expect(sizeTopUp(safe)).toBe(0n);
    const tiny = sizeTopUp({
      ...demoPosition(146n),
      triggerBps: 400n,
      targetBps: 600n,
      maxPerActionMicro: 150n * MICRO,
      freeBalanceMicro: 300n * MICRO,
      budgetLeftMicro: 300n * MICRO,
      lastActionBlock: null,
      currentBlock: 10n,
    });
    expect(tiny).toBe(0n);
    expect(
      sizeTopUp({
        ...demoPosition(),
        triggerBps: 400n,
        targetBps: 600n,
        maxPerActionMicro: 150n * MICRO,
        freeBalanceMicro: 300n * MICRO,
        budgetLeftMicro: 300n * MICRO,
        lastActionBlock: 8n,
        currentBlock: 10n,
      }),
    ).toBe(0n);
  });

  it("filters dust, flags at-risk positions, buckets offsets, and checks idle balance", () => {
    const entry = 100n * MICRO;
    expect(isDust(entry, lotFromNotional(entry, 9n * MICRO))).toBe(true);
    expect(isDust(entry, lotFromNotional(entry, 10n * MICRO))).toBe(false);
    expect(isAtRisk(49_999n)).toBe(true);
    expect(isAtRisk(50_000n)).toBe(false);
    expect(bucketIndex(-150_000n)).toBe(0);
    expect(bucketIndex(0n)).toBe(60);
    expect(bucketIndex(150_000n)).toBe(120);
    expect(bucketIndex(-150_001n)).toBeNull();
    const position = demoPosition();
    expect(couldProtectNow({ ...position, idleMicro: 50n * MICRO })).toBe(true);
    expect(couldProtectNow({ ...position, idleMicro: 1n * MICRO })).toBe(false);
    expect(couldProtectNow({ ...position, entryMicro: 100n * MICRO, lot: lotFromNotional(100n * MICRO, 9n * MICRO), idleMicro: 1_000n * MICRO })).toBe(false);
  });

  it("blends entry price across an increase and keeps the latest deposit", () => {
    const replayed = replayPosition(
      [
        { kind: "open", block: 1, index: 0, positionType: 0, pricePNS: 100n, lotLNS: 10n, depositCNS: 50n },
        { kind: "increase", block: 2, index: 0, pricePNS: 200n, startLotLNS: 10n, endLotLNS: 20n, endDepositCNS: 80n },
        { kind: "collateral", block: 3, index: 1, depositCNS: 90n },
      ],
      4,
    );
    expect(replayed).toEqual({ side: 1n, entryPNS: 150n, lotLNS: 20n, depositCNS: 90n });
  });
});
