import { describe, expect, it } from "vitest";
import { forfeitCNS, penaltyTotals, reconstructResidual, type LiqSplit } from "../src/radar/penalty.js";
import { judgeSave } from "../src/radar/saves.js";

const split: LiqSplit = { userPer100K: 80_000n, insPer100K: 10_000n, protocolPer100K: 10_000n };

/** Five mainnet PositionLiquidated credits read on 2026-10-06, perp 10. */
const LIVE = [
  { block: 110947217, acc: 68729360n },
  { block: 110954073, acc: 18041n },
  { block: 110954073, acc: 1780712n },
  { block: 110981838, acc: 133501991n },
  { block: 110994159, acc: 63602800n },
];

describe("liquidation split", () => {
  it("reconstructs the five live credits within 1 CNS", () => {
    let paid = 0n;
    for (const event of LIVE) {
      const result = reconstructResidual(event.acc, split);
      expect(result.ok).toBe(true);
      paid += result.insurance + result.protocol;
    }
    const totals = penaltyTotals({
      events: LIVE.map((event) => ({ accAmountCNS: event.acc, eligible: true })),
      split,
      atRiskDepositsCNS: [1_000_000n],
    });
    expect(totals.paidCNS).toBe(paid);
    expect(totals.avoidableCNS).toBe(paid);
    expect(totals.atStakeCNS).toBe(forfeitCNS(1_000_000n, split));
    expect(forfeitCNS(1_000_000n, split)).toBe(200_000n);
  });
});

describe("saves", () => {
  it("records a save, no save, and a liquidation", () => {
    expect(
      judgeSave({ side: "long", preLiq: 100n, marks: [{ block: 2, mark: 101n }, { block: 3, mark: 99n }] }),
    ).toEqual({ outcome: "save", block: 3 });
    expect(judgeSave({ side: "short", preLiq: 100n, marks: [{ block: 2, mark: 90n }] })).toEqual({
      outcome: "none",
      block: null,
    });
    expect(
      judgeSave({
        side: "long",
        preLiq: 100n,
        marks: [{ block: 4, mark: 90n }],
        liquidatedAt: 4,
      }),
    ).toEqual({ outcome: "liquidated", block: 4 });
  });
});
