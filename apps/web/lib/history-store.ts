import {
  ADDRESSES,
  HistoryStore,
  MAINNET_ID,
  blocksForDays,
  exchangeAbi,
  liquidationHistory,
  listPerps,
  openChain,
  rpcUrls,
  type HistoryPage,
  type MarketScale,
} from "@lifeline/core";

const SCALE_MS = 60 * 60 * 1000;
let scalesAt = 0;
let scales = new Map<string, MarketScale>();
let windowAt = 0;
let windowStart = 0;

async function chain() {
  return openChain(MAINNET_ID, { urls: rpcUrls(MAINNET_ID), timeout: 8_000 });
}

async function marketScales(): Promise<Map<string, MarketScale>> {
  if (scales.size > 0 && Date.now() - scalesAt < SCALE_MS) return scales;
  const api = await chain();
  const exchange = ADDRESSES[MAINNET_ID].exchange;
  const perps = await listPerps(api.client, exchange);
  const next = new Map<string, MarketScale>();
  for (const perp of perps) {
    next.set(String(perp.perpId), {
      priceDecimals: perp.priceDecimals,
      lotDecimals: perp.lotDecimals,
      symbol: perp.symbol || perp.name,
    });
  }
  scales = next;
  scalesAt = Date.now();
  return scales;
}

async function thirtyDayStart(): Promise<number> {
  if (windowStart > 0 && Date.now() - windowAt < SCALE_MS) return windowStart;
  const api = await chain();
  const latest = await api.client.getBlockNumber();
  const earlier = latest > 5_000n ? latest - 5_000n : 0n;
  const [tip, prior] = await Promise.all([
    api.client.getBlock({ blockNumber: latest }),
    api.client.getBlock({ blockNumber: earlier }),
  ]);
  const span = blocksForDays(latest, tip.timestamp, earlier, prior.timestamp, 30);
  windowStart = Number(latest > span ? latest - span : 0n);
  windowAt = Date.now();
  return windowStart;
}

async function resolveScale(perpId: string): Promise<MarketScale | null> {
  const cached = scales.get(perpId);
  if (cached) return cached;
  const api = await chain();
  const exchange = ADDRESSES[MAINNET_ID].exchange;
  const info = (await api.client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfoV2",
    args: [BigInt(perpId)],
  })) as { priceDecimals: bigint; lotDecimals: bigint; symbol?: string };
  const scale = {
    priceDecimals: Number(info.priceDecimals),
    lotDecimals: Number(info.lotDecimals),
    symbol: typeof info.symbol === "string" && info.symbol.length > 0 ? info.symbol : "",
  };
  scales.set(perpId, scale);
  return scale;
}

async function load(cursor: number): Promise<HistoryPage> {
  const token = process.env.ENVIO_API_TOKEN ?? "";
  const scaleMap = await marketScales();
  const start = await thirtyDayStart();
  const fromBlock = Math.max(cursor, start);
  const history = await liquidationHistory({
    chainId: MAINNET_ID,
    days: 30,
    token,
    fromBlock,
    scales: scaleMap,
    retryOnRateLimit: false,
    resolveScale,
    fetchImpl: async (url, init) => {
      const response = await fetch(url, init);
      return {
        status: response.status,
        headers: response.headers,
        json: () => response.json(),
      };
    },
  });
  const tip = history.rows.reduce((max, row) => Math.max(max, row.blockNumber), fromBlock);
  return { rows: history.rows.filter((row) => row.blockNumber >= start), cursor: tip + 1, minBlock: start };
}

/** Durable for the life of this server. A 429 or other error serves the last good payload. */
export const historyStore = new HistoryStore(load, 0);
