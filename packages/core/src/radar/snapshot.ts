import type { Address, Hex, PublicClient } from "viem";
import { exchangeAbi } from "../abi/exchange.js";
import { ADDRESSES } from "../config/addresses.js";
import { rpcUrls, type ChainId } from "../config/chains.js";
import { readAccounts } from "../chain/accounts.js";
import { createReadClient } from "../chain/client.js";
import { POSITION_LONG, POSITION_SHORT, type PositionNode } from "../chain/positions.js";
import { readExchangeSnapshot, type MarketSnapshot, type PerpInfo } from "../chain/readers.js";
import {
  DISTANCE_SCALE,
  bucketIndex,
  contractDistanceE6,
  desiredDepositMicro,
  isAtRisk,
  isDust,
  liquidationPricePNS,
  lotToScaled,
  notionalMicro,
  priceToMicro,
  type ContractMarket,
  type ContractPosition,
} from "../math/index.js";
import { radarId } from "./anonymize.js";
import { radarSnapshotSchema, type CompactPosition, type RadarSnapshot } from "./schema.js";

export interface SnapshotDraft {
  chainId: 143 | 10143;
  blockNumber: bigint;
  salt: Hex;
  markets: DraftMarket[];
}

export interface DraftMarket {
  info: PerpInfo;
  positions: DraftPosition[];
}

export interface DraftPosition {
  accountId: bigint;
  accountAddr: Address | null;
  side: 1 | -1;
  positionType: number;
  entryMicro: bigint;
  lot: bigint;
  depositMicro: bigint;
  fundingMicro: bigint;
  mmf: bigint;
  markMicro: bigint;
  notionalMicro: bigint;
  idleMicro: bigint | null;
  pricePNS: bigint;
  lotLNS: bigint;
  priceDecimals: number;
  lotDecimals: number;
  maintHdths: bigint;
  markPNS: bigint;
}

function dec(value: bigint): string {
  return value.toString();
}

function sideName(side: 1 | -1): "long" | "short" {
  return side === 1 ? "long" : "short";
}

function addMicro(left: bigint, right: bigint): bigint {
  return left + right;
}

