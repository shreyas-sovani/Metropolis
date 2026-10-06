import type { Address } from "viem";
import { ADDRESSES } from "../config/addresses.js";
import { HYPERSYNC_ENDPOINTS, type ChainId } from "../config/chains.js";
import { lotToScaled, notionalMicro, priceToMicro } from "../math/liquidation.js";
import { paginateLogs, type HyperSyncFetch } from "./client.js";
import {
  decodeIncreasePositionCollateral,
  decodePositionLiquidated,
  type IncreasePositionCollateralEvent,
  type PositionLiquidatedEvent,
} from "./decode.js";

export interface MarketScale {
  priceDecimals: number;
  lotDecimals: number;
}

export interface LiquidationRow {
  blockNumber: number;
  perpId: string;
  positionType: number;
  idleAtLiq: string;
  eligible: boolean;
  notionalMicro: string;
  posDepositCNS: string;
  markPricePNS: string;
  liqLotLNS: string;
}

export interface LiquidationHistory {
  rows: LiquidationRow[];
  latest: LiquidationRow[];
  totals: { count: number; notionalMicro: string; idleAtLiq: string };
  eligible: { count: number; notionalMicro: string };
}

export interface LifelineAction {
  blockNumber: number;
  logIndex: number;
  perpId: string;
  accountId: string;
  amountCNS: string;
  positionDepositCNS: string;
  balanceCNS: string;
}

export function idleAtLiquidation(event: PositionLiquidatedEvent): bigint {
  const credited = event.accAmountCNS > 0n ? event.accAmountCNS : 0n;
  return event.accBalanceCNS - credited;
}

export function summarizeLiquidations(
  events: readonly PositionLiquidatedEvent[],
  scales: ReadonlyMap<string, MarketScale>,
): LiquidationHistory {
  const rows = [...events]
    .sort((a, b) => a.blockNumber - b.blockNumber)
    .map((event) => {
      const scale = scales.get(event.perpId.toString());
      const priceDecimals = scale?.priceDecimals ?? 0;
      const lotDecimals = scale?.lotDecimals ?? 0;
      const notional = notionalMicro(
        priceToMicro(event.markPricePNS, priceDecimals),
        lotToScaled(event.liqLotLNS, lotDecimals),
      );
      const idle = idleAtLiquidation(event);
      return {
        blockNumber: event.blockNumber,
        perpId: event.perpId.toString(),
        positionType: event.positionType,
        idleAtLiq: idle.toString(),
        eligible: idle >= event.posDepositCNS,
        notionalMicro: notional.toString(),
        posDepositCNS: event.posDepositCNS.toString(),
        markPricePNS: event.markPricePNS.toString(),
        liqLotLNS: event.liqLotLNS.toString(),
      };
    });
  let notional = 0n;
  let idle = 0n;
  let eligibleCount = 0;
  let eligibleNotional = 0n;
  for (const row of rows) {
    notional += BigInt(row.notionalMicro);
    idle += BigInt(row.idleAtLiq);
    if (row.eligible) {
      eligibleCount += 1;
      eligibleNotional += BigInt(row.notionalMicro);
    }
  }
  return {
    rows,
    latest: rows.slice(-50),
    totals: { count: rows.length, notionalMicro: notional.toString(), idleAtLiq: idle.toString() },
    eligible: { count: eligibleCount, notionalMicro: eligibleNotional.toString() },
  };
}

export function filterLifelineActions(
  events: readonly IncreasePositionCollateralEvent[],
  accountIds: readonly bigint[],
): LifelineAction[] {
  const wanted = new Set(accountIds.map((id) => id.toString()));
  return events
    .filter((event) => wanted.has(event.accountId.toString()))
    .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
    .map((event) => ({
      blockNumber: event.blockNumber,
      logIndex: event.logIndex,
      perpId: event.perpId.toString(),
      accountId: event.accountId.toString(),
      amountCNS: event.amountCNS.toString(),
      positionDepositCNS: event.positionDepositCNS.toString(),
      balanceCNS: event.balanceCNS.toString(),
    }));
}

export function blocksForDays(
  latestNumber: bigint,
  latestTimestamp: bigint,
  earlierNumber: bigint,
  earlierTimestamp: bigint,
  days: number,
): bigint {
  const spanBlocks = latestNumber - earlierNumber;
  const spanSecs = latestTimestamp - earlierTimestamp;
  if (spanBlocks <= 0n || spanSecs <= 0n) throw new Error("block sample did not move");
  const seconds = BigInt(Math.round(days * 86_400));
  return (spanBlocks * seconds) / spanSecs;
}

export async function liquidationHistory(input: {
  chainId: ChainId;
  days: number;
  token: string;
  fromBlock: number;
  scales: ReadonlyMap<string, MarketScale>;
  fetchImpl?: HyperSyncFetch;
  retryOnRateLimit?: boolean;
}): Promise<LiquidationHistory> {
  const scanned = await paginateLogs({
    endpoint: HYPERSYNC_ENDPOINTS[input.chainId],
    token: input.token,
    fromBlock: input.fromBlock,
    address: ADDRESSES[input.chainId].exchange,
    eventName: "PositionLiquidated",
    fetchImpl: input.fetchImpl,
    retryOnRateLimit: input.retryOnRateLimit,
  });
  const events = scanned.logs.map((log) => decodePositionLiquidated(log));
  return summarizeLiquidations(events, input.scales);
}

export async function lifelineActions(input: {
  accountIds: readonly bigint[];
  token: string;
  fromBlock: number;
  exchange?: Address;
  fetchImpl?: HyperSyncFetch;
}): Promise<LifelineAction[]> {
  const scanned = await paginateLogs({
    endpoint: HYPERSYNC_ENDPOINTS[10143],
    token: input.token,
    fromBlock: input.fromBlock,
    address: input.exchange ?? ADDRESSES[10143].exchange,
    eventName: "IncreasePositionCollateral",
    fetchImpl: input.fetchImpl,
  });
  const events = scanned.logs.map((log) => decodeIncreasePositionCollateral(log));
  return filterLifelineActions(events, input.accountIds);
}
