import { describe, expect, it } from "vitest";
import { formatUsd, formatUsdCompact } from "../lib/format";
import {
  ADDRESS_ERROR,
  CAN,
  CANT,
  FAQ,
  H1,
  HERO_PLACEHOLDER,
  HOW,
  LIVE_LABEL,
  LIVE_WAIT,
  PRIMARY,
  PROBLEM_CAPTION,
  PROBLEM_QUOTE,
  PROBLEM_SOURCE,
  PROOF,
  SAVES_BODY,
  SECURITY_HEADING,
  SUB,
  TOUR_LINK,
  sentenceCount,
} from "../lib/landing";
import { LANDING_MS } from "../lib/poll";

const forbidden = [
  /\bCNS\b/,
  /\bPNS\b/,
  /\bLNS\b/,
  /\bbps\b/i,
  /\w+E6\b/,
  /\bnonce\b/i,
  /selector/i,
  /\bproxy\b/i,
  /DelegatedAccount/,
  /acceptOwnership/,
  /increasePositionCollateral/,
  /\boperator\b/i,
  /\bsandbox\b/i,
  /\bkeeper\b/i,
  /Durable Object/,
  /\bundefined\b/,
  /\bNaN\b/,
  /\bnull\b/,
  /!/,
];

describe("V4 dollars", () => {
  it("compacts headline dollars and keeps the exact figure for under $10k", () => {
    expect(formatUsdCompact("0")).toBe("$0");
    expect(formatUsdCompact("1500000000")).toBe("$1,500");
    expect(formatUsdCompact("1500000000")).toBe(formatUsd("1500000000"));
    expect(formatUsdCompact("9999990000")).toBe("$9,999.99");
    expect(formatUsdCompact("10000000000")).toBe("$10k");
    expect(formatUsdCompact("274500000000")).toBe("$274.5k");
    expect(formatUsd("274500000000")).toBe("$274,500");
    expect(formatUsdCompact("127400000000")).toBe("$127.4k");
    expect(formatUsdCompact("3150000000000")).toBe("$3.15M");
    expect(formatUsd("3150000000000")).toBe("$3,150,000");
    expect(formatUsdCompact("10000000000000")).toBe("$10M");
    expect(formatUsdCompact("-1500000000")).toBe("-$1,500");
  });
});

describe("V4 copy", () => {
  it("keeps the verbatim landing lines and answers the FAQ in three sentences or fewer", () => {
    expect(H1).toBe("Don't get liquidated with money in your account.");
    expect(SUB).toContain("idle AUSD");
    expect(PRIMARY).toBe("Protect a position.");
    expect(HERO_PLACEHOLDER).toBe("Paste a Perpl account address.");
    expect(TOUR_LINK).toBe("Judging Metropolis? Take the 3-minute tour.");
    expect(LIVE_LABEL).toBe("Live on Monad mainnet · read-only.");
    expect(LIVE_WAIT).toBe("Live numbers are taking a moment.");
    expect(ADDRESS_ERROR).toBe("That isn't a valid address.");
    expect(PROBLEM_QUOTE).toBe("A position can be liquidated even while your account holds ample free balance.");
    expect(PROBLEM_SOURCE).toBe("Perpl documentation.");
    expect(PROBLEM_CAPTION).toBe("Perpl liquidates the position. The idle AUSD never moves.");
    expect(HOW.map((step) => step.title)).toEqual([
      "Give Lifeline a narrow key.",
      "Draw your safety line.",
      "Lifeline steps in.",
    ]);
    expect(SECURITY_HEADING).toBe("What Lifeline's key can't do.");
    expect(CAN).toContain("per top-up limit");
    expect(CANT).toContain("Act after you pause it.");
    expect(PROOF[2]?.body).toContain("912 live positions");
    expect(SAVES_BODY).toContain("Lifeline's top-up");
    expect(FAQ.map((item) => item.q)).toEqual([
      "Is this real or a simulation?",
      "Why testnet?",
      "What can Lifeline's key do with my account?",
      "What if the price keeps moving against me?",
      "How do I stop it?",
      "Does it cost anything?",
      "Is the liquidation price exact?",
    ]);
    for (const item of FAQ) {
      expect(sentenceCount(item.a)).toBeLessThanOrEqual(3);
      expect(sentenceCount(item.a)).toBeGreaterThan(0);
    }
    expect(LANDING_MS).toBe(10_000);
    const visible = [
      H1,
      SUB,
      PRIMARY,
      ...HOW.flatMap((step) => [step.title, step.body]),
      CAN,
      CANT,
      ...FAQ.flatMap((item) => [item.q, item.a, item.link ?? ""]),
      SAVES_BODY,
    ].join(" ");
    for (const pattern of forbidden) expect(visible).not.toMatch(pattern);
  });
});
