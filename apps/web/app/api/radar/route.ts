import { CALIBRATED, buildSnapshot, forfeitCNS, radarSalt, type ChainId, type LiqSplit } from "@lifeline/core";
import { formatUsd } from "../../../lib/format";
import { handleRadar } from "../../../lib/radar";
import { parseChain } from "../../../lib/http";
import { historyStore } from "../../../lib/history-store";
import { radarUrls } from "../../../lib/radar-urls";
import { readSecret } from "../../../lib/secrets";

export const runtime = "nodejs";

const MAINNET_SPLIT: LiqSplit = { userPer100K: 80_000n, insPer100K: 10_000n, protocolPer100K: 10_000n };

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const chain = url.searchParams.get("chain");
  const deadPrimary = url.searchParams.get("rpc") === "dead" && process.env.NODE_ENV !== "production";
  const response = await handleRadar({
    chain,
    now: Date.now(),
    load: (chainId: ChainId) => {
      const salt = radarSalt(readSecret("RADAR_SALT"));
      const parsed = parseChain(String(chainId));
      if (!parsed) throw new Error("chain");
      return buildSnapshot(parsed, salt, { urls: radarUrls(parsed, deadPrimary) });
    },
  });
  if (!response.ok) return response;
  const snapshot = (await response.json()) as {
    markets: { atRisk: { depositMicro: string }[] }[];
    headline: unknown;
  };
  let paid = 0n;
  let avoidable = 0n;
  try {
    const history = await historyStore.get(Date.now());
    for (const row of history.rows) {
      const credit = BigInt(row.accAmountCNS || "0");
      const forfeited = forfeitCNS((credit * 100_000n) / MAINNET_SPLIT.userPer100K, MAINNET_SPLIT);
      paid += forfeited;
      if (row.eligible) avoidable += forfeited;
    }
  } catch {
    paid = 0n;
    avoidable = 0n;
  }
  const atStake = snapshot.markets.reduce(
    (sum, market) => sum + market.atRisk.reduce((inner, row) => inner + forfeitCNS(BigInt(row.depositMicro), MAINNET_SPLIT), 0n),
    0n,
  );
  return Response.json(
    {
      ...snapshot,
      calibrated: CALIBRATED,
      penalties: {
        paidUsd: formatUsd(paid.toString()),
        avoidableUsd: formatUsd(avoidable.toString()),
        atStakeUsd: formatUsd(atStake.toString()),
      },
    },
    { headers: { "cache-control": response.headers.get("cache-control") ?? "public, s-maxage=2" } },
  );
}
