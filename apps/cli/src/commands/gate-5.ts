import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  CHAIN_IDS,
  CHAINS,
  HYPERSYNC_ENDPOINTS,
  decodePositionLiquidated,
  exchangeAbi,
  firstExchangeLogBlock,
  paginateLogs,
  rpcUrls,
} from "@lifeline/core";
import { createPublicClient, fallback, http } from "viem";
import { workspaceRoot } from "./keys-generate.js";

function envioToken(root: string): string {
  const file = path.join(root, "secrets", "services.env");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("ENVIO_API_TOKEN=")) {
      const token = line.slice("ENVIO_API_TOKEN=".length).trim();
      if (token) return token;
    }
  }
  throw new Error("ENVIO_API_TOKEN missing");
}

function bitmapHas(bitmap: readonly bigint[], perpId: bigint): boolean {
  if (perpId < 0n || perpId > 1023n) return false;
  const id = Number(perpId);
  const word = bitmap[Math.floor(id / 256)];
  if (word === undefined) return false;
  return ((word >> BigInt(id % 256)) & 1n) === 1n;
}

export async function gate5(root = workspaceRoot()): Promise<number> {
  const token = envioToken(root);
  const counts: Record<number, number> = {};
  let failed = false;

  for (const chainId of CHAIN_IDS) {
    const label = chainId === 143 ? "mainnet" : "testnet";
    const endpoint = HYPERSYNC_ENDPOINTS[chainId];
    const exchange = ADDRESSES[chainId].exchange;
    const firstBlock = await firstExchangeLogBlock({
      endpoint,
      token,
      address: exchange,
      fetchImpl: fetch,
    });
    const scanned = await paginateLogs({
      endpoint,
      token,
      fromBlock: firstBlock,
      address: exchange,
      eventName: "PositionLiquidated",
      fetchImpl: fetch,
    });
    const reachedHead = scanned.nextBlock >= scanned.archiveHeight;
    counts[chainId] = scanned.logs.length;
    console.log(
      `${label} firstLog=${firstBlock} liquidations=${scanned.logs.length} pages=${scanned.pages} archive=${scanned.archiveHeight} next=${scanned.nextBlock} head=${reachedHead}`,
    );
    if (!reachedHead) failed = true;
    if (chainId !== 143) continue;

    const decoded = scanned.logs.map((log) => decodePositionLiquidated(log));
    const sample = decoded.slice(0, Math.min(5, decoded.length));
    if (sample.length === 0) {
      console.error("mainnet sample empty");
      failed = true;
      continue;
    }
    const client = createPublicClient({
      chain: CHAINS[chainId],
      transport: fallback(rpcUrls(chainId).map((url) => http(url, { timeout: 20_000, retryCount: 1 }))),
    });
    const bitmap = (await client.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getPerpetualExistsBitmap",
    })) as readonly bigint[];
    const decimals = new Map<string, number>();
    for (const event of sample) {
      const key = event.perpId.toString();
      if (!decimals.has(key)) {
        const info = (await client.readContract({
          address: exchange,
          abi: exchangeAbi,
          functionName: "getPerpetualInfoV2",
          args: [event.perpId],
        })) as { priceDecimals: bigint };
        decimals.set(key, Number(info.priceDecimals));
      }
      const scale = 10 ** (decimals.get(key) ?? 0);
      const mark = Number(event.markPricePNS) / scale;
      const liq = Number(event.liqPricePNS) / scale;
      const priceOk = mark > 1e-6 && mark < 1e8 && liq > 1e-6 && liq < 1e8;
      // posLotLNS is the lot left after liquidation and is 0 on a full close.
      const lotsOk = event.liqLotLNS > 0n;
      const marketOk = bitmapHas(bitmap, event.perpId);
      console.log(
        `sample perpId=${key} mark=${mark} liq=${liq} posLot=${event.posLotLNS} liqLot=${event.liqLotLNS} market=${marketOk} price=${priceOk} lots=${lotsOk}`,
      );
      if (!priceOk || !lotsOk || !marketOk) failed = true;
    }
  }

  if (counts[10143] === 0) console.log("twins display mode: crossed liquidation price");
  console.log(`counts mainnet=${counts[143] ?? 0} testnet=${counts[10143] ?? 0}`);
  return failed ? 1 : 0;
}
