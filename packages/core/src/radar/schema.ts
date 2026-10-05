import { z } from "zod";

const micro = z.string().regex(/^\d+$/);
const signed = z.string().regex(/^-?\d+$/);

export const compactPositionSchema = z.object({
  perpId: z.number().int().nonnegative(),
  side: z.union([z.literal(1), z.literal(-1)]),
  positionType: z.union([z.literal(0), z.literal(1)]),
  entryMicro: micro,
  lot: micro,
  depositMicro: micro,
  fundingMicro: signed,
  mmf: micro,
  markMicro: micro,
  idleMicro: micro,
  notionalMicro: micro,
  pricePNS: micro,
  lotLNS: micro,
  priceDecimals: z.number().int().nonnegative(),
  lotDecimals: z.number().int().nonnegative(),
  maintHdths: micro,
  markPNS: micro,
});

export const atRiskSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}$/),
  side: z.union([z.literal("long"), z.literal("short")]),
  leverageHdths: micro,
  notionalMicro: micro,
  distanceE6: signed,
  depositMicro: micro,
  freeMicro: micro,
  couldProtectNow: z.boolean(),
});

export const bucketSchema = z.object({
  index: z.number().int().nonnegative(),
  side: z.union([z.literal("long"), z.literal("short")]),
  notionalMicro: micro,
  count: z.number().int().nonnegative(),
});

export const marketSnapshotSchema = z.object({
  perpId: z.number().int().nonnegative(),
  symbol: z.string(),
  markMicro: micro,
  openInterestMicro: micro,
  positionCount: z.number().int().nonnegative(),
  atRiskCount: z.number().int().nonnegative(),
  atRiskNotionalMicro: micro,
  idleMicro: micro,
  couldProtectNow: z.number().int().nonnegative(),
  buckets: z.array(bucketSchema),
  atRisk: z.array(atRiskSchema),
});

export const headlineSchema = z.object({
  openInterestMicro: micro,
  positionCount: z.number().int().nonnegative(),
  atRiskNotionalMicro: micro,
  atRiskCount: z.number().int().nonnegative(),
  idleMicro: micro,
  couldProtectNow: z.number().int().nonnegative(),
});

export const radarSnapshotSchema = z.object({
  chainId: z.union([z.literal(143), z.literal(10143)]),
  blockNumber: micro,
  headline: headlineSchema,
  markets: z.array(marketSnapshotSchema),
  positions: z.array(compactPositionSchema),
});

export type RadarSnapshot = z.infer<typeof radarSnapshotSchema>;
export type CompactPosition = z.infer<typeof compactPositionSchema>;
