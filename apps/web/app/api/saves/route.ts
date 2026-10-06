import { workerOrigin } from "../../../lib/http";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const response = await fetch(`${workerOrigin()}/saves`);
    if (!response.ok) return Response.json({ count: 0, saves: [] });
    const body = (await response.json()) as { count?: number; saves?: unknown[] };
    return Response.json({ count: body.count ?? 0, saves: body.saves ?? [] });
  } catch {
    return Response.json({ count: 0, saves: [] });
  }
}
