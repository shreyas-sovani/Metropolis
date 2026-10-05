import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { liquidationPricePNS } from "../src/math/liquidation.js";

interface FixturePosition {
  positionType: number;
  pricePNS: string;
  priceResiduePNSQ16: string;
  lotLNS: string;
  depositCNS: string;
  premiumPnlCNS: string;
  priceDecimals: number;
  lotDecimals: number;
  maintHdths: string;
  liqPricePNS: string;
}

interface Fixture {
  chainId: number;
  positions: FixturePosition[];
}

const here = path.dirname(fileURLToPath(import.meta.url));

describe("contract liquidation fixtures", () => {
  it("matches both fork fixtures to the tick", () => {
    let positions = 0;
    for (const chainId of [10143, 143]) {
      const fixture = JSON.parse(
        readFileSync(path.join(here, "fixtures", `g4-truth-${chainId}.json`), "utf8"),
      ) as Fixture;
      expect(fixture.chainId).toBe(chainId);
      expect(fixture.positions.length).toBeGreaterThan(0);
      for (const row of fixture.positions) {
        const liq = liquidationPricePNS(
          {
            positionType: row.positionType,
            pricePNS: BigInt(row.pricePNS),
            lotLNS: BigInt(row.lotLNS),
            depositCNS: BigInt(row.depositCNS),
            premiumPnlCNS: BigInt(row.premiumPnlCNS),
          },
          {
            priceDecimals: row.priceDecimals,
            lotDecimals: row.lotDecimals,
            maintHdths: BigInt(row.maintHdths),
          },
        );
        expect(liq).toBe(BigInt(row.liqPricePNS));
        positions += 1;
      }
    }
    expect(positions).toBeGreaterThanOrEqual(600);
  });
});
