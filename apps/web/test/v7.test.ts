import { describe, expect, it } from "vitest";
import { insideLineCopy, linesFromSafety, outsideLineCopy, safetyCopy, stepStates } from "../lib/protection";

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
});
