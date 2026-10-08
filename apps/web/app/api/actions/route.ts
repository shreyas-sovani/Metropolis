import { isAddress, getAddress } from "viem";
import { sameActionHashes, type ActionRow } from "../../../lib/actions";
import { jsonError, workerOrigin } from "../../../lib/http";

export const runtime = "nodejs";

/** Every miss is a Durable Object request against the same 100k/day cap as the keeper alarm. */
const CACHE_MS = 5_000;
const CACHE_KEYS = 500;
const cache = new Map<string, { at: number; status: number; body: string }>();

function reply(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

async function load(proxy: string): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(`${workerOrigin()}/actions?account=${proxy}`);
    if (!response.ok) return { status: response.status === 400 ? 400 : 502, body: JSON.stringify({ error: "rpc" }) };
    const body = (await response.json()) as { actions?: ActionRow[] };
    const actions = body.actions ?? [];
    if (!sameActionHashes(actions, actions)) return { status: 500, body: JSON.stringify({ error: "actions" }) };
    return { status: 200, body: JSON.stringify({ account: proxy, actions }) };
  } catch {
    return { status: 502, body: JSON.stringify({ error: "rpc" }) };
  }
}

export async function GET(request: Request): Promise<Response> {
  const account = new URL(request.url).searchParams.get("account");
  if (!account || !isAddress(account)) return jsonError("address", 400);
  const proxy = getAddress(account);
  const hit = cache.get(proxy);
  if (hit && Date.now() - hit.at < CACHE_MS) return reply(hit.status, hit.body);
  const fresh = await load(proxy);
  cache.delete(proxy);
  if (cache.size >= CACHE_KEYS) cache.delete(cache.keys().next().value as string);
  cache.set(proxy, { at: Date.now(), ...fresh });
  return reply(fresh.status, fresh.body);
}
