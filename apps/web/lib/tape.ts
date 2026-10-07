import { formatUsd } from "./format";

export function liquidationTape(row: {
  symbol: string;
  side: string;
  notionalMicro: string;
  blockNumber: number;
}): string {
  const name = row.symbol && row.side ? `${row.symbol} ${row.side}` : "Market";
  return `${name} · ${formatUsd(row.notionalMicro)} · block ${row.blockNumber.toLocaleString("en-US")}`;
}
