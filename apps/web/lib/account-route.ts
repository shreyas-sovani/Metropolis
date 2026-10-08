import {
  ADDRESSES,
  exchangeAbi,
  forfeitCNS,
  openChain,
  priceToMicro,
  readAccountByAddr,
  readPositionsForAccount,
  rpcUrls,
  type ChainId,
  type LiqSplit,
} from "@lifeline/core";
import { getAddress, isAddress } from "viem";
import { dryRunPosition, riskOf, toEvalPosition } from "./account";
import { jsonError } from "./http";

const SPLIT: LiqSplit = { userPer100K: 80_000n, insPer100K: 10_000n, protocolPer100K: 10_000n };

function marginHdths(raw: unknown): bigint {
  if (Array.isArray(raw)) return (raw[1] as bigint) ?? 0n;
  if (raw && typeof raw === "object" && "perpMaintMarginFracHdths" in raw) {
    return (raw as { perpMaintMarginFracHdths: bigint }).perpMaintMarginFracHdths;
  }
  return 0n;
}

export async function handleAccount(chain: ChainId, address: string): Promise<Response> {
  if (!isAddress(address)) return jsonError("address", 400);
  const account = getAddress(address);
  try {
    const chainApi = openChain(chain, { urls: rpcUrls(chain), timeout: 8_000 });
    const exchange = ADDRESSES[chain].exchange;
    const info = await readAccountByAddr(chainApi.client, exchange, account);
    if (info.accountId === 0n) {
      return Response.json({
        chainId: chain,
        address: account,
        accountId: "0",
        found: false,
        idleMicro: "0",
        positions: [],
      });
    }
    const [positions, block, timestamp] = await Promise.all([
      readPositionsForAccount(chainApi.client, exchange, info.accountId),
      chainApi.client.getBlockNumber(),
      chainApi.client.getBlock().then((item) => item.timestamp),
    ]);
    const perpIds = [...new Set(positions.map((item) => item.perpId))];
    const packed = perpIds.length
      ? await chainApi.client.multicall({
          contracts: perpIds.flatMap((perpId) => [
            { address: exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2" as const, args: [BigInt(perpId)] as const },
            { address: exchange, abi: exchangeAbi, functionName: "getMarginFractions" as const, args: [BigInt(perpId), 0n] as const },
          ]),
          allowFailure: false,
        })
      : [];
    const markets = new Map<number, { priceDecimals: number; lotDecimals: number; maintHdths: bigint; symbol: string }>();
    perpIds.forEach((perpId, index) => {
      const infoRow = packed[index * 2] as { priceDecimals: bigint; lotDecimals: bigint; symbol?: string };
      const symbol = typeof infoRow.symbol === "string" && infoRow.symbol.length > 0 ? infoRow.symbol : "Market";
      markets.set(perpId, {
        priceDecimals: Number(infoRow.priceDecimals),
        lotDecimals: Number(infoRow.lotDecimals),
        maintHdths: marginHdths(packed[index * 2 + 1]),
        symbol,
      });
    });
    const rows = positions.flatMap((item) => {
      const market = markets.get(item.perpId);
      if (!market || market.maintHdths <= 0n) return [];
      const position = toEvalPosition({
        markPriceValid: item.markPriceValid,
        positionType: item.position.positionType,
        lotLNS: item.position.lotLNS,
        pricePNS: item.position.pricePNS,
        depositCNS: item.position.depositCNS,
        premiumPnlCNS: item.position.premiumPnlCNS,
        priceDecimals: market.priceDecimals,
        lotDecimals: market.lotDecimals,
        maintHdths: market.maintHdths,
        markPNS: item.markPricePNS,
      });
      const decision = dryRunPosition({
        account,
        perpId: BigInt(item.perpId),
        position,
        freeCNS: info.freeCNS,
        nowSec: timestamp,
        nowBlock: block,
      });
      const risk = riskOf(position);
      return [
        {
          perpId: item.perpId,
          symbol: market.symbol,
          side: position.side === 1n ? "long" : "short",
          entryMicro: position.entryMicro.toString(),
          markMicro: position.markMicro.toString(),
          depositMicro: position.depositMicro.toString(),
          ...risk,
          liquidationMicro: priceToMicro(BigInt(risk.liquidationPricePNS), market.priceDecimals).toString(),
          priceDecimals: market.priceDecimals,
          freeCNS: info.freeCNS.toString(),
          lot: position.lot.toString(),
          fundingMicro: position.fundingMicro.toString(),
          mmf: position.mmf.toString(),
          forfeitCNS: forfeitCNS(position.depositMicro, SPLIT).toString(),
          dryRun:
            decision.action === "topUp"
              ? { action: "topUp", amountCNS: decision.amountCNS.toString() }
              : { action: "skip", reason: decision.reason },
        },
      ];
    });
    return Response.json({
      chainId: chain,
      address: account,
      accountId: info.accountId.toString(),
      found: true,
      idleMicro: info.freeCNS.toString(),
      positions: rows,
    });
  } catch {
    return jsonError("rpc", 502);
  }
}
