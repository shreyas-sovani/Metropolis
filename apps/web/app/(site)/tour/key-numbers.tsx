"use client";

import { useEffect, useState } from "react";
import { formatCount } from "../../../lib/format";
import { Stat } from "../../ui/stat";

interface Numbers {
  positions: string;
  liquidations: string;
  exact: string;
  topUps: string;
  claims: string;
}

const EMPTY: Numbers = {
  positions: "—",
  liquidations: "—",
  exact: "—",
  topUps: "—",
  claims: "—",
};

async function readCount(url: string, pick: (body: unknown) => number | null): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) return "—";
    const value = pick(await response.json());
    return value === null ? "—" : formatCount(value);
  } catch {
    return "—";
  }
}

export function KeyNumbers({ exactMatchPct }: { exactMatchPct: number }) {
  const [numbers, setNumbers] = useState<Numbers>({ ...EMPTY, exact: `${formatCount(exactMatchPct)}%` });

  useEffect(() => {
    let gone = false;
    void (async () => {
      const [positions, liquidations, topUps, claims] = await Promise.all([
        readCount("/api/radar?chain=143", (body) => {
          const count = (body as { headline?: { positionCount?: unknown } }).headline?.positionCount;
          return typeof count === "number" ? count : null;
        }),
        readCount("/api/liquidations", (body) => {
          const count = (body as { totals?: { count?: unknown } }).totals?.count;
          return typeof count === "number" ? count : null;
        }),
        readCount("/api/saves", (body) => {
          const watched = (body as { watched?: unknown }).watched;
          return typeof watched === "number" ? watched : null;
        }),
        readCount("/api/ops-health", (body) => {
          const claimsToday = (body as { claimsToday?: unknown }).claimsToday;
          return typeof claimsToday === "number" ? claimsToday : null;
        }),
      ]);
      if (!gone) setNumbers({ positions, liquidations, exact: `${formatCount(exactMatchPct)}%`, topUps, claims });
    })();
    return () => {
      gone = true;
    };
  }, [exactMatchPct]);

  return (
    <div className="tour-stats" data-testid="key-numbers">
      <Stat label="Positions tracked" value={numbers.positions} />
      <Stat label="Liquidations in 30 days" value={numbers.liquidations} />
      <Stat label="Exact match" value={numbers.exact} />
      <Stat label="Top-ups made" value={numbers.topUps} />
      <Stat label="Practice accounts claimed today" value={numbers.claims} />
    </div>
  );
}
