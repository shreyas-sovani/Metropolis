export type OpsStatus = "normal" | "paused" | "degraded" | "unreachable";

export interface OpsHealth {
  status: OpsStatus;
  lastAlarmAt: number | null;
  lastBlock: number | null;
  armed: number;
  poolAvailable: number;
  degraded: boolean;
  paused: boolean;
  rpc: boolean;
}

export function unreachableOps(): OpsHealth {
  return {
    status: "unreachable",
    lastAlarmAt: null,
    lastBlock: null,
    armed: 0,
    poolAvailable: 0,
    degraded: false,
    paused: false,
    rpc: true,
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Map a Worker `/health` body onto the web status payload. */
export function opsHealthFromWorker(body: unknown): OpsHealth {
  const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const paused = row.paused === true;
  const degraded = row.degraded === true;
  const status: OpsStatus = paused ? "paused" : degraded ? "degraded" : "normal";
  return {
    status,
    lastAlarmAt: numberOrNull(row.lastAlarmAt),
    lastBlock: numberOrNull(row.lastBlock),
    armed: numberOr(row.armed, 0),
    poolAvailable: numberOr(row.poolAvailable, 0),
    degraded,
    paused,
    rpc: false,
  };
}

/**
 * Accept the new payload and the boolean payload older tests still mock.
 * `rpc: true` with neither pause nor degrade is "Status unavailable".
 */
export function normalizeOpsHealth(body: unknown): OpsHealth {
  if (!body || typeof body !== "object") return unreachableOps();
  const row = body as Record<string, unknown>;
  if (row.status === "unreachable" || (row.rpc === true && row.paused !== true && row.degraded !== true)) {
    const base = unreachableOps();
    return {
      ...base,
      lastAlarmAt: numberOrNull(row.lastAlarmAt),
      lastBlock: numberOrNull(row.lastBlock),
      armed: numberOr(row.armed, 0),
      poolAvailable: numberOr(row.poolAvailable, 0),
    };
  }
  return opsHealthFromWorker(body);
}
