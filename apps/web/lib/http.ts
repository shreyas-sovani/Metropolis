import { MAINNET_ID, TESTNET_ID, type ChainId } from "@lifeline/core";

export function parseChain(value: string | null): ChainId | null {
  if (value === null || value === "" || value === String(MAINNET_ID)) return MAINNET_ID;
  if (value === String(TESTNET_ID)) return TESTNET_ID;
  return null;
}

export function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export function workerOrigin(): string {
  return (
    process.env.WORKER_HEALTH_URL?.replace(/\/health$/, "") ||
    process.env.NEXT_PUBLIC_WORKER_URL ||
    "https://lifeline.lifeline-shreyas.workers.dev"
  ).replace(/\/$/, "");
}

/** The radar refreshes every 2s. A keepalive once a minute is enough to re-arm a stalled alarm. */
const PING_MS = 60_000;
let pingedAt: number | null = null;

export function pingHealth(now = Date.now()): void {
  if (pingedAt !== null && now - pingedAt < PING_MS) return;
  pingedAt = now;
  const url = process.env.WORKER_HEALTH_URL || `${workerOrigin()}/health`;
  void fetch(url).catch(() => undefined);
}
