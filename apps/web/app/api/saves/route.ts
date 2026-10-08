import { workerOrigin } from "../../../lib/http";

export const runtime = "nodejs";

/** Landing tabs poll every 10s and the radar every 30s. The counts change on a save, which is rare. */
const CACHE_MS = 30_000;
let cached: { at: number; body: { count: number; watched?: number; saves: unknown[] } } | null = null;

async function load(): Promise<{ count: number; watched?: number; saves: unknown[] }> {
  try {
    const response = await fetch(`${workerOrigin()}/saves`);
    if (!response.ok) return { count: 0, saves: [] };
    const body = (await response.json()) as { count?: number; watched?: number; saves?: unknown[] };
    return { count: body.count ?? 0, watched: body.watched ?? 0, saves: body.saves ?? [] };
  } catch {
    return { count: 0, saves: [] };
  }
}

export async function GET(): Promise<Response> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Response.json(cached.body);
  const body = await load();
  cached = { at: Date.now(), body };
  return Response.json(body);
}
