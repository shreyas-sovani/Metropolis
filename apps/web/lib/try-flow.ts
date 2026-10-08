import { armDefaults, armExplanation, testNowTerms, type ArmTerms } from "@lifeline/core";
import { getAddress, type Address } from "viem";
import { TRADEOFF } from "./copy";
import { formatAusdWhole, formatDistanceOne, formatLeverage } from "./format";

export { formatAusdWhole };

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

function distanceLabel(distanceE6: string): string {
  return formatDistanceOne(distanceE6);
}

/** Leverage is stored in hundredths (1500 = 15×). */
export function leverageLabel(raw: string): string {
  return formatLeverage(raw);
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

export function sandboxProxy(accounts: readonly { proxy?: string }[]): string | null {
  const proxy = accounts.find((account) => account.proxy)?.proxy;
  return proxy ?? null;
}
