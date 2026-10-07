export const RADAR_MS = 2_000;
export const LIQUIDATIONS_MS = 60_000;
export const MARKETS_MS = 5 * 60_000;
export const SAVES_MS = 30_000;
export const LANDING_MS = 10_000;

/** True when `interval` has elapsed since `lastAt`. A null last time is due immediately. */
export function pollDue(lastAt: number | null, now: number, interval: number): boolean {
  return lastAt === null || now - lastAt >= interval;
}
