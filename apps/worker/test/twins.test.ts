import { describe, expect, it } from "vitest";
import { assembleTwinPairs } from "../src/twins.js";

describe("twin pairs", () => {
  it("groups protected and unprotected legs", () => {
    const pairs = assembleTwinPairs([
      { pairId: "pump-short", market: "PUMP", side: "short", perpId: "320", role: "twin-unprotected", proxy: "0x2", mandate: "none" },
      { pairId: "mon-long", market: "MON", side: "long", perpId: "64", role: "twin-protected", proxy: "0x1", mandate: "house" },
      { pairId: "mon-long", market: "MON", side: "long", perpId: "64", role: "twin-unprotected", proxy: "0x3", mandate: "none" },
      { pairId: "", market: "BTC", side: "long", perpId: "16", role: "pool", proxy: "0x4", mandate: "house" },
    ]);
    expect(pairs).toEqual([
      {
        id: "mon-long",
        market: "MON",
        side: "long",
        perpId: "64",
        protected: { proxy: "0x1", mandate: "house" },
        unprotected: { proxy: "0x3", mandate: "none" },
      },
      {
        id: "pump-short",
        market: "PUMP",
        side: "short",
        perpId: "320",
        protected: null,
        unprotected: { proxy: "0x2", mandate: "none" },
      },
    ]);
  });
});
