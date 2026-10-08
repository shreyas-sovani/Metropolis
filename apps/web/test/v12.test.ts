import { SKIP_REASONS } from "@lifeline/core";
import { describe, expect, it } from "vitest";
import { forbiddenHit } from "../lib/forbidden";
import { formatAusd, formatBlock, formatPctOne, formatUsd, formatUsdCompact, timeAgo } from "../lib/format";
import { MESSAGE_CODES, userMessage } from "../lib/messages";

describe("V12 copy and numbers", () => {
  it("gives every evaluate reason a plain-language row", () => {
    for (const reason of SKIP_REASONS) {
      expect(MESSAGE_CODES).toContain(reason);
      const message = userMessage(reason, { distancePct: "3.2%", actBelowPct: "4.5%" });
      expect(message.title.length).toBeGreaterThan(0);
      expect(message.sentence.length).toBeGreaterThan(0);
      expect(forbiddenHit(`${message.title} ${message.sentence}`)).toBeNull();
    }
  });

  it("formats dollars, AUSD, percents, blocks, and relative time in one place", () => {
    expect(formatUsd("3150000000000")).toBe("$3,150,000");
    expect(formatUsdCompact("3150000000000")).toBe("$3.15M");
    expect(formatUsdCompact("274500000000")).toBe("$274.5k");
    expect(formatAusd("152400000")).toBe("152.4");
    expect(formatAusd("152000000")).toBe("152");
    expect(formatPctOne(4.5)).toBe("4.5%");
    expect(formatBlock(68909759)).toBe("block 68,909,759");
    expect(timeAgo(1_000, 13_000)).toBe("12 s ago");
    expect(timeAgo(0, 180_000)).toBe("3 min ago");
  });
});
