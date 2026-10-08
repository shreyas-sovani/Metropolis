import {
  contractDistanceE6,
  evaluate,
  isAtRisk,
  liquidationPricePNS,
  lotToScaled,
  notionalMicro,
  priceToMicro,
  POSITION_LONG,
  type EvalPosition,
  type Evaluation,
  type MandateMessage,
} from "@lifeline/core";
import type { Address } from "viem";
import { formatAusd, formatDistanceOne } from "./format";

export { formatAusd };

export function dryRunMandate(account: Address, perpId: bigint, nowSec: bigint): MandateMessage {
  return {
    account,
    perpIds: [perpId],
    triggerBps: 400,
    targetBps: 600,
    maxPerActionCNS: 150_000_000n,
    budgetCNS: 1_000_000_000_000n,
    expiry: nowSec + 7n * 24n * 60n * 60n,
    nonce: 1n,
  };
}

export function toEvalPosition(input: {
  markPriceValid: boolean;
  positionType: number;
  lotLNS: bigint;
  pricePNS: bigint;
  depositCNS: bigint;
  premiumPnlCNS: bigint;
  priceDecimals: number;
  lotDecimals: number;
  maintHdths: bigint;
  markPNS: bigint;
}): EvalPosition {
  const side = input.positionType === POSITION_LONG ? 1n : -1n;
  return {
    markPriceValid: input.markPriceValid,
    open: input.lotLNS > 0n,
    side,
    positionType: input.positionType,
    entryMicro: priceToMicro(input.pricePNS, input.priceDecimals),
    lot: lotToScaled(input.lotLNS, input.lotDecimals),
    depositMicro: input.depositCNS,
    fundingMicro: input.premiumPnlCNS,
    mmf: input.maintHdths / 100n,
    markMicro: priceToMicro(input.markPNS, input.priceDecimals),
    pricePNS: input.pricePNS,
    lotLNS: input.lotLNS,
    priceDecimals: input.priceDecimals,
    lotDecimals: input.lotDecimals,
    maintHdths: input.maintHdths,
    markPNS: input.markPNS,
  };
}

/** Default 4%/6% dry run. The amount is whatever `evaluate` returns for the same inputs. */
export function dryRunPosition(input: {
  account: Address;
  perpId: bigint;
  position: EvalPosition;
  freeCNS: bigint;
  nowSec: bigint;
  nowBlock: bigint;
}): Evaluation {
  return evaluate(
    dryRunMandate(input.account, input.perpId, input.nowSec),
    input.position,
    { freeBalanceMicro: input.freeCNS, paused: false, nowSec: input.nowSec },
    null,
    input.nowBlock,
    0n,
  );
}

export function riskOf(position: EvalPosition): { distanceE6: string; liquidationPricePNS: string; notionalMicro: string; atRisk: boolean } {
  const distance = contractDistanceE6(
    {
      positionType: position.positionType,
      pricePNS: position.pricePNS,
      lotLNS: position.lotLNS,
      depositCNS: position.depositMicro,
      premiumPnlCNS: position.fundingMicro,
    },
    { priceDecimals: position.priceDecimals, lotDecimals: position.lotDecimals, maintHdths: position.maintHdths },
    position.markPNS,
  );
  return {
    distanceE6: distance.toString(),
    liquidationPricePNS: liquidationPricePNS(
      {
        positionType: position.positionType,
        pricePNS: position.pricePNS,
        lotLNS: position.lotLNS,
        depositCNS: position.depositMicro,
        premiumPnlCNS: position.fundingMicro,
      },
      { priceDecimals: position.priceDecimals, lotDecimals: position.lotDecimals, maintHdths: position.maintHdths },
    ).toString(),
    notionalMicro: notionalMicro(position.markMicro, position.lot).toString(),
    atRisk: isAtRisk(distance),
  };
}

export const MAINNET_PROTECTION = "Protection on mainnet: coming via API-key mode.";

/** PRD §F3. A top-up names the AUSD added and the distance moving to the 6% target. */
export function dryRunSentence(input: {
  symbol: string;
  side: "long" | "short";
  distanceE6: string;
  dryRun: { action: string; amountCNS?: string };
  mainnet: boolean;
}): string {
  const before = formatDistanceOne(input.distanceE6);
  const body =
    input.dryRun.action === "topUp" && input.dryRun.amountCNS
      ? `Lifeline would add ${formatAusd(input.dryRun.amountCNS)} AUSD from your idle balance to your ${input.symbol} ${input.side} → distance ${before} → 6.0%.`
      : `Lifeline would not add collateral to your ${input.symbol} ${input.side}. Distance is ${before}.`;
  return input.mainnet ? `${body} ${MAINNET_PROTECTION}` : body;
}

export function sameDryRun(left: Evaluation, right: Evaluation): boolean {
  if (left.action === "skip" && right.action === "skip") return left.reason === right.reason;
  if (left.action === "topUp" && right.action === "topUp") return left.amountCNS === right.amountCNS;
  return false;
}
