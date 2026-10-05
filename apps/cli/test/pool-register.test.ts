import { describe, expect, it } from "vitest";
import { planEntries, poolLeverage } from "../src/commands/pool-register.js";

describe("pool register plan", () => {
  it("plans pool accounts and both twin legs", () => {
    const entries = planEntries(
      { accounts: [{ proxy: "0x00000000000000000000000000000000000000b1", market: "BTC", side: "short", perpId: "16" }] },
      {
        pairs: [
          {
            id: "sol-long",
            market: "SOL",
            side: "long",
            perpId: "48",
            leverageHdths: "1000",
            protected: { proxy: "0x00000000000000000000000000000000000000b2" },
            unprotected: { proxy: "0x00000000000000000000000000000000000000b3" },
          },
        ],
      },
    );
    expect(entries.map((entry) => entry.role)).toEqual(["pool", "twin-protected", "twin-unprotected"]);
    expect(entries[0]?.leverage).toBe(poolLeverage("BTC"));
    expect(entries[1]?.leverage).toBe("1000");
    expect(entries[2]?.pairId).toBe("sol-long");
    expect(poolLeverage("ETH")).toBe("1200");
  });
});
