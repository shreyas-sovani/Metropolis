import { describe, expect, it } from "vitest";
import { activityRows, daysLeft, heartbeatLine } from "../lib/activity";
import { formatMon } from "../lib/format";

describe("dashboard activity", () => {
  it("orders the claim, the signature, and the top-up newest first", () => {
    const rows = activityRows({
      claim: { claimedAt: 1_000, acceptedAt: 2_000, transferTx: "0xabc", acceptTx: "0xdef" },
      notes: [{ kind: "signed", at: 3_000, targetBps: 650 }],
      actions: [{ txHash: "0x111", amountCNS: "61000000", distBefore: "32000", distAfter: "65000", createdAt: 4_000 }],
    });
    expect(rows.map((row) => row.title)).toEqual([
      "Lifeline added 61 AUSD",
      "You turned on protection",
      "You took ownership",
      "Practice account reserved for you",
    ]);
    expect(rows[0]?.sentence).toBe("3.2% → 6.5%");
    expect(rows[0]?.hash).toBe("0x111");
  });

  it("counts days left and the heartbeat", () => {
    expect(daysLeft("100000", 100000 - 86_400)).toBe("1 day left");
    expect(daysLeft("100000", 100000 - 2 * 86_400)).toBe("2 days left");
    expect(heartbeatLine(1_000, 68909760, 4_000)).toBe("Checked 3 s ago · block 68,909,760");
    expect(formatMon("70000000000000000")).toBe("0.07 MON");
  });
});
