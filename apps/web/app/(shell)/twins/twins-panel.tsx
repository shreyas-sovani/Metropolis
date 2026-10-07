"use client";

import { useEffect, useState } from "react";
import { formatPct } from "../../../lib/format";
import { outcomeBadge, outcomeTone, txUrl } from "../../../lib/twins-view";

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

  return (
    <div className="twin-list">
      <p data-testid="saves">Saves {saves}</p>
      {pairs.map((pair) => (
        <article className="panel" key={pair.id} data-testid="twin-pair">
          <h2>
            {pair.market} {pair.side}
          </h2>
          <div className="twins">
            <Leg title="Protected" role="protected" leg={pair.protected} />
            <Leg title="Unprotected" role="unprotected" leg={pair.unprotected} />
          </div>
        </article>
      ))}
    </div>
  );
}

function Leg({ title, role, leg }: { title: string; role: "protected" | "unprotected"; leg: TwinLeg | null }) {
  if (!leg) return <div><h3>{title}</h3><p>This leg is not registered.</p></div>;
  const badge = outcomeBadge(role, leg.outcome);
  return (
    <div>
      <h3>{title}</h3>
      <p className={`badge ${outcomeTone(leg.outcome)}`} data-testid="outcome">
        {badge}
      </p>
      <p>Distance {leg.distanceError === "rpc" ? "Reading…" : leg.distanceE6 ? formatPct(leg.distanceE6) : "unread"} · mandate {leg.mandate}</p>
      {leg.actions.length === 0 ? <p>No confirmed top-ups yet.</p> : null}
      <ul className="risk-list">
        {leg.actions.map((action) => (
          <li key={action.txHash}>
            <a href={txUrl(action.txHash)} data-testid="twin-action" data-amount={action.amountCNS} data-account={leg.proxy}>
              {action.amountCNS} CNS
              {action.block ? ` · block ${action.block}` : ""}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
