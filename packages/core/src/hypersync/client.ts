import type { Address } from "viem";
import type { HyperSyncLog } from "./decode.js";
import { eventTopic0, type HyperSyncEventName } from "./topics.js";

export interface HyperSyncFetch {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<{ status: number; json: () => Promise<unknown> }>;
}

export interface HyperSyncPage {
  status: number;
  nextBlock: number;
  archiveHeight: number | null;
  logs: HyperSyncLog[];
}

interface RawPage {
  next_block?: number;
  archive_height?: number;
  data?: Array<{ logs?: HyperSyncLog[] }>;
}

export async function queryHyperSync(input: {
  endpoint: string;
  token: string;
  body: unknown;
  fetchImpl?: HyperSyncFetch;
}): Promise<HyperSyncPage> {
  const fetchImpl = input.fetchImpl;
  if (!fetchImpl) throw new Error("fetchImpl is required");
  let response = await fetchImpl(`${input.endpoint.replace(/\/$/, "")}/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify(input.body),
  });
  for (let attempt = 0; response.status === 429 && attempt < 5; attempt += 1) {
    await new Promise<void>((resolve) => {
      const timer = (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout;
      timer(resolve, 1_000 * 2 ** attempt);
    });
    response = await fetchImpl(`${input.endpoint.replace(/\/$/, "")}/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify(input.body),
    });
  }
  if (response.status !== 200) {
    throw new Error(`hypersync status ${response.status}`);
  }
  const raw = (await response.json()) as RawPage;
  const logs: HyperSyncLog[] = [];
  for (const group of raw.data ?? []) logs.push(...(group.logs ?? []));
  if (typeof raw.next_block !== "number") throw new Error("hypersync response missing next_block");
  return {
    status: response.status,
    nextBlock: raw.next_block,
    archiveHeight: typeof raw.archive_height === "number" ? raw.archive_height : null,
    logs,
  };
}

export async function paginateLogs(input: {
  endpoint: string;
  token: string;
  fromBlock: number;
  address: Address;
  eventName?: string;
  eventNames?: readonly string[];
  fetchImpl?: HyperSyncFetch;
}): Promise<{ logs: HyperSyncLog[]; pages: number; archiveHeight: number; nextBlock: number }> {
  let fromBlock = input.fromBlock;
  let archiveHeight = Number.POSITIVE_INFINITY;
  const logs: HyperSyncLog[] = [];
  let pages = 0;
  while (fromBlock < archiveHeight) {
    const body: Record<string, unknown> = {
      from_block: fromBlock,
      logs: [
        {
          address: [input.address],
          ...(input.eventNames
            ? { topics: [input.eventNames.map((name) => eventTopic0(name))] }
            : input.eventName
              ? { topics: [[eventTopic0(input.eventName)]] }
              : {}),
        },
      ],
      field_selection: { log: ["block_number", "log_index", "data", "topic0"] },
    };
    const page = await queryHyperSync({
      endpoint: input.endpoint,
      token: input.token,
      body,
      fetchImpl: input.fetchImpl,
    });
    pages += 1;
    if (page.archiveHeight !== null) archiveHeight = page.archiveHeight;
    logs.push(...page.logs);
    if (page.nextBlock <= fromBlock) break;
    fromBlock = page.nextBlock;
    if (pages > 400) throw new Error("hypersync pagination exceeded 400 pages");
  }
  return { logs, pages, archiveHeight, nextBlock: fromBlock };
}

export async function firstExchangeLogBlock(input: {
  endpoint: string;
  token: string;
  address: Address;
  fetchImpl?: HyperSyncFetch;
}): Promise<number> {
  let fromBlock = 0;
  let archiveHeight = Number.POSITIVE_INFINITY;
  for (let pageNumber = 0; pageNumber < 50 && fromBlock < archiveHeight; pageNumber += 1) {
    const page = await queryHyperSync({
      endpoint: input.endpoint,
      token: input.token,
      fetchImpl: input.fetchImpl,
      body: {
        from_block: fromBlock,
        logs: [{ address: [input.address] }],
        field_selection: { log: ["block_number"] },
      },
    });
    if (page.archiveHeight !== null) archiveHeight = page.archiveHeight;
    if (page.logs.length > 0) {
      return Math.min(...page.logs.map((log) => log.block_number));
    }
    if (page.nextBlock <= fromBlock) break;
    fromBlock = page.nextBlock;
  }
  throw new Error("no Exchange logs before the HyperSync head");
}