/** Pure assembly. Drops account ids and addresses. Headline is the sum of the markets. */
export function assembleSnapshot(draft: SnapshotDraft): RadarSnapshot {
  const markets = draft.markets.map((market) => {
    const buckets = new Map<string, { index: number; side: "long" | "short"; notionalMicro: bigint; count: number }>();
    const atRisk: RadarSnapshot["markets"][number]["atRisk"] = [];
    const positions: CompactPosition[] = [];
    let openInterest = 0n;
    let idle = 0n;
    const idleAccounts = new Set<string>();
    let protect = 0;
    for (const position of market.positions) {
      if (isDust(position.entryMicro, position.lot)) continue;
      openInterest = addMicro(openInterest, position.notionalMicro);
      const quote = contractQuote(position);
      const liqPNS = liquidationPricePNS(quote.position, quote.market);
      const distance = contractDistanceE6(quote.position, quote.market, position.markPNS);
      const liqMicro = priceToMicro(liqPNS, position.priceDecimals);
      const offset = ((liqMicro - position.markMicro) * DISTANCE_SCALE) / position.markMicro;
      const index = bucketIndex(offset);
      if (index !== null) {
        const side = sideName(position.side);
        const key = `${side}:${index}`;
        const bucket = buckets.get(key) ?? { index, side, notionalMicro: 0n, count: 0 };
        bucket.notionalMicro += position.notionalMicro;
        bucket.count += 1;
        buckets.set(key, bucket);
      }
      const idleMicro = position.idleMicro ?? 0n;
      positions.push({
        perpId: market.info.perpId,
        side: position.side,
        entryMicro: dec(position.entryMicro),
        lot: dec(position.lot),
        depositMicro: dec(position.depositMicro),
        fundingMicro: dec(position.fundingMicro),
        mmf: dec(position.mmf),
        markMicro: dec(position.markMicro),
        idleMicro: dec(idleMicro),
        notionalMicro: dec(position.notionalMicro),
        positionType: position.positionType === 0 ? 0 : 1,
        pricePNS: dec(position.pricePNS),
        lotLNS: dec(position.lotLNS),
        priceDecimals: position.priceDecimals,
        lotDecimals: position.lotDecimals,
        maintHdths: dec(position.maintHdths),
        markPNS: dec(position.markPNS),
      });
      if (!isAtRisk(distance)) continue;
      const free = position.idleMicro ?? 0n;
      const accountKey = position.accountId.toString();
      if (!idleAccounts.has(accountKey)) {
        idleAccounts.add(accountKey);
        idle += free;
      }
      const desired = desiredDepositMicro({
        side: position.side === 1 ? 1n : -1n,
        entryMicro: position.entryMicro,
        lot: position.lot,
        fundingMicro: position.fundingMicro,
        mmf: position.mmf,
        markMicro: position.markMicro,
        targetBps: 600n,
      });
      const need = desired - position.depositMicro;
      const protectNow = need > 0n && free >= need;
      if (protectNow) protect += 1;
      const leverage = position.depositMicro > 0n ? (position.notionalMicro * 100n) / position.depositMicro : 0n;
      atRisk.push({
        id: radarId(draft.salt, draft.chainId, position.accountId),
        side: sideName(position.side),
        leverageHdths: dec(leverage),
        notionalMicro: dec(position.notionalMicro),
        distanceE6: dec(distance),
        depositMicro: dec(position.depositMicro),
        freeMicro: dec(free),
        couldProtectNow: protectNow,
      });
    }
    atRisk.sort((a, b) => {
      const left = BigInt(a.distanceE6);
      const right = BigInt(b.distanceE6);
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    const atRiskNotional = atRisk.reduce((sum, row) => sum + BigInt(row.notionalMicro), 0n);
    return {
      perpId: market.info.perpId,
      symbol: market.info.symbol,
      markMicro: dec(priceToMicro(market.info.markPNS, market.info.priceDecimals)),
      openInterestMicro: dec(openInterest),
      positionCount: positions.length,
      atRiskCount: atRisk.length,
      atRiskNotionalMicro: dec(atRiskNotional),
      idleMicro: dec(idle),
      couldProtectNow: protect,
      buckets: [...buckets.values()]
        .sort((a, b) => a.index - b.index || (a.side < b.side ? -1 : 1))
        .map((bucket) => ({ ...bucket, notionalMicro: dec(bucket.notionalMicro) })),
      atRisk,
      positions,
    };
  });

  const headline = markets.reduce(
    (sum, market) => ({
      openInterestMicro: sum.openInterestMicro + BigInt(market.openInterestMicro),
      positionCount: sum.positionCount + market.positionCount,
      atRiskNotionalMicro: sum.atRiskNotionalMicro + BigInt(market.atRiskNotionalMicro),
      atRiskCount: sum.atRiskCount + market.atRiskCount,
      idleMicro: sum.idleMicro + BigInt(market.idleMicro),
      couldProtectNow: sum.couldProtectNow + market.couldProtectNow,
    }),
    {
      openInterestMicro: 0n,
      positionCount: 0,
      atRiskNotionalMicro: 0n,
      atRiskCount: 0,
      idleMicro: 0n,
      couldProtectNow: 0,
    },
  );

  return radarSnapshotSchema.parse({
    chainId: draft.chainId,
    blockNumber: dec(draft.blockNumber),
    headline: {
      openInterestMicro: dec(headline.openInterestMicro),
      positionCount: headline.positionCount,
      atRiskNotionalMicro: dec(headline.atRiskNotionalMicro),
      atRiskCount: headline.atRiskCount,
      idleMicro: dec(headline.idleMicro),
      couldProtectNow: headline.couldProtectNow,
    },
    markets: markets.map(({ positions: _positions, ...market }) => market),
    positions: markets.flatMap((market) => market.positions),
  });
}

function contractQuote(position: DraftPosition): { position: ContractPosition; market: ContractMarket } {
  return {
    position: {
      positionType: position.positionType,
      pricePNS: position.pricePNS,
      lotLNS: position.lotLNS,
      depositCNS: position.depositMicro,
      premiumPnlCNS: position.fundingMicro,
    },
    market: {
      priceDecimals: position.priceDecimals,
      lotDecimals: position.lotDecimals,
      maintHdths: position.maintHdths,
    },
  };
}

function sideOf(positionType: number): 1 | -1 {
  if (positionType === POSITION_LONG) return 1;
  if (positionType === POSITION_SHORT) return -1;
  throw new Error(`unknown positionType ${positionType}`);
}

function marginHdths(raw: unknown): bigint {
  if (Array.isArray(raw)) {
    const value = raw[1] as bigint | undefined;
    if (typeof value !== "bigint") throw new Error("margin fractions missing");
    return value;
  }
  if (raw && typeof raw === "object" && "perpMaintMarginFracHdths" in raw) {
    const value = (raw as { perpMaintMarginFracHdths: bigint }).perpMaintMarginFracHdths;
    if (typeof value !== "bigint") throw new Error("margin fractions missing");
    return value;
  }
  throw new Error("margin fractions missing");
}

async function marginByMarket(
  client: PublicClient,
  exchange: Address,
  markets: MarketSnapshot[],
): Promise<Map<number, bigint>> {
  const fractions = new Map<number, bigint>();
  if (markets.length === 0) return fractions;
  const rows = await client.multicall({
    contracts: markets.map((market) => ({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getMarginFractions" as const,
      args: [BigInt(market.info.perpId), 0n] as const,
    })),
    allowFailure: false,
  });
  markets.forEach((market, index) => {
    const hdths = marginHdths(rows[index]);
    if (hdths <= 0n) throw new Error(`perp ${market.info.perpId} maintenance fraction is 0`);
    fractions.set(market.info.perpId, hdths);
  });
  return fractions;
}

function draftPosition(info: PerpInfo, position: PositionNode, maintHdths: bigint): DraftPosition | null {
  if (position.lotLNS <= 0n) return null;
  const entryMicro = priceToMicro(position.pricePNS, info.priceDecimals);
  const lot = lotToScaled(position.lotLNS, info.lotDecimals);
  const markMicro = priceToMicro(info.markPNS, info.priceDecimals);
  if (entryMicro <= 0n || lot <= 0n || markMicro <= 0n) return null;
  if (isDust(entryMicro, lot)) return null;
  const mmf = maintHdths / 100n;
  if (mmf <= 0n) return null;
  return {
    accountId: position.accountId,
    accountAddr: null,
    side: sideOf(position.positionType),
    positionType: position.positionType,
    entryMicro,
    lot,
    depositMicro: position.depositCNS,
    fundingMicro: position.premiumPnlCNS,
    mmf,
    markMicro,
    notionalMicro: notionalMicro(entryMicro, lot),
    idleMicro: null,
    pricePNS: position.pricePNS,
    lotLNS: position.lotLNS,
    priceDecimals: info.priceDecimals,
    lotDecimals: info.lotDecimals,
    maintHdths,
    markPNS: info.markPNS,
  };
}

export async function buildSnapshot(
  chainId: ChainId,
  salt: Hex,
  options: { urls?: readonly string[]; timeout?: number } = {},
): Promise<RadarSnapshot> {
  const urls = options.urls ?? rpcUrls(chainId);
  const client = createReadClient(chainId, urls, options.timeout);
  const exchange = ADDRESSES[chainId].exchange;
  const [blockNumber, markets] = await Promise.all([
    client.getBlockNumber(),
    readExchangeSnapshot(client, exchange),
  ]);
  const fractions = await marginByMarket(client, exchange, markets);
  const drafts: DraftMarket[] = markets.map((market) => ({
    info: market.info,
    positions: market.positions.flatMap((position) => {
      const maintHdths = fractions.get(market.info.perpId);
      if (!maintHdths) return [];
      const draft = draftPosition(market.info, position, maintHdths);
      return draft ? [draft] : [];
    }),
  }));

  const atRiskIds = new Set<bigint>();
  for (const market of drafts) {
    for (const position of market.positions) {
      const quote = contractQuote(position);
      const distance = contractDistanceE6(quote.position, quote.market, position.markPNS);
      if (isAtRisk(distance)) atRiskIds.add(position.accountId);
    }
  }
  const accounts = await readAccounts(client, exchange, [...atRiskIds]);
  const idleById = new Map(accounts.map((account) => [account.accountId, account.freeCNS]));
  for (const market of drafts) {
    for (const position of market.positions) {
      const idle = idleById.get(position.accountId);
      if (idle !== undefined) position.idleMicro = idle;
    }
  }

  return assembleSnapshot({
    chainId,
    blockNumber,
    salt,
    markets: drafts,
  });
}
