import { buildSnapshot, radarSalt, type ChainId } from "@lifeline/core";
import { handleRadar } from "../../../lib/radar";
import { parseChain } from "../../../lib/http";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  const chain = new URL(request.url).searchParams.get("chain");
  return handleRadar({
    chain,
    now: Date.now(),
    load: (chainId: ChainId) => {
      const salt = radarSalt(process.env.RADAR_SALT ?? "");
      const parsed = parseChain(String(chainId));
      if (!parsed) throw new Error("chain");
      return buildSnapshot(parsed, salt);
    },
  });
}
