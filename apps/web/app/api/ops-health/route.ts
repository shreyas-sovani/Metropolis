import { workerOrigin } from "../../../lib/http";
import { opsHealthFromWorker, unreachableOps, type OpsHealth } from "../../../lib/ops-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every open tab polls this every 5s. One upstream read per window, whatever the tab count. */
const CACHE_MS = 10_000;
let cached: { at: number; body: OpsHealth } | null = null;

async function load(): Promise<OpsHealth> {
  try {
    const response = await fetch(`${workerOrigin()}/health`, { cache: "no-store" });
    if (!response.ok) return unreachableOps();
    return opsHealthFromWorker(await response.json());
  } catch {
    return unreachableOps();
  }
}

export async function GET(): Promise<Response> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Response.json(cached.body);
  const body = await load();
  cached = { at: Date.now(), body };
  return Response.json(body);
}
