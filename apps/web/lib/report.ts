import { getAddress, isAddress } from "viem";
import { MAINNET_PROTECTION, dryRunSentence, formatAusd } from "./account";
import { MAINNET_EXAMPLE, PRACTICE_ACCOUNT } from "./bounties";
import { ADDRESS_ERROR } from "./landing";
import { formatPrice, formatUsd } from "./format";

export const CHECK_H1 = "Check an address";
export const CHECK_SUB =
  "See how close each position is to liquidation and what Lifeline would do right now. Nothing is signed or sent.";
export const NO_POSITIONS = "This account has no open positions.";
export const MAINNET_ACTION = "Try it on a testnet practice account";
export const DASHBOARD_ACTION = "Open your dashboard";
export const PRACTICE_ACTION = "Open a practice account";

/** Dry-run mandate: act below 4%, restore 6%. */
export const ACT_BELOW_PCT = 4;
export const SAFETY_PCT = 6;

export type ReportChain = "143" | "10143";

export interface ReportPosition {
  perpId: number;
  symbol: string;
  side: "long" | "short";
  entryMicro: string;
  markMicro: string;
  liquidationPricePNS: string;
  liquidationMicro?: string;
  priceDecimals?: number;
  distanceE6: string;
  depositMicro: string;
  freeCNS: string;
  forfeitCNS?: string;
  notionalMicro?: string;
  dryRun: { action: string; amountCNS?: string; reason?: string };
}

export interface AccountPayload {
  found?: boolean;
  accountId?: string;
  idleMicro?: string;
  positions?: ReportPosition[];
}

export const CHECK_EXAMPLES: readonly { label: string; address: string; chain: ReportChain }[] = [
  { label: "A live mainnet account", address: MAINNET_EXAMPLE, chain: "143" },
  { label: "A testnet practice account", address: PRACTICE_ACCOUNT, chain: "10143" },
];

export function exampleHref(example: { address: string; chain: ReportChain }): string {
  return `/a/${example.address}?chain=${example.chain}`;
}

export function checkTarget(address: string, chain: ReportChain): { href: string } | { error: string } {
  const trimmed = address.trim();
  if (!isAddress(trimmed)) return { error: ADDRESS_ERROR };
  return { href: `/a/${getAddress(trimmed)}?chain=${chain}` };
}

export function noAccountSentence(mainnet: boolean): string {
  return mainnet ? "This address has no Perpl account on mainnet." : "This address has no Perpl account on testnet.";
}

export type AccountOutcome = "missing" | "flat" | "ready";

export function accountOutcome(body: AccountPayload): AccountOutcome {
  if (body.found === false || body.accountId === "0") return "missing";
  if (!body.positions || body.positions.length === 0) return "flat";
  return "ready";
}

export function sameAccount(left: string, right: string): boolean {
  return isAddress(left) && isAddress(right) && getAddress(left) === getAddress(right);
}

export function reportAction(input: { mainnet: boolean; address: string; practice: string | null }): { label: string; href: "/app" } {
  if (input.mainnet) return { label: MAINNET_ACTION, href: "/app" };
  if (input.practice && sameAccount(input.address, input.practice)) return { label: DASHBOARD_ACTION, href: "/app" };
  return { label: PRACTICE_ACTION, href: "/app" };
}

export function distancePct(distanceE6: string): number {
  const value = Number(distanceE6);
  return Number.isFinite(value) ? value / 10_000 : 0;
}

/** Notional ÷ margin, shown as `15×` when the position is at least 1×. */
export function leverageTimes(notionalMicro: string | undefined, depositMicro: string): string | null {
  if (!notionalMicro) return null;
  let notional: bigint;
  let deposit: bigint;
  try {
    notional = BigInt(notionalMicro);
    deposit = BigInt(depositMicro);
  } catch {
    return null;
  }
  if (deposit <= 0n || notional <= 0n) return null;
  const tenths = (notional * 10n + deposit / 2n) / deposit;
  if (tenths < 10n) return null;
  const whole = tenths / 10n;
  const frac = tenths % 10n;
  return frac === 0n ? `${whole}×` : `${whole}.${frac}×`;
}

export function positionTitle(position: Pick<ReportPosition, "symbol" | "side" | "notionalMicro" | "depositMicro">): string {
  const base = `${position.symbol} ${position.side}`;
  const times = leverageTimes(position.notionalMicro, position.depositMicro);
  return times ? `${base} · ${times}` : base;
}

export interface CardModel {
  title: string;
  entry: string;
  mark: string;
  liquidation: string;
  margin: string;
  idle: string;
  forfeit: string;
  dryRun: string;
  distancePct: number;
  attrs: {
    side: string;
    entry: string;
    mark: string;
    liq: string;
    distance: string;
    deposit: string;
    free: string;
  };
}

export function cardModel(position: ReportPosition, mainnet: boolean): CardModel {
  const decimals = position.priceDecimals ?? 2;
  const liquidation = position.liquidationMicro ? formatPrice(position.liquidationMicro, decimals) : "—";
  return {
    title: positionTitle(position),
    entry: formatPrice(position.entryMicro, decimals),
    mark: formatPrice(position.markMicro, decimals),
    liquidation,
    margin: formatUsd(position.depositMicro),
    idle: `${formatAusd(position.freeCNS)} AUSD`,
    forfeit: `If liquidated now you'd forfeit about ${formatUsd(position.forfeitCNS ?? "0")}.`,
    dryRun: dryRunSentence({ ...position, mainnet }),
    distancePct: distancePct(position.distanceE6),
    attrs: {
      side: position.side,
      entry: position.entryMicro,
      mark: position.markMicro,
      liq: position.liquidationPricePNS,
      distance: position.distanceE6,
      deposit: position.depositMicro,
      free: position.freeCNS,
    },
  };
}

export function summaryFigures(input: { idleMicro?: string; positions: readonly { depositMicro: string; freeCNS?: string }[] }): {
  idle: string;
  positions: string;
  margin: string;
} {
  const idle = input.idleMicro ?? input.positions.find((row) => row.freeCNS)?.freeCNS ?? "0";
  let margin = 0n;
  for (const row of input.positions) {
    try {
      margin += BigInt(row.depositMicro);
    } catch {
      // Ignore a row whose margin isn't a number.
    }
  }
  return {
    idle: formatAusd(idle),
    positions: String(input.positions.length),
    margin: formatUsd(margin.toString()),
  };
}

export function chainBadge(mainnet: boolean): string {
  return mainnet ? "Mainnet · read-only" : "Testnet";
}

/** The signed-in practice account, when `/api/lifeline/me` has one. */
export async function readPracticeProxy(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetchImpl("/api/lifeline/me", { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { claim?: { proxy?: string } | null };
    const proxy = body.claim?.proxy;
    return typeof proxy === "string" && isAddress(proxy) ? getAddress(proxy) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
