import { TESTNET_ID, addressUrl as chainAddress, txUrl as chainTx } from "./explorer";

export function txUrl(hash: string): string {
  return chainTx(TESTNET_ID, hash);
}

export function addressUrl(address: string): string {
  return chainAddress(TESTNET_ID, address);
}

export function outcomeBadge(role: "protected" | "unprotected", outcome: string): string {
  if (outcome === "alive") return "Alive";
  if (outcome.startsWith("liquidated at block ")) {
    const block = outcome.slice("liquidated at block ".length);
    return role === "unprotected" ? `Unprotected twin liquidated at block ${block}` : `Liquidated at block ${block}`;
  }
  if (outcome.startsWith("crossed liq at block ")) {
    const block = outcome.slice("crossed liq at block ".length);
    return `Crossed its liquidation price at block ${block}`;
  }
  return outcome;
}

export function outcomeTone(outcome: string): "alive" | "dead" {
  return outcome === "alive" ? "alive" : "dead";
}
