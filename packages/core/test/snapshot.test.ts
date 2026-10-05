import { describe, expect, it } from "vitest";
import { LOT_SCALE, MICRO } from "../src/math/liquidation.js";
import { assembleSnapshot, type DraftMarket } from "../src/radar/snapshot.js";

const SALT = `0x${"ab".repeat(32)}` as const;

function market(perpId: number, accountId: bigint, depositMicro: bigint): DraftMarket {
  return {
    info: {
      perpId,
      name: "Bitcoin",
      symbol: perpId === 1 ? "BTC" : "ETH",
      priceDecimals: 0,
      lotDecimals: 0,
      markPNS: 100n * MICRO,
      longOpenInterestLNS: 1n,
      shortOpenInterestLNS: 0n,
      status: 0,
    },
    positions: [
      {
        accountId,
        accountAddr: "0x1111111111111111111111111111111111111111",
        side: 1,
        positionType: 0,
        entryMicro: 100n * MICRO,
        lot: LOT_SCALE,
        depositMicro,
        fundingMicro: 0n,
        mmf: 25n,
        markMicro: 100n * MICRO,
        notionalMicro: 100n * MICRO,
        idleMicro: 40n * MICRO,
        pricePNS: 100n,
        lotLNS: 1n,
        priceDecimals: 0,
        lotDecimals: 0,
        maintHdths: 2_500n,
        markPNS: 100n,
      },
    ],
  };
}

describe("radar snapshot", () => {
  it("sums headline totals and hides account ids", () => {
    const snapshot = assembleSnapshot({
      chainId: 143,
      blockNumber: 12n,
      salt: SALT,
      markets: [market(1, 424242424242n, 6n * MICRO), market(2, 424242424243n, 20n * MICRO)],
    });
    expect(BigInt(snapshot.headline.openInterestMicro)).toBe(
      snapshot.markets.reduce((sum, row) => sum + BigInt(row.openInterestMicro), 0n),
    );
    expect(snapshot.headline.positionCount).toBe(
      snapshot.markets.reduce((sum, row) => sum + row.positionCount, 0),
    );
    expect(snapshot.headline.atRiskCount).toBe(snapshot.markets.reduce((sum, row) => sum + row.atRiskCount, 0));
    expect(BigInt(snapshot.headline.idleMicro)).toBe(
      snapshot.markets.reduce((sum, row) => sum + BigInt(row.idleMicro), 0n),
    );
    const json = JSON.stringify(snapshot);
    expect(json).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(json).not.toContain("424242424242");
    expect(json).not.toContain("424242424243");
    expect(snapshot.markets[0]?.atRisk[0]?.id).toMatch(/^[0-9a-f]{8}$/);
    expect(snapshot.positions).toHaveLength(2);
  });
});
