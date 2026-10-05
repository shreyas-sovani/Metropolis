import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  GAS_LIMITS,
  LIFECYCLE_EVENTS,
  LOT_SCALE,
  MAINNET_ID,
  MICRO,
  decodeIncreasePositionCollateral,
  decodePositionDecreased,
  decodePositionIncreased,
  decodePositionLiquidated,
  decodePositionOpened,
  eventTopic0,
  exchangeAbi,
  ORDER_OPEN_LONG,
  ORDER_OPEN_SHORT,
  TESTNET_ID,
  bookPricePNS,
  erc20Abi,
  liquidationMicroFromContract,
  liquidationPriceMicro,
  orderDesc,
  paginateLogs,
  restingAskPricePNS,
  replayPosition,
  type HyperSyncLog,
  type LifecycleStep,
} from "@lifeline/core";
import { CHAINS, rpcUrls } from "@lifeline/core";
import { ContractFunctionRevertedError, createPublicClient, fallback, getAddress, http } from "viem";
import { loadRoles } from "../roles.js";
import { parseForkArgs } from "../fork-truth.js";
import { sendContract } from "../send.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";
import { gate4Fork } from "./gate-4-fork.js";
import { workspaceRoot } from "./keys-generate.js";

const PERP_BTC = 16n;
const OPEN_AUSD = 1_000n * MICRO;

function envioToken(root: string): string {
  for (const line of readFileSync(path.join(root, "secrets", "services.env"), "utf8").split("\n")) {
    if (line.startsWith("ENVIO_API_TOKEN=")) {
      const token = line.slice("ENVIO_API_TOKEN=".length).trim();
      if (token) return token;
    }
  }
  throw new Error("ENVIO_API_TOKEN missing");
}

async function archiveHeight(endpoint: string, token: string, exchange: string): Promise<number> {
  const response = await fetch(`${endpoint}/query`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      from_block: 0,
      to_block: 1,
      logs: [{ address: [exchange] }],
      field_selection: { log: ["block_number"] },
    }),
  });
  if (!response.ok) throw new Error(`hypersync status ${response.status}`);
  const body = (await response.json()) as { archive_height?: number };
  if (typeof body.archive_height !== "number") throw new Error("hypersync missing archive height");
  return body.archive_height;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  const lower = sorted[mid - 1] ?? upper;
  return sorted.length % 2 === 1 ? upper : (lower + upper) / 2;
}

function toMicroPrice(pricePNS: bigint, decimals: number): bigint {
  return (pricePNS * MICRO) / 10n ** BigInt(decimals);
}

function toLot(lotLNS: bigint, decimals: number): bigint {
  return (lotLNS * LOT_SCALE) / 10n ** BigInt(decimals);
}

export async function gate4(root = workspaceRoot(), argv: readonly string[] = []): Promise<number> {
  let chains: ReturnType<typeof parseForkArgs>;
  try {
    chains = parseForkArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "bad gate:4 args");
    return 1;
  }
  if (chains) return gate4Fork(root, chains);
  const historicalCode = await historical(root);
  const calibrationCode = await openCalibration(root);
  return historicalCode === 0 && calibrationCode === 0 ? 0 : 1;
}

