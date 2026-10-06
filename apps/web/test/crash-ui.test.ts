import { describe, expect, it } from "vitest";
import { LOT_SCALE, MICRO } from "../../../packages/core/src/math/liquidation";
import { CRASH_LABEL, simulate } from "../../../packages/core/src/radar/crash";
import type { CompactPosition } from "../../../packages/core/src/radar/schema";
import { bucketHit, crashLine } from "../lib/crash-line";

function row(partial: { depositMicro: bigint; idleMicro: bigint; perpId?: number }): CompactPosition {
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

describe("crash slider", () => {
  const book = [
    row({ depositMicro: 10n * MICRO, idleMicro: 0n }),
    row({ depositMicro: 6n * MICRO, idleMicro: 6n * MICRO }),
    row({ depositMicro: 20n * MICRO, idleMicro: 50n * MICRO }),
  ];

  it("matches simulate for three shocks and shows the first-order label", () => {
    for (const shock of [-3, -7, 5]) {
      const shown = crashLine(book, 1, "BTC", shock);
      const direct = simulate(book, 1, shock);
      expect(shown.label).toBe(CRASH_LABEL);
      expect(shown.result.liquidated).toEqual(direct.liquidated);
      expect(shown.result.saved).toEqual(direct.saved);
      expect(shown.text).toContain("BTC:");
      expect(shown.text).toContain("liquidated");
    }
  });

  it("reprices 650 positions within 100 ms", () => {
    const positions = Array.from({ length: 650 }, () => row({ depositMicro: 8n * MICRO, idleMicro: MICRO }));
    crashLine(positions, 1, "BTC", -4);
    performance.mark("crash-start");
    crashLine(positions, 1, "BTC", -5);
    performance.mark("crash-end");
    const measure = performance.measure("crash-step", "crash-start", "crash-end");
    expect(measure.duration).toBeLessThanOrEqual(100);
  });

  it("highlights only the buckets the shock would cross", () => {
    expect(bucketHit(50, "long", -3)).toBe(true);
    expect(bucketHit(50, "short", -3)).toBe(false);
    expect(bucketHit(70, "short", 3)).toBe(true);
    expect(bucketHit(50, "long", 0)).toBe(false);
  });
});
