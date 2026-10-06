"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MAINNET_PROTECTION, dryRunSentence } from "../../../../lib/account";
import { formatPct, formatUsd } from "../../../../lib/format";

interface Position {
  perpId: number;
  symbol: string;
  side: "long" | "short";
  entryMicro: string;
  markMicro: string;
  liquidationPricePNS: string;
  distanceE6: string;
  depositMicro: string;
  freeCNS: string;
  forfeitCNS?: string;
  dryRun: { action: string; amountCNS?: string; reason?: string };
}

export function AccountLookup({ params }: { params: Promise<{ address: string }> }) {
  const search = useSearchParams();
  const chain = search.get("chain") === "10143" ? "10143" : "143";
  const [address, setAddress] = useState("");
  const [positions, setPositions] = useState<Position[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let gone = false;
    void params.then(async ({ address: value }) => {
      if (gone) return;
      setAddress(value);
      const response = await fetch(`/api/account/${value}?chain=${chain}`);
      if (!response.ok) {
        if (!gone) setError("That address has no readable account on this chain.");
        return;
      }
      const body = (await response.json()) as { positions: Position[] };
      if (!gone) {
        setPositions(body.positions);
        setError("");
      }
    });
    return () => {
      gone = true;
    };
  }, [params, chain]);
  const mainnet = chain === "143";
  return (
    <main className="stage">
      <h1>Account</h1>
      <p className="lede">{address}</p>
      {error ? <p>{error}</p> : null}
      {positions.map((position) => (
        <article
          className="panel"
          key={position.perpId}
          data-testid="risk-card"
          data-side={position.side}
          data-entry={position.entryMicro}
          data-mark={position.markMicro}
          data-liq={position.liquidationPricePNS}
          data-distance={position.distanceE6}
          data-deposit={position.depositMicro}
          data-free={position.freeCNS}
        >
          <h2>
            {position.symbol} {position.side}
          </h2>
          <p>
            Entry {formatUsd(position.entryMicro)} · mark {formatUsd(position.markMicro)} · liquidation {position.liquidationPricePNS}
          </p>
          <p>
            Distance {formatPct(position.distanceE6)} · deposit {formatUsd(position.depositMicro)} · free {formatUsd(position.freeCNS)}
          </p>
          <p data-testid="dry-run">{dryRunSentence({ ...position, mainnet })}</p>
          <p>If liquidated now you&apos;d forfeit about {formatUsd(position.forfeitCNS ?? "0")}.</p>
          {mainnet ? <p>{MAINNET_PROTECTION}</p> : null}
        </article>
      ))}
    </main>
  );
}