async function historical(root: string): Promise<number> {
  const token = envioToken(root);
  const endpoint = "https://monad.hypersync.xyz";
  const exchange = ADDRESSES[MAINNET_ID].exchange;
  const head = await archiveHeight(endpoint, token, exchange);
  const liqLogs = await queryLogs(endpoint, token, exchange, 108_000_000, head, [
    eventTopic0("PositionLiquidated"),
  ]);
  const events = liqLogs.map((log) => decodePositionLiquidated(log));
  const wanted = new Set(events.map((event) => `${event.posAccountId}:${event.perpId}`));
  console.error(`historical liquidations=${events.length} keys=${wanted.size} head=${head}`);
  const saved = loadProgress(root);
  const steps = saved.steps;
  const topics = LIFECYCLE_EVENTS.map((name) => eventTopic0(name));
  let from = saved.from;
  const end = 108_000_000;
  while (from < end) {
    const page = await queryOnce(endpoint, token, exchange, from, end, topics);
    let kept = 0;
    for (const log of page.logs) {
      const step = stepFrom(log);
      if (!step || !wanted.has(step.key)) continue;
      const list = steps.get(step.key) ?? [];
      list.push(step.step);
      steps.set(step.key, list);
      kept += 1;
    }
    from = page.next <= from ? from + 1 : Math.min(page.next, end);
    saveProgress(root, from, steps);
    console.error(
      `scan at=${from} pageLogs=${page.logs.length} kept=${kept} ready=${replayedCount(events, steps)} budget=${page.remaining ?? "?"}`,
    );
    if (page.remaining !== undefined && page.cost !== undefined && page.remaining < page.cost) {
      await sleep((page.resetSecs ?? 60) * 1000);
    }
  }

  const client = createPublicClient({
    chain: CHAINS[MAINNET_ID],
    transport: fallback(rpcUrls(MAINNET_ID).map((url) => http(url, { timeout: 20_000, retryCount: 1 }))),
  });
  const decimals = new Map<string, { price: number; lot: number; mmf: bigint }>();
  const positive: number[] = [];
  const negative: number[] = [];
  let checked = 0;
  for (const event of events) {
    if (checked >= 20) break;
    const key = `${event.posAccountId}:${event.perpId}`;
    const replayed = replayPosition(steps.get(key) ?? [], event.blockNumber);
    if (!replayed || event.liqPricePNS === 0n) continue;
    const scale = await marketScale(client, exchange, event.perpId, decimals);
    const shared = {
      side: replayed.side,
      entryMicro: toMicroPrice(replayed.entryPNS, scale.price),
      lot: toLot(replayed.lotLNS, scale.lot),
      depositMicro: replayed.depositCNS,
      mmf: scale.mmf,
    };
    const actual = toMicroPrice(event.liqPricePNS, scale.price);
    if (actual === 0n || shared.lot === 0n) continue;
    const plus = liquidationPriceMicro({ ...shared, fundingMicro: event.fundingCNS });
    const minus = liquidationPriceMicro({ ...shared, fundingMicro: -event.fundingCNS });
    positive.push(relative(plus, actual));
    negative.push(relative(minus, actual));
    checked += 1;
    console.error(
      `perp=${event.perpId} account=${event.posAccountId} liq=${event.liqPricePNS} plus=${plus} minus=${minus} err+=${relative(plus, actual).toFixed(6)} err-=${relative(minus, actual).toFixed(6)}`,
    );
  }
  const best = Math.min(median(positive), median(negative));
  console.error(
    `checked=${checked} medianPlus=${median(positive).toFixed(6)} medianMinus=${median(negative).toFixed(6)} best=${best.toFixed(6)}`,
  );
  if (checked < 5) {
    console.error("fewer than 5 reconstructable liquidations");
    return 1;
  }
  return best <= 0.001 ? 0 : 1;
}

function replayedCount(
  events: { posAccountId: bigint; perpId: bigint; blockNumber: number; liqPricePNS: bigint }[],
  steps: Map<string, LifecycleStep[]>,
): number {
  let count = 0;
  for (const event of events) {
    if (count >= 20) break;
    const replayed = replayPosition(steps.get(`${event.posAccountId}:${event.perpId}`) ?? [], event.blockNumber);
    if (replayed && event.liqPricePNS > 0n) count += 1;
  }
  return count;
}

async function queryLogs(
  endpoint: string,
  token: string,
  exchange: string,
  fromBlock: number,
  toBlock: number,
  topics: string[],
): Promise<HyperSyncLog[]> {
  const logs: HyperSyncLog[] = [];
  let from = fromBlock;
  while (from < toBlock) {
    const page = await queryOnce(endpoint, token, exchange, from, toBlock, topics);
    logs.push(...page.logs);
    if (page.next >= toBlock || page.next <= from) break;
    from = page.next;
    await sleep(350);
  }
  return logs;
}

