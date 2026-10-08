"use client";

import { useEffect, useState } from "react";
import { formatAusd, formatGrouped } from "../../../lib/format";
import { distancePctLabel } from "../../../lib/protection";
import { outcomeBadge } from "../../../lib/twins-view";
import { txUrl } from "../../../lib/twins-view";
import { Badge } from "../../ui/badge";
import { Card } from "../../ui/card";
import { DistanceGauge } from "../../ui/distance-gauge";
import { Stat } from "../../ui/stat";

interface TwinAction {
  txHash: string;
  block: number | null;
  amountCNS: string;
}

interface TwinLeg {
  proxy: string;
  mandate: string;
  distanceE6: string | null;
  distanceError?: "rpc";
  actions: TwinAction[];
  outcome: string;
}

interface TwinPair {
  id: string;
  market: string;
  side: string;
  protected: TwinLeg | null;
  unprotected: TwinLeg | null;
}

export function TwinsPanel() {
  const [pairs, setPairs] = useState<TwinPair[] | null>(null);
  const [saves, setSaves] = useState(0);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let gone = false;
    void Promise.all([fetch("/api/twins"), fetch("/api/saves")])
      .then(async ([twins, saveResponse]) => {
        if (!twins.ok) throw new Error("twins");
        const body = (await twins.json()) as { pairs?: TwinPair[] };
        const saveBody = saveResponse.ok ? ((await saveResponse.json()) as { count?: number }) : { count: 0 };
        if (!gone) {
          const next = body.pairs ?? [];
          setPairs(next);
          setSaves(saveBody.count ?? 0);
          const unread = next.some((pair) => pair.protected?.distanceError === "rpc" || pair.unprotected?.distanceError === "rpc");
          if (unread && attempt < 3) setTimeout(() => setAttempt((value) => value + 1), 3_000);
        }
      })
      .catch(() => {
        if (!gone) setError("The twin pairs did not load. Refresh in a moment.");
      });
    return () => {
      gone = true;
    };
  }, [attempt]);

  if (error) return <p role="alert">{error}</p>;
  if (!pairs) return <p>Reading twin pairs.</p>;
  if (pairs.length === 0) return <p>No twin pairs are registered yet.</p>;

  const protectedAlive = pairs.filter((pair) => pair.protected?.outcome === "alive").length;
  const unprotectedLiquidated = pairs.filter((pair) => pair.unprotected && pair.unprotected.outcome !== "alive").length;

  return (
    <div className="twin-list">
      <div className="twins-summary">
        <Stat label="Pairs" value={String(pairs.length)} />
        <Stat label="Protected alive" value={String(protectedAlive)} />
        <Stat label="Unprotected liquidated" value={String(unprotectedLiquidated)} />
        <Stat label="Saves" value={String(saves)} testId="saves" hint="Still open after the market crossed the old liquidation price." />
      </div>
      {pairs.map((pair) => (
        <Card key={pair.id} title={`${pair.market} ${pair.side}`}>
          <article data-testid="twin-pair">
            <div className="twins-pair">
              <Leg title="Protected" role="protected" leg={pair.protected} />
              <Leg title="Unprotected" role="unprotected" leg={pair.unprotected} />
            </div>
          </article>
        </Card>
      ))}
    </div>
  );
}

function added(actions: readonly TwinAction[]): string {
  const total = actions.reduce((sum, action) => sum + BigInt(action.amountCNS || "0"), 0n);
  return `${formatAusd(total.toString())} AUSD`;
}

function Leg({ title, role, leg }: { title: string; role: "protected" | "unprotected"; leg: TwinLeg | null }) {
  if (!leg) {
    return (
      <div className="twins-leg">
        <h3>{title}</h3>
        <p>This leg is not registered.</p>
      </div>
    );
  }
  const badge = outcomeBadge(role, leg.outcome);
  const distance = leg.distanceE6 ? Number(leg.distanceE6) / 10_000 : 0;
  return (
    <div className="twins-leg">
      <h3>{title}</h3>
      <Badge tone={leg.outcome === "alive" ? "olive" : "danger"}>
        <span data-testid="outcome">{badge}</span>
      </Badge>
      {leg.distanceError === "rpc" || !leg.distanceE6 ? (
        <p>{leg.distanceError === "rpc" ? "Reading…" : "Distance unread"}</p>
      ) : (
        <>
          <DistanceGauge distancePct={distance} actBelowPct={4} safetyPct={6} />
          <p>{distancePctLabel(leg.distanceE6)} from liquidation</p>
        </>
      )}
      <p>
        {role === "protected"
          ? `Lifeline added ${added(leg.actions)} across ${leg.actions.length} top-ups`
          : `No Lifeline top-ups · ${leg.actions.length} recorded`}
      </p>
      <ul className="twins-actions">
        {leg.actions.map((action) => (
          <li key={action.txHash}>
            <a href={txUrl(action.txHash)} data-testid="twin-action" data-amount={action.amountCNS} data-account={leg.proxy}>
              {formatAusd(action.amountCNS)} AUSD{action.block ? ` · block ${formatGrouped(action.block)}` : ""}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
