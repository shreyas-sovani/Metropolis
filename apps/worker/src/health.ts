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
