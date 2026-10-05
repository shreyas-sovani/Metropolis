import {
  COOLDOWN_BLOCKS,
  DISTANCE_SCALE,
  MIN_ACTION_MICRO,
  desiredDepositMicro,
  distanceE6,
  liquidationPriceMicro,
} from "../math/liquidation.js";
import type { MandateMessage } from "./mandate.js";

export const SKIP_REASONS = [
  "MARK_INVALID",
  "NO_POSITION",
  "ABOVE_TRIGGER",
  "COOLDOWN",
  "BUDGET_EXHAUSTED",
  "BELOW_MIN",
  "NO_FREE_BALANCE",
  "EXPIRED",
  "PAUSED",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

export interface EvalPosition {
  markPriceValid: boolean;
  open: boolean;
  side: 1n | -1n;
  entryMicro: bigint;
  lot: bigint;
  depositMicro: bigint;
  fundingMicro: bigint;
  mmf: bigint;
  markMicro: bigint;
}

export interface EvalAccount {
  freeBalanceMicro: bigint;
  paused: boolean;
  nowSec: bigint;
}

export type Evaluation =
  | { action: "topUp"; amountCNS: bigint; distBefore: bigint; distTarget: bigint }
  | { action: "skip"; reason: SkipReason };

function skip(reason: SkipReason): Evaluation {
  return { action: "skip", reason };
}

/**
 * The only action is a collateral top-up. No open, close, or reduce (H6).
 * PAUSED and EXPIRED are checked before market state so the kill switch never sizes a send.
 */
export function evaluate(
  mandate: MandateMessage,
  position: EvalPosition | null,
  account: EvalAccount,
  lastActionBlock: bigint | null,
  nowBlock: bigint,
  budgetUsed: bigint,
): Evaluation {
  if (account.paused) return skip("PAUSED");
  if (mandate.expiry <= account.nowSec) return skip("EXPIRED");
  if (!position || !position.markPriceValid || position.markMicro <= 0n) return skip("MARK_INVALID");
  if (!position.open || position.lot <= 0n) return skip("NO_POSITION");

  const distBefore = distanceE6(
    position.side,
    position.markMicro,
    liquidationPriceMicro({
      side: position.side,
      entryMicro: position.entryMicro,
      lot: position.lot,
      depositMicro: position.depositMicro,
      fundingMicro: position.fundingMicro,
      mmf: position.mmf,
    }),
  );
  const trigger = (BigInt(mandate.triggerBps) * DISTANCE_SCALE) / 10_000n;
  if (distBefore >= trigger) return skip("ABOVE_TRIGGER");
  if (lastActionBlock !== null && nowBlock - lastActionBlock < COOLDOWN_BLOCKS) return skip("COOLDOWN");

  const budgetLeft = mandate.budgetCNS > budgetUsed ? mandate.budgetCNS - budgetUsed : 0n;
  if (budgetLeft <= 0n) return skip("BUDGET_EXHAUSTED");

  const desired = desiredDepositMicro({
    side: position.side,
    entryMicro: position.entryMicro,
    lot: position.lot,
    fundingMicro: position.fundingMicro,
    mmf: position.mmf,
    markMicro: position.markMicro,
    targetBps: BigInt(mandate.targetBps),
  });
  const raw = desired > position.depositMicro ? desired - position.depositMicro : 0n;
  if (account.freeBalanceMicro <= 0n && raw > 0n) return skip("NO_FREE_BALANCE");

  let add = raw;
  if (add > mandate.maxPerActionCNS) add = mandate.maxPerActionCNS;
  if (add > account.freeBalanceMicro) add = account.freeBalanceMicro;
  if (add > budgetLeft) add = budgetLeft;
  if (add < MIN_ACTION_MICRO) return skip("BELOW_MIN");

  const distTarget = (BigInt(mandate.targetBps) * DISTANCE_SCALE) / 10_000n;
  return { action: "topUp", amountCNS: add, distBefore, distTarget };
}