async function queryOnce(
  endpoint: string,
  token: string,
  exchange: string,
  fromBlock: number,
  toBlock: number,
  topics: string[],
): Promise<{ logs: HyperSyncLog[]; next: number; remaining?: number; cost?: number; resetSecs?: number }> {
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(`${endpoint}/query`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          from_block: fromBlock,
          to_block: toBlock,
          logs: [{ address: [exchange], topics: [topics] }],
          field_selection: { log: ["block_number", "log_index", "data", "topic0"] },
        }),
      });
    } catch (error) {
      console.error(`hypersync timeout ${fromBlock}-${toBlock} ${error instanceof Error ? error.name : "error"}`);
      await sleep(3_000);
      continue;
    } finally {
      clearTimeout(timer);
    }
    const limit = rateHeaders(response);
    if (response.status === 429) {
      const wait = (limit.resetSecs ?? 60) + 1;
      console.error(`hypersync 429 ${fromBlock} wait=${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`hypersync status ${response.status}`);
    const body = (await response.json()) as {
      next_block?: number;
      data?: { logs?: HyperSyncLog[] }[];
    };
    const logs = (body.data ?? []).flatMap((group) => group.logs ?? []);
    return { logs, next: body.next_block ?? toBlock, ...limit };
  }
}

function rateHeaders(response: Response): { remaining?: number; cost?: number; resetSecs?: number } {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  const cost = Number(response.headers.get("x-ratelimit-cost"));
  const resetSecs = Number(response.headers.get("x-ratelimit-reset"));
  return {
    remaining: Number.isFinite(remaining) ? remaining : undefined,
    cost: Number.isFinite(cost) ? cost : undefined,
    resetSecs: Number.isFinite(resetSecs) ? resetSecs : undefined,
  };
}

function progressPath(root: string): string {
  return path.join(root, "cli-state", "gate-4-progress.json");
}

function loadProgress(root: string): { from: number; steps: Map<string, LifecycleStep[]> } {
  try {
    const parsed = JSON.parse(readFileSync(progressPath(root), "utf8")) as {
      from: number;
      steps: Record<string, LifecycleStep[]>;
    };
    const steps = new Map<string, LifecycleStep[]>();
    for (const [key, list] of Object.entries(parsed.steps)) {
      steps.set(key, list.map(reviveStep));
    }
    return { from: parsed.from, steps };
  } catch {
    return { from: 54_000_000, steps: new Map() };
  }
}

function saveProgress(root: string, from: number, steps: Map<string, LifecycleStep[]>): void {
  const dir = path.join(root, "cli-state");
  mkdirSync(dir, { recursive: true });
  const encoded: Record<string, unknown[]> = {};
  for (const [key, list] of steps) encoded[key] = list.map(freezeStep);
  writeFileSync(progressPath(root), JSON.stringify({ from, steps: encoded }));
}

function freezeStep(step: LifecycleStep): Record<string, string | number> {
  const out: Record<string, string | number> = { kind: step.kind, block: step.block, index: step.index };
  for (const [key, value] of Object.entries(step)) {
    if (key === "kind" || key === "block" || key === "index") continue;
    out[key] = typeof value === "bigint" ? value.toString() : (value as number);
  }
  return out;
}

function reviveStep(raw: LifecycleStep): LifecycleStep {
  const step = { ...raw } as Record<string, unknown>;
  for (const key of Object.keys(step)) {
    if (key === "kind" || key === "block" || key === "index" || key === "positionType") continue;
    if (typeof step[key] === "string") step[key] = BigInt(step[key] as string);
  }
  return step as LifecycleStep;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout(resolve, ms);
  });
}

function relative(ours: bigint, actual: bigint): number {
  const delta = ours > actual ? ours - actual : actual - ours;
  return Number(delta) / Number(actual);
}

function stepFrom(log: HyperSyncLog): { key: string; step: LifecycleStep } | null {
  const topic = log.topic0.toLowerCase();
  if (topic === eventTopic0("PositionOpened").toLowerCase()) {
    const event = decodePositionOpened(log);
    return {
      key: `${event.accountId}:${event.perpId}`,
      step: {
        kind: "open",
        block: event.blockNumber,
        index: event.logIndex,
        positionType: event.positionType,
        pricePNS: event.pricePNS,
        lotLNS: event.lotLNS,
        depositCNS: event.depositCNS,
      },
    };
  }
  if (topic === eventTopic0("PositionIncreased").toLowerCase()) {
    const event = decodePositionIncreased(log);
    return {
      key: `${event.accountId}:${event.perpId}`,
      step: {
        kind: "increase",
        block: event.blockNumber,
        index: event.logIndex,
        pricePNS: event.pricePNS,
        startLotLNS: event.startLotLNS,
        endLotLNS: event.endLotLNS,
        endDepositCNS: event.endDepositCNS,
      },
    };
  }
  if (topic === eventTopic0("PositionDecreased").toLowerCase()) {
    const event = decodePositionDecreased(log);
    return {
      key: `${event.accountId}:${event.perpId}`,
      step: {
        kind: "decrease",
        block: event.blockNumber,
        index: event.logIndex,
        endLotLNS: event.endLotLNS,
        endDepositCNS: event.endDepositCNS,
      },
    };
  }
  if (topic === eventTopic0("IncreasePositionCollateral").toLowerCase()) {
    const event = decodeIncreasePositionCollateral(log);
    return {
      key: `${event.accountId}:${event.perpId}`,
      step: {
        kind: "collateral",
        block: event.blockNumber,
        index: event.logIndex,
        depositCNS: event.positionDepositCNS,
      },
    };
  }
  return null;
}

async function marketScale(
  client: ReturnType<typeof createPublicClient>,
  exchange: `0x${string}`,
  perpId: bigint,
  cache: Map<string, { price: number; lot: number; mmf: bigint }>,
) {
  const key = perpId.toString();
  const cached = cache.get(key);
  if (cached) return cached;
  const info = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfoV2",
    args: [perpId],
  })) as { priceDecimals: bigint; lotDecimals: bigint };
  const fractions = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getMarginFractions",
    args: [perpId, 1n],
  })) as readonly bigint[];
  const maint = fractions[1] ?? 0n;
  const scale = {
    price: Number(info.priceDecimals),
    lot: Number(info.lotDecimals),
    mmf: maint / 100n,
  };
  cache.set(key, scale);
  return scale;
}

async function openCalibration(root: string): Promise<number> {
  const roles = loadRoles(root);
  const calibration = roles.CALIBRATION;
  const maker = roles.MAKER;
  const client = testnetPublicClient();
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const ausd = ADDRESSES[TESTNET_ID].ausd;
  if (!ausd) throw new Error("testnet AUSD missing");
  console.log(`calibration ${calibration.address}`);

  let accountId = await accountIdOf(client, exchange, calibration.address);
  if (accountId === null) {
    const allowance = (await client.readContract({
      address: ausd,
      abi: erc20Abi,
      functionName: "allowance",
      args: [calibration.address, exchange],
    })) as bigint;
    if (allowance < OPEN_AUSD) {
      await sendContract({
        client,
        wallet: testnetWallet(calibration),
        account: calibration,
        address: ausd,
        abi: erc20Abi,
        functionName: "approve",
        args: [exchange, OPEN_AUSD],
        kind: "ausd.approve",
        gas: GAS_LIMITS.ausdTransfer,
      });
    }
    await sendContract({
      client,
      wallet: testnetWallet(calibration),
      account: calibration,
      address: exchange,
      abi: exchangeAbi,
      functionName: "createAccount",
      args: [OPEN_AUSD],
      kind: "calibration.createAccount",
      gas: GAS_LIMITS.createAccount,
    });
    accountId = await accountIdOf(client, exchange, calibration.address);
  }
  if (accountId === null) return 1;

  const existing = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPositionV2",
    args: [PERP_BTC, accountId],
  })) as readonly [{ lotLNS: bigint; depositCNS: bigint; pricePNS: bigint; positionType: number }, bigint, boolean];
  if (existing[0].lotLNS === 0n) {
    const info = (await client.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getPerpetualInfoV2",
      args: [PERP_BTC],
    })) as {
      markPNS: bigint;
      basePricePNS: bigint;
      maxBidPriceONS: bigint;
      minAskPriceONS: bigint;
    };
    const ask = restingAskPricePNS({
      markPNS: info.markPNS,
      basePricePNS: info.basePricePNS,
      maxBidPriceONS: info.maxBidPriceONS,
      minAskPriceONS: info.minAskPriceONS,
    });
    await sendContract({
      client,
      wallet: testnetWallet(maker),
      account: maker,
      address: exchange,
      abi: exchangeAbi,
      functionName: "execOrder",
      args: [
        orderDesc({
          perpId: PERP_BTC,
          orderType: ORDER_OPEN_SHORT,
          pricePNS: ask,
          lotLNS: 100n,
          leverageHdths: 1500n,
          postOnly: true,
        }),
      ],
      kind: "maker.postOnly",
      gas: GAS_LIMITS.execOrderOpen,
    });
    await sendContract({
      client,
      wallet: testnetWallet(calibration),
      account: calibration,
      address: exchange,
      abi: exchangeAbi,
      functionName: "execOrder",
      args: [
        orderDesc({
          perpId: PERP_BTC,
          orderType: ORDER_OPEN_LONG,
          pricePNS: ask,
          lotLNS: 100n,
          leverageHdths: 1500n,
          immediateOrCancel: true,
          maxMatches: 1n,
        }),
      ],
      kind: "calibration.iocOpen",
      gas: GAS_LIMITS.execOrderOpen,
    });
  }

  const position = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPositionV2",
    args: [PERP_BTC, accountId],
  })) as readonly [
    {
      lotLNS: bigint;
      depositCNS: bigint;
      pricePNS: bigint;
      positionType: number;
      premiumPnlCNS: bigint;
    },
    bigint,
    boolean,
  ];
  const info = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfoV2",
    args: [PERP_BTC],
  })) as { priceDecimals: bigint; lotDecimals: bigint; markPNS: bigint };
  const fractions = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getMarginFractions",
    args: [PERP_BTC, 0n],
  })) as readonly bigint[];
  const maintHdths = fractions[1] ?? 0n;
  const priceDecimals = Number(info.priceDecimals);
  const lotDecimals = Number(info.lotDecimals);
  const liq = liquidationMicroFromContract(
    {
      positionType: position[0].positionType,
      pricePNS: position[0].pricePNS,
      lotLNS: position[0].lotLNS,
      depositCNS: position[0].depositCNS,
      premiumPnlCNS: position[0].premiumPnlCNS,
    },
    { priceDecimals, lotDecimals, maintHdths },
  );
  const shown = Number(liq) / Number(MICRO);
  console.log(
    `calibrationAccount=${accountId} side=${position[0].positionType} lot=${position[0].lotLNS} entryPNS=${position[0].pricePNS} depositCNS=${position[0].depositCNS} markPNS=${info.markPNS} ours=${shown.toFixed(2)} maintHdths=${maintHdths}`,
  );
  console.log(`address ${getAddress(calibration.address)}`);
  return position[0].lotLNS > 0n ? 0 : 1;
}

async function accountIdOf(
  client: ReturnType<typeof testnetPublicClient>,
  exchange: `0x${string}`,
  account: `0x${string}`,
): Promise<bigint | null> {
  try {
    const info = (await client.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getAccountByAddr",
      args: [account],
    })) as { accountId: bigint };
    return info.accountId;
  } catch (error) {
    if (error instanceof ContractFunctionRevertedError) return null;
    const message = error instanceof Error ? error.message : "";
    if (message.includes("reverted")) return null;
    throw error;
  }
}
