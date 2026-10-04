import { readFileSync } from "node:fs";
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
  firstExchangeLogBlock,
  ORDER_OPEN_LONG,
  ORDER_OPEN_SHORT,
  TESTNET_ID,
  bookPricePNS,
  erc20Abi,
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
import { sendContract } from "../send.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";
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

export async function gate4(root = workspaceRoot()): Promise<number> {
  try {
    await historical(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : "historical failed";
    console.log(`historical failed: ${message}`);
  }
  return openCalibration(root);
}

async function historical(root: string): Promise<void> {
  const token = envioToken(root);
  const endpoint = "https://monad.hypersync.xyz";
  const exchange = ADDRESSES[MAINNET_ID].exchange;
  const fetchImpl = fetch;
  const firstBlock = await firstExchangeLogBlock({ endpoint, token, address: exchange, fetchImpl });
  const liquidations = await paginateLogs({
    endpoint,
    token,
    fromBlock: firstBlock,
    address: exchange,
    eventName: "PositionLiquidated",
    fetchImpl,
  });
  const lifecycle = await paginateLogs({
    endpoint,
    token,
    fromBlock: firstBlock,
    address: exchange,
    eventNames: LIFECYCLE_EVENTS,
    fetchImpl,
  });
  const steps = new Map<string, LifecycleStep[]>();
  for (const log of lifecycle.logs) {
    const step = stepFrom(log);
    if (!step) continue;
    const list = steps.get(step.key) ?? [];
    list.push(step.step);
    steps.set(step.key, list);
  }

  const client = createPublicClient({
    chain: CHAINS[MAINNET_ID],
    transport: fallback(rpcUrls(MAINNET_ID).map((url) => http(url, { timeout: 20_000, retryCount: 1 }))),
  });
  const decimals = new Map<string, { price: number; lot: number; mmf: bigint }>();
  const positive: number[] = [];
  const negative: number[] = [];
  let checked = 0;
  for (const log of liquidations.logs) {
    if (checked >= 20) break;
    const event = decodePositionLiquidated(log);
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
    console.log(
      `perp=${event.perpId} account=${event.posAccountId} liq=${event.liqPricePNS} plus=${plus} minus=${minus} err+=${relative(plus, actual).toFixed(6)} err-=${relative(minus, actual).toFixed(6)}`,
    );
  }
  console.log(
    `checked=${checked} medianPlus=${median(positive).toFixed(6)} medianMinus=${median(negative).toFixed(6)}`,
  );
  if (checked < 5) console.log("fewer than 5 reconstructable liquidations");
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
  })) as readonly [{ lotLNS: bigint; depositCNS: bigint; pricePNS: bigint; positionType: number }, bigint, boolean];
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
    args: [PERP_BTC, position[0].lotLNS],
  })) as readonly bigint[];
  const mmf = (fractions[1] ?? 0n) / 100n;
  const priceDecimals = Number(info.priceDecimals);
  const lotDecimals = Number(info.lotDecimals);
  const liq = liquidationPriceMicro({
    side: position[0].positionType === 0 ? 1n : -1n,
    entryMicro: toMicroPrice(position[0].pricePNS, priceDecimals),
    lot: toLot(position[0].lotLNS, lotDecimals),
    depositMicro: position[0].depositCNS,
    fundingMicro: 0n,
    mmf,
  });
  const shown = Number(liq) / Number(MICRO);
  console.log(
    `calibrationAccount=${accountId} side=${position[0].positionType} lot=${position[0].lotLNS} entryPNS=${position[0].pricePNS} depositCNS=${position[0].depositCNS} markPNS=${info.markPNS} ours=${shown.toFixed(2)} mmf=${mmf}`,
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
