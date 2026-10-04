import { toEventSelector, type AbiEvent, type Hex } from "viem";
import { exchangeAbi } from "../abi/exchange.js";

export const HYPERSYNC_EVENTS = ["PositionLiquidated", "IncreasePositionCollateral"] as const;
export type HyperSyncEventName = (typeof HYPERSYNC_EVENTS)[number];

export function eventAbi(name: HyperSyncEventName): AbiEvent {
  const event = exchangeAbi.find((item) => item.type === "event" && item.name === name);
  if (!event || event.type !== "event") throw new Error(`missing event ${name}`);
  return event;
}

/** topic0 from the vendored Exchange ABI. Not a hand-written hash. */
export function eventTopic0(name: HyperSyncEventName): Hex {
  return toEventSelector(eventAbi(name));
}
