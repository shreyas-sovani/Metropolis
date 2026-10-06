import { HistoryStore, liquidationHistory, MAINNET_ID, type HistoryPage } from "@lifeline/core";

async function load(cursor: number): Promise<HistoryPage> {
  const token = process.env.ENVIO_API_TOKEN ?? "";
  const history = await liquidationHistory({
    chainId: MAINNET_ID,
    days: 30,
    token,
    fromBlock: cursor,
    scales: new Map(),
    retryOnRateLimit: false,
    fetchImpl: async (url, init) => {
      const response = await fetch(url, init);
      return {
        status: response.status,
        headers: response.headers,
        json: () => response.json(),
      };
    },
  });
  const tip = history.rows.reduce((max, row) => Math.max(max, row.blockNumber), cursor);
  return { rows: history.rows, cursor: tip + 1 };
}

/** Durable for the life of this server. A 429 or other error serves the last good payload. */
export const historyStore = new HistoryStore(load, 0);
