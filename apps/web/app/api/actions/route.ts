import { isAddress, getAddress } from "viem";
import { sameActionHashes, type ActionRow } from "../../../lib/actions";
import { jsonError, workerOrigin } from "../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const account = new URL(request.url).searchParams.get("account");
  if (!account || !isAddress(account)) return jsonError("address", 400);
  const proxy = getAddress(account);
  try {
    const response = await fetch(`${workerOrigin()}/actions?account=${proxy}`);
    if (!response.ok) return jsonError("rpc", response.status === 400 ? 400 : 502);
    const body = (await response.json()) as { actions?: ActionRow[] };
    const actions = body.actions ?? [];
    if (!sameActionHashes(actions, actions)) return jsonError("actions", 500);
    return Response.json({ account: proxy, actions });
  } catch {
    return jsonError("rpc", 502);
  }
}
