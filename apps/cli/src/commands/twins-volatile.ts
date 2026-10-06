import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  HYPERSYNC_ENDPOINTS,
  TESTNET_ID,
  eventTopic0,
  exchangeAbi,
  listPerps,
  paginateLogs,
} from "@lifeline/core";
import { decodeEventLog } from "viem";
import { rankMarkets, returnVariance, VOLATILE_CANDIDATES } from "../mark-rank.js";
import { testnetPublicClient } from "../testnet.js";
import { twinsCreate, type TwinSpec } from "./twins-create.js";
import { workspaceRoot } from "./keys-generate.js";

const WINDOW_BLOCKS = 20_000;
const MAX_LEVERAGE_CAP = 100_000n;

export async function twinsVolatile(root = workspaceRoot()): Promise<number> {
  const token = envioToken(root);
  const client = testnetPublicClient();
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const perps = await listPerps(client, exchange);
  const wanted = new Map<number, string>();
  for (const perp of perps) {
    const symbol = perp.symbol.toUpperCase();
    if ((VOLATILE_CANDIDATES as readonly string[]).includes(symbol)) wanted.set(perp.perpId, symbol);
  }
  if (wanted.size < 2) {
    console.error(`need two of ${VOLATILE_CANDIDATES.join(", ")}; found ${[...wanted.values()].join(", ") || "none"}`);
    return 1;
  }
  const head = Number(await client.getBlockNumber());
  const fromBlock = Math.max(0, head - WINDOW_BLOCKS);
  console.error(`mark window ${fromBlock}-${head} markets=${[...wanted.values()].join(",")}`);
  const scanned = await paginateLogs({
    endpoint: HYPERSYNC_ENDPOINTS[TESTNET_ID],
    token,
    fromBlock,
    address: exchange,
    eventName: "MarkUpdated",
    fetchImpl: fetch,
  });
  const prices = new Map<string, bigint[]>();
  for (const symbol of wanted.values()) prices.set(symbol, []);
  for (const log of scanned.logs) {
    if (log.topic0.toLowerCase() !== eventTopic0("MarkUpdated").toLowerCase()) continue;
    const decoded = decodeEventLog({ abi: exchangeAbi, data: log.data, topics: [log.topic0] });
    if (decoded.eventName !== "MarkUpdated") continue;
    const args = decoded.args as { perpId?: bigint; pricePNS?: bigint };
    if (args.perpId === undefined || args.pricePNS === undefined) continue;
    const symbol = wanted.get(Number(args.perpId));
    if (!symbol) continue;
    prices.get(symbol)?.push(args.pricePNS);
  }
  const ranked = rankMarkets([...prices.entries()].map(([symbol, series]) => ({ symbol, prices: series })));
  for (const row of ranked) {
    console.log(`${row.symbol} variance=${row.variance.toExponential(4)} samples=${row.samples}`);
  }
  const missing = [...wanted.values()].filter((symbol) => returnVariance(prices.get(symbol) ?? []) === null);
  if (missing.length > 0) console.log(`unranked ${missing.join(",")} samples<3`);
  const top = ranked.slice(0, 2);
  if (top.length < 2 || top[0] === undefined || top[1] === undefined) {
    console.error("fewer than two ranked markets");
    return 1;
  }
  const specs: TwinSpec[] = [
    { id: `${top[0].symbol.toLowerCase()}-long`, market: top[0].symbol, side: "long", cap: MAX_LEVERAGE_CAP },
    { id: `${top[1].symbol.toLowerCase()}-short`, market: top[1].symbol, side: "short", cap: MAX_LEVERAGE_CAP },
  ];
  console.log(`opening ${specs.map((spec) => spec.id).join(" ")}`);
  return twinsCreate(root, specs);
}

function envioToken(root: string): string {
  for (const line of readFileSync(path.join(root, "secrets", "services.env"), "utf8").split("\n")) {
    if (!line.startsWith("ENVIO_API_TOKEN=")) continue;
    const token = line.slice("ENVIO_API_TOKEN=".length).trim();
    if (token) return token;
  }
  throw new Error("ENVIO_API_TOKEN missing");
}
