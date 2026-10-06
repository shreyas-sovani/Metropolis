export const WORKER_VERSION = "1";

const WEI = 10n ** 18n;
/** Sponsor under 3 MON, operator under 1 MON, available under 10, or in-band under 5. */
export const SPONSOR_LOW_WEI = 3n * WEI;
export const OPERATOR_LOW_WEI = WEI;
export const AVAILABLE_LOW = 10;
export const IN_BAND_LOW = 5;

export interface PoolBySide {
  long: number;
  short: number;
}

export interface HealthReport {
  lastAlarmAt: number | null;
  ticksLast10m: number;
  degraded: boolean;
  paused: boolean;
  poolAvailable: number;
  sponsorMon: string;
  operatorMon: string;
  poolInBand: number;
  poolBySide: PoolBySide;
  low: boolean;
  version: string;
}

export function formatMon(wei: bigint): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / WEI;
  const frac = (abs % WEI).toString().padStart(18, "0").slice(0, 4);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** True when any ops floor is missed. The floors themselves are not low. */
export function isOpsLow(input: {
  sponsorWei: bigint;
  operatorWei: bigint;
  poolAvailable: number;
  poolInBand: number;
}): boolean {
  return (
    input.sponsorWei < SPONSOR_LOW_WEI ||
    input.operatorWei < OPERATOR_LOW_WEI ||
    input.poolAvailable < AVAILABLE_LOW ||
    input.poolInBand < IN_BAND_LOW
  );
}

export function countInBand(distances: readonly bigint[], low = 25_000n, high = 35_000n): number {
  return distances.filter((distance) => distance >= low && distance <= high).length;
}

export function countBySide(sides: readonly string[]): PoolBySide {
  let long = 0;
  let short = 0;
  for (const side of sides) {
    if (side === "long") long += 1;
    else if (side === "short") short += 1;
  }
  return { long, short };
}

export function healthReport(input: {
  lastAlarmAt: number | null;
  ticksLast10m: number;
  lastError: string | null;
  paused: boolean;
  poolAvailable: number;
  sponsorWei: bigint;
  operatorWei: bigint;
  poolInBand: number;
  poolBySide: PoolBySide;
}): HealthReport {
  return {
    lastAlarmAt: input.lastAlarmAt,
    ticksLast10m: input.ticksLast10m,
    degraded: input.lastError !== null && input.lastError !== "",
    paused: input.paused,
    poolAvailable: input.poolAvailable,
    sponsorMon: formatMon(input.sponsorWei),
    operatorMon: formatMon(input.operatorWei),
    poolInBand: input.poolInBand,
    poolBySide: input.poolBySide,
    low: isOpsLow(input),
    version: WORKER_VERSION,
  };
}

/** A missing or overdue alarm should be set within a few milliseconds of /health. */
export function needsAlarm(alarmAt: number | null, lastTick: number | null, now: number): boolean {
  if (alarmAt === null || alarmAt <= now) return true;
  return lastTick !== null && now - lastTick > 10_000;
}

export function pausedFlag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function clientError(error: unknown): string {
  const details = error as {
    shortMessage?: string;
    message?: string;
    status?: number;
    body?: { error?: { message?: string } };
    cause?: { message?: string };
  };
  const rpc = details.body?.error?.message ?? "";
  const raw = details.shortMessage || details.message || "error";
  const message = [details.status ? `status ${details.status}` : "", rpc, details.cause?.message ?? "", raw]
    .filter((part) => part.length > 0)
    .join(" ");
  return message.replace(/https?:\/\/\S+/g, "rpc").replace(/0x[0-9a-fA-F]{20,}/g, "0x").slice(0, 180);
}
