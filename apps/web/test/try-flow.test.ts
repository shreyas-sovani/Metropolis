import { armDefaults } from "@lifeline/core";
import { describe, expect, it } from "vitest";
import { ONE_LINER, TRADEOFF } from "../lib/copy";
import { outcomeBadge, txUrl } from "../lib/twins-view";
import { radarUrls } from "../lib/radar-urls";
import {
  budgetFromFree,
  ownerTxsBeforeReceipt,
  positionCard,
  receiptLine,
  sandboxProxy,
  termsFor,
  useSandbox,
} from "../lib/try-flow";

describe("try lifeline copy", () => {
  it("builds the position card and the live arm defaults", () => {
    expect(
      positionCard({ market: "BTC", side: "long", leverage: "1500", distanceE6: "27000", freeCNS: "300000000" }),
    ).toBe("Your 15× BTC long · 2.7% from liquidation · 300 AUSD idle");
    expect(termsFor(27_000n, false)).toEqual(armDefaults(27_000n));
    expect(termsFor(27_000n, false).triggerBps).toBe(400);
    expect(budgetFromFree(300_000_000n)).toBe(150_000_000n);
    expect(ownerTxsBeforeReceipt(true)).toBe(1);
    expect(TRADEOFF).toContain("idle AUSD");
    expect(ONE_LINER).toContain("idle next to them");
  });

  it("opens sandbox when Privy fails or the pool is empty", () => {
    expect(useSandbox({ privyFailed: true })).toBe(true);
    expect(useSandbox({ privyFailed: false, status: 503, sandbox: true })).toBe(true);
    expect(useSandbox({ privyFailed: false, status: 409, sandbox: false })).toBe(false);
    expect(sandboxProxy([{ protected: { proxy: "0xabc", mandate: "house" } }])).toBe("0xabc");
  });

  it("formats the receipt", () => {
    expect(receiptLine({ distBefore: "27000", distAfter: "60000", block: 12, msFromRequest: 40 })).toBe(
      "Distance 2.7% → 6.0%. Block 12. 40 ms.",
    );
  });
});

describe("twins", () => {
  it("names the outcome and links the action", () => {
    expect(outcomeBadge("unprotected", "liquidated at block 9")).toBe("Unprotected twin liquidated at block 9");
    expect(outcomeBadge("protected", "crossed liq at block 4")).toBe("Crossed its liquidation price at block 4");
    expect(outcomeBadge("protected", "alive")).toBe("Alive");
    expect(txUrl("0xabc")).toBe("https://testnet.monadexplorer.com/tx/0xabc");
  });
});

describe("radar fallback", () => {
  it("puts a dead primary in front of the public URLs", () => {
    const urls = radarUrls(143, true);
    expect(urls?.[0]).toBe("http://127.0.0.1:9");
    expect(urls?.includes("https://rpc.monad.xyz")).toBe(true);
    expect(radarUrls(143, false)).toBeUndefined();
  });
});
