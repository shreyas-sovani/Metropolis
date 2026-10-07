import { workerOrigin } from "../../../lib/http";
import { opsHealthFromWorker, unreachableOps } from "../../../lib/ops-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const response = await fetch(`${workerOrigin()}/health`, { cache: "no-store" });
    if (!response.ok) return Response.json(unreachableOps());
    return Response.json(opsHealthFromWorker(await response.json()));
  } catch {
    return Response.json(unreachableOps());
  }
}
