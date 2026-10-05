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

export function priceToMicro(pricePNS: bigint, priceDecimals: number): bigint {
  return (pricePNS * MICRO) / 10n ** BigInt(priceDecimals);
}

export function lotToScaled(lotLNS: bigint, lotDecimals: number): bigint {
  return (lotLNS * LOT_SCALE) / 10n ** BigInt(lotDecimals);
}

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

/** Unrounded dollar-space price. Product decisions use `liquidationPricePNS`. */
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

export interface ContractPosition {
  /** Exchange `positionType`: 0 long, 1 short. */
  positionType: number;
  pricePNS: bigint;
  lotLNS: bigint;
  depositCNS: bigint;
  premiumPnlCNS: bigint;
}

export interface ContractMarket {
  priceDecimals: number;
  lotDecimals: number;
  /** `perpMaintMarginFracHdths` at lot 0. MMF is this divided by 100. */
  maintHdths: bigint;
}

/**
 * Contract liquidation price in price-native units.
 * Raw `pricePNS` entry, residue ignored, premium subtracted (positive means received),
 * maintenance at that entry, ceil for longs and floor for shorts.
 */
export function liquidationPricePNS(position: ContractPosition, market: ContractMarket): bigint {
  return roundedEntryPrice(position, market, true);
}

/** Same inputs as liquidation, with the maintenance term removed. */
export function bankruptcyPricePNS(position: ContractPosition, market: ContractMarket): bigint {
  return roundedEntryPrice(position, market, false);
}

function roundedEntryPrice(position: ContractPosition, market: ContractMarket, withMaintenance: boolean): bigint {
  if (position.positionType !== 0 && position.positionType !== 1) {
    throw new Error(`positionType ${position.positionType}`);
  }
  if (position.lotLNS <= 0n) throw new Error("lot must be positive");
  if (market.maintHdths <= 0n) throw new Error("maint hundredths must be positive");
  if (market.priceDecimals < 0 || market.lotDecimals < 0) throw new Error("decimals must be non-negative");
  const long = position.positionType === 0;
  const sign = long ? 1n : -1n;
  const scale = 10n ** BigInt(market.priceDecimals + market.lotDecimals);
  const den = market.maintHdths * MICRO * position.lotLNS;
  const collateral = position.depositCNS + position.premiumPnlCNS;
  const maintenance = withMaintenance ? sign * position.pricePNS * 100n * MICRO * position.lotLNS : 0n;
  const num = position.pricePNS * den + maintenance - sign * collateral * scale * market.maintHdths;
  return long ? divCeil(num, den) : divFloor(num, den);
}

/** Distance from the contract tick price. Mark and liquidation share price-native units. */
export function contractDistanceE6(position: ContractPosition, market: ContractMarket, markPNS: bigint): bigint {
  const side = position.positionType === 0 ? 1n : -1n;
  return distanceE6(side, markPNS, liquidationPricePNS(position, market));
}

export function liquidationMicroFromContract(position: ContractPosition, market: ContractMarket): bigint {
  return priceToMicro(liquidationPricePNS(position, market), market.priceDecimals);
}

function divFloor(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator >= 0n) return numerator / denominator;
  return -((-numerator + denominator - 1n) / denominator);
}

function divCeil(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator >= 0n) return (numerator + denominator - 1n) / denominator;
  return -(-numerator / denominator);
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
