import { HistoryStore, totalsMatch, type CachedHistory } from "@lifeline/core";
import { jsonError } from "./http";

export async function handleLiquidations(store: HistoryStore, now: number): Promise<Response> {
  try {
    const history = await store.get(now);
    if (!totalsMatch(history)) return jsonError("totals", 500);
    const body: CachedHistory = history;
    return Response.json(body, { headers: { "cache-control": "public, s-maxage=60" } });
  } catch {
    return jsonError("history", 503);
  }
}
