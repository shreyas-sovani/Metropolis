import { describe, expect, it } from "vitest";
import { entriesMatch, twinLeverage } from "../src/commands/twins-create.js";

describe("twins", () => {
  it("caps SOL at 10x and keeps a lower initial margin", () => {
    expect(twinLeverage(1000n, 1500n)).toBe(1000n);
    expect(twinLeverage(1000n, 800n)).toBe(800n);
    expect(twinLeverage(1500n, 2000n)).toBe(1500n);
  });

  it("matches entries within 0.1%", () => {
    expect(entriesMatch(860_000n, 860_500n)).toBe(true);
    expect(entriesMatch(860_000n, 870_000n)).toBe(false);
    expect(entriesMatch(0n, 1n)).toBe(false);
  });
});
