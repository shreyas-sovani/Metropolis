import { handleAccount } from "../../../../lib/account-route";
import { jsonError, parseChain } from "../../../../lib/http";

export const runtime = "nodejs";

const CACHE_MS = 2_000;
const cache = new Map<string, { at: number; status: number; body: string }>();

export async function GET(request: Request, context: { params: Promise<{ address: string }> }): Promise<Response> {
  const chain = parseChain(new URL(request.url).searchParams.get("chain"));
  if (!chain) return jsonError("chain", 400);
  const { address } = await context.params;
  const key = `${chain}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json" } });
  }
  const response = await handleAccount(chain, address);
  const body = await response.text();
  cache.set(key, { at: Date.now(), status: response.status, body });
  return new Response(body, { status: response.status, headers: { "content-type": "application/json" } });
}
