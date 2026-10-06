import { forfeitCNS, type LiqSplit } from "@lifeline/core";
import { handleAccount } from "../../../../../lib/account-route";
import { jsonError, parseChain } from "../../../../../lib/http";
import { allowRequest } from "../../../../../lib/rate";

export const runtime = "nodejs";

const hits = new Map<string, number[]>();
const DEFAULT_SPLIT: LiqSplit = { userPer100K: 80_000n, insPer100K: 10_000n, protocolPer100K: 10_000n };

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function OPTIONS(): Response {
  return new Response(null, { headers: cors });
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function GET(request: Request, context: { params: Promise<{ address: string }> }): Promise<Response> {
  const ip = clientIp(request);
  const bucket = hits.get(ip) ?? [];
  if (!allowRequest(bucket, Date.now())) {
    hits.set(ip, bucket);
    return Response.json({ error: "rate" }, { status: 429, headers: cors });
  }
  hits.set(ip, bucket);
  const chain = parseChain(new URL(request.url).searchParams.get("chain"));
  if (!chain) return jsonError("chain", 400);
  const { address } = await context.params;
  const account = await handleAccount(chain, address);
  if (!account.ok) return account;
  const body = (await account.json()) as {
    positions: { perpId: number; depositMicro?: string; liquidationPricePNS: string; distanceE6: string; freeCNS: string; dryRun: unknown }[];
    [key: string]: unknown;
  };
  const positions = body.positions.map((position) => ({
    ...position,
    forfeitCNS: forfeitCNS(BigInt(position.depositMicro ?? "0"), DEFAULT_SPLIT).toString(),
  }));
  return Response.json(
    { ...body, positions, penaltyNote: "Insurance and protocol share of the deposit." },
    { headers: cors },
  );
}
