import { CRASH_LABEL, simulate, type CrashResult } from "../../../packages/core/src/radar/crash";
import type { CompactPosition } from "../../../packages/core/src/radar/schema";
import { formatUsd } from "./format";

const MARK_INDEX = 60;

export function crashLine(
  positions: readonly CompactPosition[],
  perpId: number,
  symbol: string,
  shockPct: number,
): { text: string; label: typeof CRASH_LABEL; result: CrashResult } {
  const result = simulate(positions, perpId, shockPct);
  const sign = shockPct > 0 ? "+" : shockPct < 0 ? "−" : "";
  const text = `${sign}${Math.abs(shockPct)}% ${symbol}: ${result.liquidated.count} positions / ${formatUsd(result.liquidated.notionalMicro.toString())} liquidated · Lifeline could save ${result.saved.count} / ${formatUsd(result.saved.notionalMicro.toString())} using their own idle AUSD.`;
  return { text, label: result.label, result };
}

/** A downward shock lights long buckets within that distance of the mark. An upward shock lights shorts. */
export function bucketHit(index: number, side: "long" | "short", shockPct: number): boolean {
  if (shockPct === 0) return false;
  const steps = Math.round(Math.abs(shockPct) / 0.25);
  if (shockPct < 0 && side === "long") return index >= MARK_INDEX - steps && index < MARK_INDEX;
  if (shockPct > 0 && side === "short") return index > MARK_INDEX && index <= MARK_INDEX + steps;
  return false;
}
