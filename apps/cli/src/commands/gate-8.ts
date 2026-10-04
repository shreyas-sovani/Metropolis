import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  MAINNET_ID,
  createReadClient,
  lotSums,
  readExchangeSnapshot,
  rpcUrls,
} from "@lifeline/core";
import { workspaceRoot } from "./keys-generate.js";

const LIMIT_MS = 5_000;
const ATTEMPTS = 3;

function alchemyMainnetUrl(root: string): string | undefined {
  const file = path.join(root, "secrets", "services.env");
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.startsWith("ALCHEMY_MONAD_MAINNET_URL=")) continue;
      const value = line.slice("ALCHEMY_MONAD_MAINNET_URL=".length).trim();
      return value || undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function timedSnapshot(urls: readonly string[]) {
  const client = createReadClient(MAINNET_ID, urls);
  const started = Date.now();
  const markets = await readExchangeSnapshot(client, ADDRESSES[MAINNET_ID].exchange);
  return { markets, ms: Date.now() - started };
}

export async function gate8(root = workspaceRoot()): Promise<number> {
  const publicUrls = rpcUrls(MAINNET_ID);
  const runs = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const run = await timedSnapshot(publicUrls);
    runs.push(run);
    console.log(`attempt ${attempt} ms=${run.ms} markets=${run.markets.length}`);
  }
  const best = runs.reduce((left, right) => (right.ms < left.ms ? right : left));
  console.log(`best ms=${best.ms} limit=${LIMIT_MS}`);
  if (best.ms > LIMIT_MS) {
    const alchemy = alchemyMainnetUrl(root);
    if (!alchemy) {
      console.error("snapshot slower than 5s and ALCHEMY_MONAD_MAINNET_URL is unset");
      return 1;
    }
    console.log("retrying with Alchemy fallback");
    const retry = await timedSnapshot(rpcUrls(MAINNET_ID, alchemy));
    console.log(`alchemy ms=${retry.ms}`);
    if (retry.ms > LIMIT_MS) return 1;
    return report(retry.markets) ? 0 : 1;
  }
  return report(best.markets) ? 0 : 1;
}

function report(
  markets: Awaited<ReturnType<typeof readExchangeSnapshot>>,
): boolean {
  let ok = true;
  let positions = 0;
  for (const market of markets) {
    const sums = lotSums(market.positions);
    const interestOk =
      sums.longOpenInterestLNS === market.info.longOpenInterestLNS &&
      sums.shortOpenInterestLNS === market.info.shortOpenInterestLNS;
    const countOk = market.numPositions === BigInt(market.positions.length);
    positions += market.positions.length;
    console.log(
      `${market.info.symbol} perp=${market.info.perpId} positions=${market.positions.length} numPositions=${market.numPositions} long=${sums.longOpenInterestLNS} oiLong=${market.info.longOpenInterestLNS} short=${sums.shortOpenInterestLNS} oiShort=${market.info.shortOpenInterestLNS} interest=${interestOk} count=${countOk}`,
    );
    if (!interestOk || !countOk) ok = false;
  }
  console.log(`positions=${positions} markets=${markets.length} ok=${ok}`);
  return ok;
}
