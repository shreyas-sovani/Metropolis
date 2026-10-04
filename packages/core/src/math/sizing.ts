import {
  AT_RISK_DISTANCE,
  BUCKET_MAX,
  BUCKET_MIN,
  BUCKET_STEP,
  COOLDOWN_BLOCKS,
  DUST_NOTIONAL_MICRO,
  MIN_ACTION_MICRO,
  desiredDepositMicro,
  distanceE6,
  liquidationPriceMicro,
  notionalMicro,
} from "./liquidation.js";

export interface TopUpInput {
  side: 1n | -1n;
  entryMicro: bigint;
  lot: bigint;
  depositMicro: bigint;
  fundingMicro: bigint;
  mmf: bigint;
  markMicro: bigint;
  triggerBps: bigint;
  targetBps: bigint;
  maxPerActionMicro: bigint;
  freeBalanceMicro: bigint;
  budgetLeftMicro: bigint;
  lastActionBlock: bigint | null;
  currentBlock: bigint;
  minActionMicro?: bigint;
  cooldownBlocks?: bigint;
}

export function sizeTopUp(input: TopUpInput): bigint {
  const minAction = input.minActionMicro ?? MIN_ACTION_MICRO;
  const cooldown = input.cooldownBlocks ?? COOLDOWN_BLOCKS;
  if (input.lastActionBlock !== null && input.currentBlock - input.lastActionBlock < cooldown) {
    return 0n;
  }
  const liq = liquidationPriceMicro(input);
  const distance = distanceE6(input.side, input.markMicro, liq);
  const trigger = (input.triggerBps * 1_000_000n) / 10_000n;
  if (distance >= trigger) return 0n;
  const desired = desiredDepositMicro(input);
  let add = desired - input.depositMicro;
  if (add < 0n) add = 0n;
  if (add > input.maxPerActionMicro) add = input.maxPerActionMicro;
  if (add > input.freeBalanceMicro) add = input.freeBalanceMicro;
  if (add > input.budgetLeftMicro) add = input.budgetLeftMicro;
  if (add < minAction) return 0n;
  return add;
}

export function isDust(entryMicro: bigint, lot: bigint): boolean {
  return notionalMicro(entryMicro, lot) < DUST_NOTIONAL_MICRO;
}

export function isAtRisk(distance: bigint): boolean {
  return distance < AT_RISK_DISTANCE;
}

/** Bucket of (liquidation − mark) / mark, from −15% to +15% in 0.25% steps. */
export function bucketIndex(offsetE6: bigint): number | null {
  if (offsetE6 < BUCKET_MIN || offsetE6 > BUCKET_MAX) return null;
  const index = Number((offsetE6 - BUCKET_MIN) / BUCKET_STEP);
  const last = Number((BUCKET_MAX - BUCKET_MIN) / BUCKET_STEP);
  return index > last ? last : index;
}

export function couldProtectNow(args: {
  side: 1n | -1n;
  entryMicro: bigint;
  lot: bigint;
  depositMicro: bigint;
  fundingMicro: bigint;
  mmf: bigint;
  markMicro: bigint;
  idleMicro: bigint;
}): boolean {
  if (isDust(args.entryMicro, args.lot)) return false;
  const liq = liquidationPriceMicro(args);
  if (!isAtRisk(distanceE6(args.side, args.markMicro, liq))) return false;
  const desired = desiredDepositMicro({ ...args, targetBps: 600n });
  const need = desired - args.depositMicro;
  return need > 0n && args.idleMicro >= need;
}
