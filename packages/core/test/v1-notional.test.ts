import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeLiquidations, type MarketScale } from "../src/hypersync/analytics.js";
import type { PositionLiquidatedEvent } from "../src/hypersync/decode.js";

interface FixtureRow {
  blockNumber: number;
  perpId: string;
  positionType: number;
  markPricePNS: string;
  liqLotLNS: string;
  posDepositCNS: string;
  accAmountCNS: string;
  accBalanceCNS: string;
  priceDecimals: number;
  lotDecimals: number;
  symbol: string;
  side: "long" | "short";
}

const rows = JSON.parse(readFileSync(new URL("./fixtures/v1-liquidations.json", import.meta.url), "utf8")) as FixtureRow[];

function eventOf(row: FixtureRow): PositionLiquidatedEvent {
  return {
    blockNumber: row.blockNumber,
    perpId: BigInt(row.perpId),
    posAccountId: 0n,
    positionType: row.positionType,
    markPricePNS: BigInt(row.markPricePNS),
    liqPricePNS: 0n,
    liqLotLNS: BigInt(row.liqLotLNS),
    posLotLNS: 0n,
    deltaPnlCNS: 0n,
    fundingCNS: 0n,
    posAmountCNS: 0n,
    posDepositCNS: BigInt(row.posDepositCNS),
    accAmountCNS: BigInt(row.accAmountCNS),
    accBalanceCNS: BigInt(row.accBalanceCNS),
    onOrderBook: false,
  };
}

describe("real mainnet liquidation notionals", () => {
  it("matches mark × lot in micro-dollars for five live events", () => {
    expect(rows).toHaveLength(5);
    const scales = new Map<string, MarketScale>();
    for (const row of rows) {
      scales.set(row.perpId, { priceDecimals: row.priceDecimals, lotDecimals: row.lotDecimals, symbol: row.symbol });
    }
    const history = summarizeLiquidations(rows.map(eventOf), scales);
    expect(history.rows.every((row) => !row.scaleMissing)).toBe(true);
    for (const row of history.rows) {
      const source = rows.find((item) => item.blockNumber === row.blockNumber && item.liqLotLNS === row.liqLotLNS);
      expect(source).toBeTruthy();
      const expected =
        (BigInt(source?.markPricePNS ?? "0") * BigInt(source?.liqLotLNS ?? "0") * 1_000_000n) /
        10n ** BigInt((source?.priceDecimals ?? 0) + (source?.lotDecimals ?? 0));
      expect(BigInt(row.notionalMicro)).toBe(expected);
      expect(row.symbol).toBe(source?.symbol);
      expect(row.side).toBe(source?.side);
    }
  });
});