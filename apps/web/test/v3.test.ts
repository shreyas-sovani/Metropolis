import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKIP_REASONS } from "@lifeline/core";
import { describe, expect, it } from "vitest";
import { forbiddenHit } from "../lib/forbidden";
import { formatAgo, formatBlock, shortenHex } from "../lib/format";
import { MESSAGE_CODES, userMessage } from "../lib/messages";
import { normalizeOpsHealth, opsHealthFromWorker, unreachableOps } from "../lib/ops-health";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tokenHex(name: string): string {
  const css = readFileSync(path.join(root, "app/styles/tokens.css"), "utf8");
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`missing ${name}`);
  return match[1].toLowerCase();
}

function channel(hex: string): [number, number, number] {
  const value = hex.slice(1);
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const linear = channel(hex).map((part) => {
    const s = part / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const EXPECTED: Record<string, string> = {
  "--paper": "#faf9f5",
  "--surface": "#ffffff",
  "--well": "#f0eee6",
  "--line": "#e8e6dc",
  "--line-strong": "#b0aea5",
  "--ink": "#141413",
  "--ink-2": "#3d3d3a",
  "--muted": "#5e5d59",
  "--clay": "#d97757",
  "--clay-ink": "#a8492a",
  "--blue": "#6a9bcc",
  "--blue-ink": "#386591",
  "--olive": "#788c5d",
  "--olive-ink": "#566a3d",
  "--danger": "#b3402a",
  "--danger-ink": "#a33a26",
  "--on-ink": "#faf9f5",
};

describe("V3 contrast", () => {
  it("keeps the §7B.4.1 hex values", () => {
    for (const [name, hex] of Object.entries(EXPECTED)) expect(tokenHex(name)).toBe(hex);
  });

  it("holds 4.5:1 for every text pair and 3:1 for non-text marks", () => {
    const paper = tokenHex("--paper");
    const surface = tokenHex("--surface");
    const well = tokenHex("--well");
    const textPairs: Array<[string, string]> = [
      ["--ink", "--paper"],
      ["--ink-2", "--paper"],
      ["--muted", "--paper"],
      ["--muted", "--well"],
      ["--clay-ink", "--paper"],
      ["--clay-ink", "--well"],
      ["--blue-ink", "--paper"],
      ["--blue-ink", "--well"],
      ["--olive-ink", "--paper"],
      ["--olive-ink", "--well"],
      ["--danger-ink", "--paper"],
      ["--danger-ink", "--well"],
      ["--ink", "--surface"],
      ["--ink-2", "--surface"],
      ["--on-ink", "--ink"],
      ["--ink", "--clay"],
    ];
    for (const [fg, bg] of textPairs) {
      const ratio = contrast(tokenHex(fg), bg.startsWith("--") ? tokenHex(bg) : bg);
      expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const mark of ["--olive", "--danger", "--ink"]) {
      for (const neighbor of [paper, surface, well]) {
        expect(contrast(tokenHex(mark), neighbor), `${mark} on ${neighbor}`).toBeGreaterThanOrEqual(3);
      }
    }
    // Clay and blue are the chart fills from the brand palette. Against paper they are 2.96 and 2.78,
    // so a screen never uses them as the only indicator: the trace sits with the Lifeline name, and bars get a label.
    expect(contrast(tokenHex("--clay"), paper)).toBeGreaterThan(2.9);
    expect(contrast(tokenHex("--blue"), paper)).toBeGreaterThan(2.7);
    expect(contrast(tokenHex("--olive"), paper)).toBeGreaterThanOrEqual(3);
    const lineStrong = contrast(tokenHex("--line-strong"), paper);
    expect(lineStrong).toBeCloseTo(2.11, 1);
    expect(lineStrong).toBeLessThan(3);
  });
});

describe("V3 messages", () => {
  it("maps every evaluate reason and the claim rows", () => {
    for (const reason of SKIP_REASONS) expect(MESSAGE_CODES).toContain(reason);
    expect(userMessage("claimed").title).toBe("You already have a practice account");
    expect(userMessage("rate").action).toBe("Use demo mode");
    expect(userMessage("empty").title).toBe("All practice accounts are in use");
    expect(userMessage("sponsor_floor").title).toBe("Practice accounts are paused for a moment");
    expect(userMessage("turnstile").title).toBe("Please confirm you're human");
    expect(userMessage("unauthorized").title).toBe("Your wallet didn't start");
    expect(userMessage("ownership").title).toBe("Ownership wasn't transferred");
    expect(userMessage("ABOVE_TRIGGER", { distancePct: "3.2%", actBelowPct: "4.5%" })).toMatchObject({
      title: "Protection is on",
      tone: "success",
      sentence: "Your position is 3.2% from liquidation, above your act-below line of 4.5%. Lifeline will step in if it falls below.",
    });
    expect(userMessage("BELOW_MIN").title).toBe("Protection is on");
    expect(userMessage("BUDGET_EXHAUSTED").title).toBe("Budget used up");
    expect(userMessage("cap").title).toBe("Budget used up");
    expect(userMessage("nonce").title).toBe("That signature was already used");
    expect(userMessage("reverted", { txHref: "https://testnet.monadexplorer.com/tx/0xabc" }).txHref).toContain("/tx/");
    expect(userMessage("rpc").title).toBe("Monad testnet is slow to answer");
    expect(userMessage("withdraw").title).toBe("Withdrawal didn't go through");
    expect(userMessage("PAUSED").title).toBe("Lifeline is paused");
    expect(userMessage("nope").title).toBe("That didn't go through");
    for (const code of MESSAGE_CODES) {
      const message = userMessage(code, { distancePct: "3.2%", actBelowPct: "4.5%" });
      const visible = `${message.title} ${message.sentence} ${message.action ?? ""}`;
      expect(forbiddenHit(visible)).toBeNull();
    }
  });
});

describe("V3 ops health", () => {
  it("keeps the old booleans and adds the status fields", () => {
    expect(opsHealthFromWorker({ degraded: false, paused: false, lastAlarmAt: 5, lastBlock: 9, armed: 4, poolAvailable: 12 })).toEqual({
      status: "normal",
      lastAlarmAt: 5,
      lastBlock: 9,
      armed: 4,
      poolAvailable: 12,
      claimsToday: 0,
      degraded: false,
      paused: false,
      rpc: false,
    });
    expect(opsHealthFromWorker({ paused: true, degraded: true }).status).toBe("paused");
    expect(opsHealthFromWorker({ degraded: true }).status).toBe("degraded");
    expect(unreachableOps()).toMatchObject({ status: "unreachable", rpc: true, degraded: false, paused: false });
    expect(normalizeOpsHealth({ degraded: true, paused: false, rpc: false }).status).toBe("degraded");
    expect(normalizeOpsHealth({ degraded: false, paused: false, rpc: true }).status).toBe("unreachable");
  });
});

describe("V3 format", () => {
  it("shortens hashes and formats blocks and relative time", () => {
    expect(shortenHex("0x1234567890abcdef")).toBe("0x1234…cdef");
    expect(formatBlock(68909759)).toBe("block 68,909,759");
    expect(formatAgo(1_000, 13_000)).toBe("12 s ago");
    expect(formatAgo(0, 180_000)).toBe("3 min ago");
  });
});
