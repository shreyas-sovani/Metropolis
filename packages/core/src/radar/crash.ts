import {
  contractDistanceE6,
  desiredDepositMicro,
  type ContractMarket,
  type ContractPosition,
} from "../math/liquidation.js";
import type { CompactPosition } from "./schema.js";

export const CRASH_LABEL = "first-order: excludes cascade price impact";

export interface CrashResult {
  label: typeof CRASH_LABEL;
  shockPct: number;
  liquidated: { count: number; notionalMicro: bigint };
  saved: { count: number; notionalMicro: bigint };
}

/** Reprices one market. A 0% shock liquidates nothing. Saved means idle covers a 1% cushion. */
export function simulate(
  positions: readonly CompactPosition[],
  market: number,
  shockPct: number,
): CrashResult {
  if (shockPct === 0) {
    return {
      label: CRASH_LABEL,
      shockPct,
      liquidated: { count: 0, notionalMicro: 0n },
      saved: { count: 0, notionalMicro: 0n },
    };
  }
  const bps = BigInt(Math.round(shockPct * 100));
  let liquidatedCount = 0;
  let liquidatedNotional = 0n;
  let savedCount = 0;
  let savedNotional = 0n;
  for (const position of positions) {
    if (position.perpId !== market) continue;
    const entryMicro = BigInt(position.entryMicro);
    const lot = BigInt(position.lot);
    const depositMicro = BigInt(position.depositMicro);
    const fundingMicro = BigInt(position.fundingMicro);
    const mmf = BigInt(position.mmf);
    const markPNS = (BigInt(position.markPNS) * (10_000n + bps)) / 10_000n;
    if (entryMicro <= 0n || lot <= 0n || mmf <= 0n || markPNS <= 0n) continue;
    const quote = compactQuote(position);
    if (contractDistanceE6(quote.position, quote.market, markPNS) > 0n) continue;
    const notional = BigInt(position.notionalMicro);
    liquidatedCount += 1;
    liquidatedNotional += notional;
    const desired = desiredDepositMicro({
      side: position.side === 1 ? 1n : -1n,
      entryMicro,
      lot,
      fundingMicro,
      mmf,
      markMicro: (BigInt(position.markMicro) * (10_000n + bps)) / 10_000n,
      targetBps: 100n,
    });
    const need = desired > depositMicro ? desired - depositMicro : 0n;
    if (need > 0n && BigInt(position.idleMicro) >= need) {
      savedCount += 1;
      savedNotional += notional;
    }
  }
  return {
    label: CRASH_LABEL,
    shockPct,
    liquidated: { count: liquidatedCount, notionalMicro: liquidatedNotional },
    saved: { count: savedCount, notionalMicro: savedNotional },
  };
}

function compactQuote(position: CompactPosition): { position: ContractPosition; market: ContractMarket } {
  return {
    position: {
      positionType: position.positionType,
      pricePNS: BigInt(position.pricePNS),
      lotLNS: BigInt(position.lotLNS),
      depositCNS: BigInt(position.depositMicro),
      premiumPnlCNS: BigInt(position.fundingMicro),
    },
    market: {
      priceDecimals: position.priceDecimals,
      lotDecimals: position.lotDecimals,
      maintHdths: BigInt(position.maintHdths),
    },
  };
}
