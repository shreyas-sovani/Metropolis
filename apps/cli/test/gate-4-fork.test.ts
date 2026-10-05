import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAINNET_ID, TESTNET_ID } from "@lifeline/core";
import { describe, expect, it } from "vitest";
import { assertForkUrl, contractLiqPNS, coverageGaps, matchPct, parseForkArgs } from "../src/fork-truth.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("fork truth", () => {
  it("rounds the docs example to the tick", () => {
    const liq = contractLiqPNS({
      positionType: 0,
      pricePNS: 100_000n,
      lotLNS: 1n,
      depositCNS: 10_000n * 1_000_000n,
      premiumPnlCNS: 0n,
      priceDecimals: 0,
      lotDecimals: 0,
      maintHdths: 2_500n,
    });
    expect(liq).toBe(94_000n);
    const short = contractLiqPNS({
      positionType: 1,
      pricePNS: 100_000n,
      lotLNS: 1n,
      depositCNS: 10_000n * 1_000_000n,
      premiumPnlCNS: 0n,
      priceDecimals: 0,
      lotDecimals: 0,
      maintHdths: 2_500n,
    });
    expect(short).toBe(106_000n);
  });

  it("rejects a public fork url", () => {
    expect(() => assertForkUrl("https://rpc.monad.xyz")).toThrow(/localhost/);
    expect(() => assertForkUrl("http://127.0.0.1:8545")).not.toThrow();
  });

  it("parses fork chain flags", () => {
    expect(parseForkArgs([])).toBeNull();
    expect(parseForkArgs(["--fork"])).toEqual([TESTNET_ID, MAINNET_ID]);
    expect(parseForkArgs(["--fork", "--chain", "143"])).toEqual([MAINNET_ID]);
    expect(parseForkArgs(["--fork", "--chain", "10143"])).toEqual([TESTNET_ID]);
  });

  it("rejects a historical gate:4 with extra args", () => {
    expect(() => parseForkArgs(["--chain"])).toThrow(/unknown/);
  });

  it("enforces the coverage bar only when a count is short", () => {
    expect(
      coverageGaps([
        { chainId: TESTNET_ID, positions: 200, markets: 4, shorts: 40, withPremium: 40, withResidue: 20, exact: 200 },
        { chainId: MAINNET_ID, positions: 400, markets: 4, shorts: 60, withPremium: 60, withResidue: 30, exact: 400 },
      ]),
    ).toEqual([]);
    expect(
      coverageGaps([
        { chainId: TESTNET_ID, positions: 10, markets: 1, shorts: 0, withPremium: 0, withResidue: 0, exact: 10 },
      ]).length,
    ).toBeGreaterThan(0);
  });

  it("reports an exact percentage", () => {
    expect(matchPct(152, 152)).toBe(100);
    expect(matchPct(1, 3)).toBe(33.3333);
  });

  it("does not load role keys", () => {
    const source = readFileSync(path.join(here, "../src/commands/gate-4-fork.ts"), "utf8");
    expect(source).not.toMatch(/loadRoles/);
    expect(source).not.toMatch(/services\.env/);
    expect(source).not.toMatch(/testnet-keys/);
    expect(source).not.toMatch(/privateKey/);
  });
});
