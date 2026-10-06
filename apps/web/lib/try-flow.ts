import { armDefaults, armExplanation, testNowTerms, type ArmTerms } from "@lifeline/core";
import { getAddress, type Address } from "viem";
import { TRADEOFF } from "./copy";

export interface ClaimPosition {
  market: string;
  side: string;
  leverage: string;
  distanceE6: string;
}

export interface ClaimBody {
  proxy?: string;
  perpId?: string;
  accountId?: string;
  error?: string;
  sandbox?: boolean;
  position?: ClaimPosition;
  txs?: { drip?: string; transfer?: string };
}

export interface ArmBody {
  txHash?: string;
  block?: number;
  addedCNS?: string;
  liqBefore?: string;
  liqAfter?: string;
  distBefore?: string;
  distAfter?: string;
  msFromRequest?: number;
  reason?: string;
  skipped?: boolean;
  error?: string;
}

/** Leverage is stored in hundredths (1500 = 15×). */
function distanceLabel(distanceE6: string): string {
  const pct = Number(distanceE6) / 10_000;
  return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
}

export function leverageLabel(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return raw;
  const times = value >= 100 ? value / 100 : value;
  const text = Number.isInteger(times) ? String(times) : times.toFixed(1);
  return `${text}×`;
}

export function formatAusdWhole(cns: string): string {
  const whole = BigInt(cns || "0") / 1_000_000n;
  return `${whole.toLocaleString("en-US")} AUSD`;
}

export function positionCard(input: ClaimPosition & { freeCNS?: string }): string {
  const idle = input.freeCNS ? ` · ${formatAusdWhole(input.freeCNS)} idle` : "";
  return `Your ${leverageLabel(input.leverage)} ${input.market} ${input.side} · ${distanceLabel(input.distanceE6)} from liquidation${idle}`;
}

export function termsFor(distanceE6: bigint, testNow: boolean): ArmTerms {
  return testNow ? testNowTerms(distanceE6) : armDefaults(distanceE6);
}

/** Half the free balance, at least 1 CNS so a mandate can be signed. */
export function budgetFromFree(freeCNS: bigint): bigint {
  if (freeCNS <= 1n) return 1n;
  return freeCNS / 2n;
}

export function armSentence(distanceE6: bigint, terms: ArmTerms): string {
  return armExplanation(distanceE6, terms);
}

export function tradeoff(): string {
  return TRADEOFF;
}

/** Privy failure, or an empty pool, drops the judge into sandbox. */
export function useSandbox(input: { privyFailed: boolean; status?: number; sandbox?: boolean }): boolean {
  if (input.privyFailed) return true;
  return input.status === 503 && input.sandbox === true;
}

/** Accept is the only owner transaction before the receipt. The mandate is a signature. */
export function ownerTxsBeforeReceipt(accepted: boolean): number {
  return accepted ? 1 : 0;
}

export function disarmText(proxy: Address, nonce: string): string {
  return `lifeline-disarm:${getAddress(proxy)}:${nonce}`;
}

export function expiryInSevenDays(nowSec: number): bigint {
  return BigInt(nowSec + 7 * 24 * 60 * 60);
}

export function receiptLine(body: ArmBody): string {
  const before = body.distBefore ? distanceLabel(body.distBefore) : "unknown";
  const after = body.distAfter ? distanceLabel(body.distAfter) : "unknown";
  return `Distance ${before} → ${after}. Block ${body.block ?? "unknown"}. ${body.msFromRequest ?? "unknown"} ms.`;
}

export function sandboxProxy(pairs: readonly { protected: { proxy: string; mandate: string } | null }[]): string | null {
  for (const pair of pairs) {
    if (pair.protected?.mandate === "house") return pair.protected.proxy;
  }
  return pairs.find((pair) => pair.protected)?.protected?.proxy ?? null;
}
