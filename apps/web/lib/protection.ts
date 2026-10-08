import { desiredDepositMicro, liquidationPriceMicro, MANDATE_MAX_TARGET_BPS } from "@lifeline/core";
import { formatAusdWhole, formatDistanceOne, formatPctOne, formatPrice } from "./format";

/** Verbatim safety-line copy from backlog §7B.5. */
export function safetyCopy(distancePct: string, safetyPct: string, actBelowPct: string): string {
  return `Your position is ${distancePct} from liquidation. Lifeline recommends a safety line of ${safetyPct} and will step in below ${actBelowPct}.`;
}

export function insideLineCopy(): string {
  return "That's inside your line, so Lifeline will add margin right after you sign.";
}

export function outsideLineCopy(): string {
  return "That's above your line, so Lifeline will wait and act if the price moves against you.";
}

export function oneDecimal(bps: number): string {
  return formatPctOne(bps / 100);
}

export function distancePctLabel(distanceE6: string): string {
  return formatDistanceOne(distanceE6);
}

/** Safety line is the target. The act-below line sits 2 percentage points under it. */
export function linesFromSafety(safetyPct: number): { targetBps: number; triggerBps: number } {
  const targetBps = Math.round(safetyPct * 100);
  const triggerBps = Math.max(1, targetBps - 200);
  return { targetBps, triggerBps };
}

export type ProtectPhase = "idle" | "preparing" | "claiming" | "owning" | "choosing" | "signing" | "protected" | "demo" | "error";

const STEP_RANK: Record<ProtectPhase, number> = {
  idle: 0,
  preparing: 0,
  claiming: 0,
  error: 0,
  demo: 0,
  owning: 1,
  choosing: 2,
  signing: 2,
  protected: 3,
};

export function stepStates(phase: ProtectPhase): Array<"upcoming" | "current" | "done"> {
  if (phase === "protected") return ["done", "done", "done", "done"];
  const at = STEP_RANK[phase];
  return [0, 1, 2, 3].map((index) => (index < at ? "done" : index === at ? "current" : "upcoming"));
}

/** C5: 0 < act-below < safety line ≤ 20%. */
export function clampLines(safetyPct: number, actBelowPct: number): {
  targetBps: number;
  triggerBps: number;
  safetyPct: number;
  actBelowPct: number;
} {
  let targetBps = Math.round(safetyPct * 100);
  if (targetBps > MANDATE_MAX_TARGET_BPS) targetBps = MANDATE_MAX_TARGET_BPS;
  if (targetBps < 2) targetBps = 2;
  let triggerBps = Math.round(actBelowPct * 100);
  if (triggerBps < 1) triggerBps = 1;
  if (triggerBps >= targetBps) triggerBps = targetBps - 1;
  return {
    targetBps,
    triggerBps,
    safetyPct: targetBps / 100,
    actBelowPct: triggerBps / 100,
  };
}

export function ausdToMicro(raw: string, fallback: bigint): bigint {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const micro = BigInt(Math.round(value * 1_000_000));
  return micro > 0n ? micro : fallback;
}

/** Expiry is at least a day and at most 30 days, matching C5. */
export function expiryFromDays(raw: string, nowSec: number): bigint {
  let days = Number(raw);
  if (!Number.isFinite(days)) days = 7;
  days = Math.min(30, Math.max(1, Math.round(days)));
  return BigInt(nowSec + days * 24 * 60 * 60);
}

export interface PreviewPosition {
  side: string;
  entryMicro?: string;
  markMicro?: string;
  lot?: string;
  fundingMicro?: string;
  mmf?: string;
  depositMicro?: string;
  liquidation?: string;
  priceDecimals?: number;
}

/** Client-side top-up estimate. Null when the position is already past the safety line. */
export function previewTopUp(position: PreviewPosition, distancePct: string, targetBps: number): string | null {
  if (!position.entryMicro || !position.markMicro || !position.lot || !position.mmf || !position.depositMicro || !position.liquidation) {
    return null;
  }
  const side = position.side === "short" ? -1n : position.side === "long" ? 1n : null;
  if (!side) return null;
  try {
    const desired = desiredDepositMicro({
      side,
      entryMicro: BigInt(position.entryMicro),
      lot: BigInt(position.lot),
      fundingMicro: BigInt(position.fundingMicro ?? "0"),
      mmf: BigInt(position.mmf),
      markMicro: BigInt(position.markMicro),
      targetBps: BigInt(targetBps),
    });
    const deposit = BigInt(position.depositMicro);
    if (desired <= deposit) return null;
    const after = liquidationPriceMicro({
      side,
      entryMicro: BigInt(position.entryMicro),
      lot: BigInt(position.lot),
      depositMicro: desired,
      fundingMicro: BigInt(position.fundingMicro ?? "0"),
      mmf: BigInt(position.mmf),
    });
    const decimals = position.priceDecimals ?? 1;
    const added = formatAusdWhole((desired - deposit).toString());
    const from = formatPrice(position.liquidation, decimals);
    const to = formatPrice(after.toString(), decimals);
    return `Today ${distancePct}. Lifeline would add about ${added} now and move your liquidation price from ${from} to about ${to}.`;
  } catch {
    return null;
  }
}
