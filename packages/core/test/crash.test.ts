import { describe, expect, it } from "vitest";
import { LOT_SCALE, MICRO } from "../src/math/liquidation.js";
import { CRASH_LABEL, simulate } from "../src/radar/crash.js";
import type { CompactPosition } from "../src/radar/schema.js";

function row(partial: {
  depositMicro: bigint;
  idleMicro: bigint;
  perpId?: number;
}): CompactPosition {
  return {
    perpId: partial.perpId ?? 1,
    side: 1,
    positionType: 0,
    entryMicro: (100n * MICRO).toString(),
    lot: LOT_SCALE.toString(),
    depositMicro: partial.depositMicro.toString(),
    fundingMicro: "0",
    mmf: "25",
    markMicro: (100n * MICRO).toString(),
    idleMicro: partial.idleMicro.toString(),
    notionalMicro: (100n * MICRO).toString(),
    pricePNS: "100",
    lotLNS: "1",
    priceDecimals: 0,
    lotDecimals: 0,
    maintHdths: "2500",
    markPNS: "100",
  };
}

describe("crash simulator", () => {
  const book = [
    row({ depositMicro: 10n * MICRO, idleMicro: 0n }),
    row({ depositMicro: 6n * MICRO, idleMicro: 6n * MICRO }),
    row({ depositMicro: 20n * MICRO, idleMicro: 50n * MICRO }),
    row({ depositMicro: 6n * MICRO, idleMicro: 6n * MICRO, perpId: 2 }),
  ];

  it("counts a hand-built book and liquidates nothing at 0%", () => {
    expect(simulate(book, 1, 0)).toEqual({
      label: CRASH_LABEL,
      shockPct: 0,
      liquidated: { count: 0, notionalMicro: 0n },
      saved: { count: 0, notionalMicro: 0n },
    });
    const mild = simulate(book, 1, -3);
    expect(mild.liquidated).toEqual({ count: 1, notionalMicro: 100n * MICRO });
    expect(mild.saved).toEqual({ count: 1, notionalMicro: 100n * MICRO });
    const hard = simulate(book, 1, -7);
    expect(hard.liquidated).toEqual({ count: 2, notionalMicro: 200n * MICRO });
    expect(hard.saved).toEqual({ count: 1, notionalMicro: 100n * MICRO });
    expect(hard.label).toBe("first-order: excludes cascade price impact");
  });

  it("never lets liquidated notional fall as the shock grows", () => {
    let previous = 0n;
    for (const shock of [-1, -3, -7, -10]) {
      const notional = simulate(book, 1, shock).liquidated.notionalMicro;
      expect(notional).toBeGreaterThanOrEqual(previous);
      previous = notional;
    }
  });

  it("reprices 1000 positions within 20 ms", () => {
    const positions = Array.from({ length: 1000 }, () => row({ depositMicro: 8n * MICRO, idleMicro: MICRO }));
    simulate(positions, 1, -5);
    const started = performance.now();
    simulate(positions, 1, -5);
    expect(performance.now() - started).toBeLessThanOrEqual(20);
  });
});
