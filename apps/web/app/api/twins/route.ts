import { workerOrigin } from "../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Each upstream call is a Durable Object request plus an RPC multicall over every twin leg. */
const CACHE_MS = 10_000;
let cached: { at: number; body: string } | null = null;

function reply(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  if (cached && Date.now() - cached.at < CACHE_MS) return reply(200, cached.body);
  const response = await fetch(`${workerOrigin()}/twins`);
  const text = await response.text();
  // The panel retries a leg that failed to read. A cached failure would answer every retry.
  cached = response.ok && !text.includes('"distanceError"') ? { at: Date.now(), body: text } : null;
  return reply(response.status, text);
}
