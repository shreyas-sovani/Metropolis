import type { Address, PublicClient } from "viem";
import { exchangeAbi } from "../abi/exchange.js";
import { perpIdsFromBitmap } from "./bitmap.js";
import {
  POSITION_PAGE_SIZE,
  slicePositionPage,
  type PositionNode,
} from "./positions.js";

export interface PerpInfo {
  perpId: number;
  name: string;
  symbol: string;
  priceDecimals: number;
  lotDecimals: number;
  markPNS: bigint;
  longOpenInterestLNS: bigint;
  shortOpenInterestLNS: bigint;
  status: number;
}

export interface MarketSnapshot {
  info: PerpInfo;
  startNodeId: bigint;
  endNodeId: bigint;
  positions: PositionNode[];
  /** Sum of `numPositions` across `getPositionsV2` pages. */
  numPositions: bigint;
}

interface InfoRaw {
  name: string;
  symbol: string;
  priceDecimals: bigint;
  lotDecimals: bigint;
  markPNS: bigint;
  longOpenInterestLNS: bigint;
  shortOpenInterestLNS: bigint;
  status: number;
}

const MAX_PAGES = 64;

function asInfo(perpId: number, raw: InfoRaw): PerpInfo {
  return {
    perpId,
    name: raw.name,
    symbol: raw.symbol,
    priceDecimals: Number(raw.priceDecimals),
    lotDecimals: Number(raw.lotDecimals),
    markPNS: raw.markPNS,
    longOpenInterestLNS: raw.longOpenInterestLNS,
    shortOpenInterestLNS: raw.shortOpenInterestLNS,
    status: Number(raw.status),
  };
}

function asPosition(raw: PositionNode): PositionNode {
  return {
    accountId: raw.accountId,
    nextNodeId: raw.nextNodeId,
    prevNodeId: raw.prevNodeId,
    positionType: Number(raw.positionType),
    depositCNS: raw.depositCNS,
    pricePNS: raw.pricePNS,
    lotLNS: raw.lotLNS,
    entryBlock: raw.entryBlock,
    pnlCNS: raw.pnlCNS,
    deltaPnlCNS: raw.deltaPnlCNS,
    premiumPnlCNS: raw.premiumPnlCNS,
    priceResiduePNSQ16: raw.priceResiduePNSQ16,
  };
}

/** Full exchange snapshot: bitmap, perp info, and paged `getPositionsV2`. */
export async function readExchangeSnapshot(
  client: PublicClient,
  exchange: Address,
): Promise<MarketSnapshot[]> {
  const bitmap = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualExistsBitmap",
  })) as readonly bigint[];
  const perpIds = perpIdsFromBitmap(bitmap);
  if (perpIds.length === 0) return [];

  const packed = await client.multicall({
    contracts: perpIds.flatMap((id) => [
      {
        address: exchange,
        abi: exchangeAbi,
        functionName: "getPerpetualInfoV2" as const,
        args: [BigInt(id)] as const,
      },
      {
        address: exchange,
        abi: exchangeAbi,
        functionName: "getPositionIds" as const,
        args: [BigInt(id)] as const,
      },
    ]),
    allowFailure: false,
  });

  const markets = perpIds.map((perpId, index) => {
    const info = asInfo(perpId, packed[index * 2] as InfoRaw);
    const ids = packed[index * 2 + 1] as readonly [bigint, bigint];
    const startNodeId = ids[0];
    return {
      info,
      startNodeId,
      endNodeId: ids[1],
      positions: [] as PositionNode[],
      numPositions: 0n,
      cursor: startNodeId,
      done: startNodeId === 0n,
      pages: 0,
    };
  });

  while (markets.some((market) => !market.done)) {
    const active = markets.filter((market) => !market.done);
    const pages = await client.multicall({
      contracts: active.map((market) => ({
        address: exchange,
        abi: exchangeAbi,
        functionName: "getPositionsV2" as const,
        args: [BigInt(market.info.perpId), market.cursor, POSITION_PAGE_SIZE] as const,
      })),
      allowFailure: false,
    });
    active.forEach((market, index) => {
      const page = pages[index] as readonly [PositionNode[], bigint, bigint, boolean];
      const raw = page[0];
      const numPositions = page[1];
      const sliced = slicePositionPage(raw, numPositions);
      market.pages += 1;
      if (market.pages > MAX_PAGES) {
        throw new Error(`perp ${market.info.perpId} exceeded ${MAX_PAGES} position pages`);
      }
      market.positions.push(...sliced.positions.map(asPosition));
      market.numPositions += numPositions;
      if (sliced.nextNodeId === 0n) market.done = true;
      else market.cursor = sliced.nextNodeId;
    });
  }

  return markets.map(({ info, startNodeId, endNodeId, positions, numPositions }) => ({
    info,
    startNodeId,
    endNodeId,
    positions,
    numPositions,
  }));
}
