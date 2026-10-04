/** 1e6 = one dollar, matching AUSD collateral units. */
export const MICRO = 1_000_000n;
/** Fixed-point lot scale so notional = entryMicro * lot / LOT_SCALE. */
export const LOT_SCALE = 10n ** 18n;
/** 1e6 = 100% for distances. 26_671n is about 2.667%. */
export const DISTANCE_SCALE = 1_000_000n;

export const MIN_ACTION_MICRO = 5n * MICRO;
export const DUST_NOTIONAL_MICRO = 10n * MICRO;
export const AT_RISK_DISTANCE = 50_000n;
export const COOLDOWN_BLOCKS = 3n;
export const BUCKET_STEP = 2_500n;
export const BUCKET_MIN = -150_000n;
export const BUCKET_MAX = 150_000n;

export function lotFromNotional(entryMicro: bigint, notionalMicro: bigint): bigint {
  if (entryMicro <= 0n) throw new Error("entry must be positive");
  return (notionalMicro * LOT_SCALE) / entryMicro;
}

export function notionalMicro(entryMicro: bigint, lot: bigint): bigint {
  return (entryMicro * lot) / LOT_SCALE;
}

export function maintenanceMargin(notional: bigint, mmf: bigint): bigint {
  if (mmf <= 0n) throw new Error("mmf must be positive");
  return notional / mmf;
}

export function liquidationPriceMicro(args: {
  side: 1n | -1n;
  entryMicro: bigint;
  lot: bigint;
  depositMicro: bigint;
  fundingMicro: bigint;
  mmf: bigint;
}): bigint {
  if (args.lot <= 0n) throw new Error("lot must be positive");
  const mmr = maintenanceMargin(notionalMicro(args.entryMicro, args.lot), args.mmf);
  const gap = mmr - args.depositMicro - args.fundingMicro;
  return args.entryMicro + (args.side * gap * LOT_SCALE) / args.lot;
}

/** Signed distance of mark from liquidation. Positive means the position is still safe. */
export function distanceE6(side: 1n | -1n, markMicro: bigint, liquidationMicro: bigint): bigint {
  if (markMicro <= 0n) throw new Error("mark must be positive");
  return (side * (markMicro - liquidationMicro) * DISTANCE_SCALE) / markMicro;
}

export function targetPriceMicro(markMicro: bigint, side: 1n | -1n, targetBps: bigint): bigint {
  return (markMicro * (10_000n - side * targetBps)) / 10_000n;
}

export function desiredDepositMicro(args: {
  side: 1n | -1n;
  entryMicro: bigint;
  lot: bigint;
  fundingMicro: bigint;
  mmf: bigint;
  markMicro: bigint;
  targetBps: bigint;
}): bigint {
  const mmr = maintenanceMargin(notionalMicro(args.entryMicro, args.lot), args.mmf);
  const target = targetPriceMicro(args.markMicro, args.side, args.targetBps);
  const move = (args.side * (target - args.entryMicro) * args.lot) / LOT_SCALE;
  return mmr - args.fundingMicro - move;
}
