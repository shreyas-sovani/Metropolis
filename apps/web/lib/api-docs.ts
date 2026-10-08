import { MAINNET_EXAMPLE, SITE } from "./bounties";

export interface DocField {
  name: string;
  description: string;
}

/** The address prefilled in the Run panel and the curl example. */
export const RISK_EXAMPLE = MAINNET_EXAMPLE;

export const RISK_LIMIT = 60;

export const RATE_LIMIT_MESSAGE =
  "Too many calls from this network. The limit is 60 a minute. Wait a minute and run it again.";

export const RISK_PARAMS: readonly DocField[] = [
  { name: "address", description: "The account address, in the path." },
  { name: "chain", description: "143 for mainnet, or 10143 for testnet. Required." },
];

export const RISK_ACCOUNT_FIELDS: readonly DocField[] = [
  { name: "chainId", description: "The chain this reading came from." },
  { name: "address", description: "The account address, checksummed." },
  { name: "accountId", description: "The account number on the exchange. Zero means no account." },
  { name: "found", description: "False when that address has no account on this chain." },
  { name: "idleMicro", description: "Idle AUSD, in millionths of one AUSD." },
  { name: "positions", description: "One object per open position. Empty when nothing is open." },
  { name: "penaltyNote", description: "What the forfeit figure is: the insurance and protocol share of the margin." },
];

export const RISK_POSITION_FIELDS: readonly DocField[] = [
  { name: "perpId", description: "The market's numeric id on the exchange." },
  { name: "symbol", description: "The market name, such as BTC." },
  { name: "side", description: "Long or short." },
  { name: "entryMicro", description: "Average entry price, in millionths of one dollar." },
  { name: "markMicro", description: "Mark price, in millionths of one dollar." },
  { name: "depositMicro", description: "Margin on the position, in millionths of one AUSD." },
  { name: "distanceE6", description: "Distance from liquidation. 10000 is 1%." },
  { name: "liquidationPricePNS", description: "Liquidation price in the contract's price units." },
  { name: "liquidationMicro", description: "The same liquidation price, in millionths of one dollar." },
  { name: "priceDecimals", description: "How many decimals the market uses for prices." },
  { name: "notionalMicro", description: "Position size in dollars, in millionths." },
  { name: "atRisk", description: "True when the position is within 5% of liquidation." },
  { name: "freeCNS", description: "Idle AUSD on the account, in millionths of one AUSD." },
  { name: "lot", description: "Position size in the market's lot units." },
  { name: "fundingMicro", description: "Premium on the position, in millionths of one AUSD." },
  { name: "mmf", description: "Maintenance margin fraction, as the contract stores it." },
  { name: "forfeitCNS", description: "Insurance and protocol share of the margin, in millionths of one AUSD." },
  { name: "dryRun", description: "What Lifeline would do now: add AUSD, or wait, with the reason." },
];

export const LIQUIDATION_FIELDS: readonly DocField[] = [
  { name: "rows", description: "Every liquidation in the 30-day window." },
  { name: "latest", description: "The newest rows, for the tape." },
  { name: "totals.count", description: "How many liquidations are in the window." },
  { name: "totals.notionalMicro", description: "Their combined size, in millionths of one dollar." },
  { name: "totals.idleAtLiq", description: "Idle AUSD sitting beside them at liquidation, summed." },
  { name: "eligible.count", description: "How many had idle AUSD of at least 1% of size." },
  { name: "eligible.notionalMicro", description: "The size of those eligible liquidations." },
  { name: "cursor", description: "The last block the history reader has reached." },
  { name: "fetchedAt", description: "When this payload was read, in unix milliseconds." },
  { name: "stale", description: "True when this is the last good payload after a failed read." },
  { name: "symbol", description: "On each row, the market name." },
  { name: "side", description: "On each row, long or short." },
  { name: "blockNumber", description: "On each row, the block of the liquidation." },
  { name: "notionalMicro", description: "On each row, size in millionths of one dollar." },
  { name: "idleAtLiq", description: "On each row, idle AUSD beside the position when it liquidated." },
  { name: "eligible", description: "On each row, true when idle AUSD was at least 1% of size." },
  { name: "txHash", description: "On each row, the transaction, when the indexer returned it." },
];

/** Worker `GET /health`. The status pill reads a shorter copy of this. */
export const HEALTH_FIELDS: readonly DocField[] = [
  { name: "lastAlarmAt", description: "When Lifeline last finished a check, in unix milliseconds." },
  { name: "ticksLast10m", description: "How many checks finished in the last 10 minutes." },
  { name: "degraded", description: "True when the last check stored an error." },
  { name: "paused", description: "True when protection is switched off." },
  { name: "low", description: "True when gas or the supply of practice accounts is under its floor." },
  { name: "poolAvailable", description: "Practice accounts ready to hand out." },
  { name: "poolInBand", description: "Practice accounts sitting in the house safety band." },
  { name: "poolBySide", description: "How many available practice accounts are long, and how many are short." },
  { name: "sponsorMon", description: "Testnet MON left on the account that pays gas." },
  { name: "operatorMon", description: "Testnet MON left on Lifeline's key." },
  { name: "armed", description: "Positions with protection turned on." },
  { name: "lastBlock", description: "The last block Lifeline read." },
  { name: "claimsToday", description: "Practice accounts claimed in the last 24 hours." },
  { name: "version", description: "The health report version." },
];

export function riskCurl(address = RISK_EXAMPLE, chain: 143 | 10143 = 143, origin = SITE): string {
  return `curl "${origin}/api/v1/risk/${address}?chain=${chain}"`;
}

export interface RunPanel {
  status: number;
  latency: string;
  message: string;
  json: string;
}

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** What the Run panel shows for one response. A 429 is the limit message. */
export function runPanel(status: number, body: string, elapsedMs: number): RunPanel {
  const latency = `${Math.max(0, Math.round(elapsedMs))} ms`;
  if (status === 429) return { status, latency, message: RATE_LIMIT_MESSAGE, json: pretty(body) };
  if (status >= 400) {
    return { status, latency, message: "The example didn't answer. Check the address and run it again.", json: pretty(body) };
  }
  return { status, latency, message: "", json: pretty(body) };
}

export function liquidationPriceFromRisk(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const positions = (body as { positions?: unknown }).positions;
  if (!Array.isArray(positions) || positions.length === 0) return null;
  const price = (positions[0] as { liquidationPricePNS?: unknown }).liquidationPricePNS;
  return typeof price === "string" ? price : null;
}
