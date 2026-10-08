import { decodeEventLog, type Hex } from "viem";
import { eventAbi, eventTopic0 } from "./topics.js";

export interface HyperSyncLog {
  block_number: number;
  data: Hex;
  topic0: Hex;
  log_index?: number;
  transaction_hash?: Hex;
}

export interface PositionLiquidatedEvent {
  blockNumber: number;
  perpId: bigint;
  posAccountId: bigint;
  positionType: number;
  markPricePNS: bigint;
  liqPricePNS: bigint;
  liqLotLNS: bigint;
  posLotLNS: bigint;
  deltaPnlCNS: bigint;
  fundingCNS: bigint;
  posAmountCNS: bigint;
  posDepositCNS: bigint;
  accAmountCNS: bigint;
  accBalanceCNS: bigint;
  onOrderBook: boolean;
  txHash?: string;
}

export interface IncreasePositionCollateralEvent {
  blockNumber: number;
  logIndex: number;
  perpId: bigint;
  accountId: bigint;
  positionDepositCNS: bigint;
  amountCNS: bigint;
  balanceCNS: bigint;
}

function argsOf(name: string, log: HyperSyncLog): Record<string, unknown> {
  if (log.topic0.toLowerCase() !== eventTopic0(name).toLowerCase()) {
    throw new Error(`log topic is not ${name}`);
  }
  const decoded = decodeEventLog({
    abi: [eventAbi(name)],
    eventName: name,
    data: log.data,
    topics: [log.topic0],
  });
  return decoded.args as unknown as Record<string, unknown>;
}

function asBigint(value: unknown, field: string): bigint {
  if (typeof value !== "bigint") throw new Error(`${field} is not a bigint`);
  return value;
}

function txHashOf(log: HyperSyncLog): string | undefined {
  const hash = log.transaction_hash;
  return typeof hash === "string" && hash.startsWith("0x") ? hash : undefined;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`${field} is not a number`);
}

export function decodePositionLiquidated(log: HyperSyncLog): PositionLiquidatedEvent {
  const args = argsOf("PositionLiquidated", log);
  return {
    blockNumber: log.block_number,
    perpId: asBigint(args.perpId, "perpId"),
    posAccountId: asBigint(args.posAccountId, "posAccountId"),
    positionType: asNumber(args.positionType, "positionType"),
    markPricePNS: asBigint(args.markPricePNS, "markPricePNS"),
    liqPricePNS: asBigint(args.liqPricePNS, "liqPricePNS"),
    liqLotLNS: asBigint(args.liqLotLNS, "liqLotLNS"),
    posLotLNS: asBigint(args.posLotLNS, "posLotLNS"),
    deltaPnlCNS: asBigint(args.deltaPnlCNS, "deltaPnlCNS"),
    fundingCNS: asBigint(args.fundingCNS, "fundingCNS"),
    posAmountCNS: asBigint(args.posAmountCNS, "posAmountCNS"),
    posDepositCNS: asBigint(args.posDepositCNS, "posDepositCNS"),
    accAmountCNS: asBigint(args.accAmountCNS, "accAmountCNS"),
    accBalanceCNS: asBigint(args.accBalanceCNS, "accBalanceCNS"),
    onOrderBook: args.onOrderBook === true,
    txHash: txHashOf(log),
  };
}

export interface PositionOpenedEvent {
  blockNumber: number;
  logIndex: number;
  perpId: bigint;
  accountId: bigint;
  positionType: number;
  pricePNS: bigint;
  lotLNS: bigint;
  depositCNS: bigint;
}

export interface PositionIncreasedEvent {
  blockNumber: number;
  logIndex: number;
  perpId: bigint;
  accountId: bigint;
  positionType: number;
  pricePNS: bigint;
  startLotLNS: bigint;
  endLotLNS: bigint;
  endDepositCNS: bigint;
}

export interface PositionDecreasedEvent {
  blockNumber: number;
  logIndex: number;
  perpId: bigint;
  accountId: bigint;
  endLotLNS: bigint;
  endDepositCNS: bigint;
  fundingCNS: bigint;
}

export function decodePositionOpened(log: HyperSyncLog): PositionOpenedEvent {
  const args = argsOf("PositionOpened", log);
  return {
    blockNumber: log.block_number,
    logIndex: log.log_index ?? 0,
    perpId: asBigint(args.perpId, "perpId"),
    accountId: asBigint(args.accountId, "accountId"),
    positionType: asNumber(args.positionType, "positionType"),
    pricePNS: asBigint(args.pricePNS, "pricePNS"),
    lotLNS: asBigint(args.lotLNS, "lotLNS"),
    depositCNS: asBigint(args.depositCNS, "depositCNS"),
  };
}

export function decodePositionIncreased(log: HyperSyncLog): PositionIncreasedEvent {
  const args = argsOf("PositionIncreased", log);
  return {
    blockNumber: log.block_number,
    logIndex: log.log_index ?? 0,
    perpId: asBigint(args.perpId, "perpId"),
    accountId: asBigint(args.accountId, "accountId"),
    positionType: asNumber(args.positionType, "positionType"),
    pricePNS: asBigint(args.pricePNS, "pricePNS"),
    startLotLNS: asBigint(args.startLotLNS, "startLotLNS"),
    endLotLNS: asBigint(args.endLotLNS, "endLotLNS"),
    endDepositCNS: asBigint(args.endDepositCNS, "endDepositCNS"),
  };
}

export function decodePositionDecreased(log: HyperSyncLog): PositionDecreasedEvent {
  const args = argsOf("PositionDecreased", log);
  return {
    blockNumber: log.block_number,
    logIndex: log.log_index ?? 0,
    perpId: asBigint(args.perpId, "perpId"),
    accountId: asBigint(args.accountId, "accountId"),
    endLotLNS: asBigint(args.endLotLNS, "endLotLNS"),
    endDepositCNS: asBigint(args.endDepositCNS, "endDepositCNS"),
    fundingCNS: asBigint(args.fundingCNS, "fundingCNS"),
  };
}

export function decodeIncreasePositionCollateral(log: HyperSyncLog): IncreasePositionCollateralEvent {
  const args = argsOf("IncreasePositionCollateral", log);
  return {
    blockNumber: log.block_number,
    logIndex: log.log_index ?? 0,
    perpId: asBigint(args.perpId, "perpId"),
    accountId: asBigint(args.accountId, "accountId"),
    positionDepositCNS: asBigint(args.positionDepositCNS, "positionDepositCNS"),
    amountCNS: asBigint(args.amountCNS, "amountCNS"),
    balanceCNS: asBigint(args.balanceCNS, "balanceCNS"),
  };
}
