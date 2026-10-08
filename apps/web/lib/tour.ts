import replay from "../data/mainnet-replay.json";
import { TOPUP } from "./bounties";
import { MAINNET_ID, txUrl } from "./explorer";

export const TOUR_KEY = "lifeline.tour";

export type TourPage = "radar" | "replay" | "app" | "twins" | "evidence";

export interface TourCheck {
  label: string;
  href: string;
}

export interface TourStop {
  id: number;
  title: string;
  sentence: string;
  href: string;
  page: TourPage;
  /** Pages that show this stop's panel while it is the active stop. */
  pages: readonly TourPage[];
  what: string;
  why: string;
  do?: string;
  checks: readonly TourCheck[];
}

export interface TourState {
  active: boolean;
  stop: number;
  startedAt: number;
}

export const TOUR_STOPS: readonly TourStop[] = [
  {
    id: 1,
    title: "Live market risk",
    sentence: "Every open Perpl position on mainnet, with its exact liquidation price.",
    href: "/radar",
    page: "radar",
    pages: ["radar"],
    what: "Every open Perpl position on mainnet, with its exact liquidation price.",
    why: "This is the risk Lifeline exists to remove.",
    do: "Drag the BTC slider to −3%.",
    checks: [{ label: "Contract-exact", href: "/methodology" }],
  },
  {
    id: 2,
    title: "A real liquidation",
    sentence: "A Bitcoin long liquidated on mainnet with idle AUSD next to it.",
    href: "/replay",
    page: "replay",
    pages: ["replay"],
    what: "A Bitcoin long liquidated on mainnet with idle AUSD next to it.",
    why: "Lifeline would have added that idle AUSD before the liquidation.",
    checks: [{ label: "The liquidation transaction", href: txUrl(MAINNET_ID, replay.tx) }],
  },
  {
    id: 3,
    title: "Protect a position",
    sentence: "A testnet practice account with a live 15× BTC position.",
    href: "/app",
    page: "app",
    pages: ["app"],
    what: "A testnet practice account with a live 15× BTC position.",
    why: "You trigger a real top-up yourself.",
    do: "Open it, take ownership, sign your safety line.",
    checks: [{ label: "A confirmed top-up", href: TOPUP }],
  },
  {
    id: 4,
    title: "Try to break it",
    sentence: "Withdraw some AUSD, then compare the twins.",
    href: "/twins",
    page: "twins",
    pages: ["twins", "app"],
    what: "The same account, and the twin that never had protection.",
    why: "Lifeline's key can add margin and nothing else.",
    do: "Withdraw some AUSD; only you can. Then open the twins.",
    checks: [
      { label: "What Lifeline's key can't do", href: "/proof" },
      { label: "Twins", href: "/twins" },
    ],
  },
  {
    id: 5,
    title: "Evidence",
    sentence: "Each bounty, with how Lifeline meets it and a proof you can open.",
    href: "/tour/evidence",
    page: "evidence",
    pages: ["evidence"],
    what: "The bounty map, the method, and the risk API.",
    why: "Every claim on this tour has one place to check.",
    checks: [
      { label: "Contract-exact", href: "/methodology" },
      { label: "Risk API", href: "/developers" },
    ],
  },
];

export function parseTour(raw: string | null): TourState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TourState>;
    if (value.active !== true && value.active !== false) return null;
    if (typeof value.stop !== "number" || !Number.isInteger(value.stop)) return null;
    if (value.stop < 1 || value.stop > TOUR_STOPS.length) return null;
    if (typeof value.startedAt !== "number") return null;
    return { active: value.active, stop: value.stop, startedAt: value.startedAt };
  } catch {
    return null;
  }
}

export function tourStop(stop: number): TourStop | null {
  return TOUR_STOPS.find((item) => item.id === stop) ?? null;
}

export function readTourStorage(storage: { getItem(key: string): string | null }): TourState | null {
  return parseTour(storage.getItem(TOUR_KEY));
}
