import { workerOrigin } from "../../../lib/http";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const response = await fetch(`${workerOrigin()}/health`);
    if (!response.ok) return Response.json({ degraded: false, paused: false, rpc: true });
    const body = (await response.json()) as { degraded?: boolean; paused?: boolean };
    return Response.json({ degraded: body.degraded === true, paused: body.paused === true, rpc: false });
  } catch {
    return Response.json({ degraded: false, paused: false, rpc: true });
  }
}
