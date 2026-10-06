import { handleAccount } from "../../../../lib/account-route";
import { jsonError, parseChain } from "../../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ address: string }> }): Promise<Response> {
  const chain = parseChain(new URL(request.url).searchParams.get("chain"));
  if (!chain) return jsonError("chain", 400);
  const { address } = await context.params;
  return handleAccount(chain, address);
}
