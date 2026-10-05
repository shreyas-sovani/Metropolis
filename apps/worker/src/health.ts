export const WORKER_VERSION = "1";

export interface HealthReport {
  lastAlarmAt: number | null;
  ticksLast10m: number;
  degraded: boolean;
  paused: boolean;
  poolAvailable: number;
  version: string;
}

export function healthReport(input: {
  lastAlarmAt: number | null;
  ticksLast10m: number;
  lastError: string | null;
  paused: boolean;
  poolAvailable: number;
}): HealthReport {
  return {
    lastAlarmAt: input.lastAlarmAt,
    ticksLast10m: input.ticksLast10m,
    degraded: input.lastError !== null && input.lastError !== "",
    paused: input.paused,
    poolAvailable: input.poolAvailable,
    version: WORKER_VERSION,
  };
}

export function pausedFlag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}
