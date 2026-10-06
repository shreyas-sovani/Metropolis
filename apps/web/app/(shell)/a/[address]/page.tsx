"use client";

import { useEffect, useState } from "react";
import { formatPct, formatUsd } from "../../../../lib/format";

interface Position {
  perpId: number;
  side?: string;
  distanceE6: string;
  liquidationPricePNS: string;
  freeCNS: string;
  forfeitCNS?: string;
  dryRun: { action: string; amountCNS?: string; reason?: string };
}

export default function AccountPage({ params }: { params: Promise<{ address: string }> }) {
  const [address, setAddress] = useState("");
  const [positions, setPositions] = useState<Position[]>([]);
  const [mainnet, setMainnet] = useState(true);
  useEffect(() => {
    let gone = false;
    void params.then(async ({ address: value }) => {
      if (gone) return;
      setAddress(value);
      const response = await fetch(`/api/v1/risk/${value}?chain=143`);
      if (!response.ok) return;
      const body = (await response.json()) as { chainId: number; positions: Position[] };
      if (!gone) {
        setPositions(body.positions);
        setMainnet(body.chainId === 143);
      }
    });
    return () => {
      gone = true;
    };
  }, [params]);
  return (
    <main className="stage">
      <h1>Account</h1>
      <p className="lede">{address}</p>
      {positions.map((position) => (
        <article className="panel" key={position.perpId} data-testid="risk-card">
          <h2>Perp {position.perpId}</h2>
          <p>
            Liquidation price {position.liquidationPricePNS} · {formatPct(position.distanceE6)} away · idle {formatUsd(position.freeCNS)}
          </p>
          <p>If liquidated now you&apos;d forfeit about {formatUsd(position.forfeitCNS ?? "0")}.</p>
          {mainnet ? <p>Protection on mainnet: coming via API-key mode.</p> : null}
        </article>
      ))}
    </main>
  );
}
