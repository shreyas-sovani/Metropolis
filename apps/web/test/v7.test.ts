import { describe, expect, it } from "vitest";
import { clampLines, expiryFromDays, insideLineCopy, linesFromSafety, outsideLineCopy, previewTopUp, safetyCopy, stepStates } from "../lib/protection";

describe("protection copy", () => {
  it("uses the safety-line templates", () => {
    expect(safetyCopy("3.2%", "6.5%", "4.5%")).toBe(
      "Your position is 3.2% from liquidation. Lifeline recommends a safety line of 6.5% and will step in below 4.5%.",
    );
    expect(insideLineCopy()).toBe("That's inside your line, so Lifeline will add margin right after you sign.");
    expect(outsideLineCopy()).toBe("That's above your line, so Lifeline will wait and act if the price moves against you.");
    expect(linesFromSafety(6.5)).toEqual({ targetBps: 650, triggerBps: 450 });
  });

  it("marks the practice-account step current before a claim", () => {
    expect(stepStates("idle")[0]).toBe("current");
    expect(stepStates("protected").every((state) => state === "done")).toBe(true);
  });

  it("clamps the safety line to the mandate limits", () => {
    expect(clampLines(6.5, 4.5)).toEqual({ targetBps: 650, triggerBps: 450, safetyPct: 6.5, actBelowPct: 4.5 });
    expect(clampLines(25, 24).targetBps).toBe(2000);
    expect(clampLines(6, 9).triggerBps).toBeLessThan(clampLines(6, 9).targetBps);
    expect(expiryFromDays("90", 1_000)).toBe(BigInt(1_000 + 30 * 24 * 60 * 60));
  });

  it("estimates the top-up from the position", () => {
    const sentence = previewTopUp(
      {
        side: "long",
        entryMicro: "80000000000",
        markMicro: "80000000000",
        lot: "1000000000000000000",
        fundingMicro: "0",
        mmf: "25",
        depositMicro: "200000000",
        liquidation: "83000000000",
        priceDecimals: 0,
      },
      "3.2%",
      650,
    );
    expect(sentence).toBe(
      "Today 3.2%. Lifeline would add about 8,200 AUSD now and move your liquidation price from $83,000 to about $74,800.",
    );
  });
});
