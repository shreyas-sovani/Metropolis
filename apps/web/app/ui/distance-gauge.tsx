import { useEffect, useState } from "react";
import { formatPctOne } from "../../lib/format";
import "./distance-gauge.css";

function oneDecimal(value: number): string {
  return formatPctOne(value);
}

export function gaugeText(distancePct: number, actBelowPct: number, safetyPct: number): string {
  return `${oneDecimal(distancePct)} from liquidation. Lifeline acts below ${oneDecimal(actBelowPct)} and restores ${oneDecimal(safetyPct)}.`;
}

function place(value: number): string {
  const clamped = Math.min(15, Math.max(0, value));
  return `${(clamped / 15) * 100}%`;
}

export function DistanceGauge({
  distancePct,
  actBelowPct,
  safetyPct,
  fromPct,
}: {
  distancePct: number;
  actBelowPct: number;
  safetyPct: number;
  fromPct?: number;
}) {
  const [marker, setMarker] = useState(fromPct ?? distancePct);
  useEffect(() => {
    if (fromPct == null) {
      setMarker(distancePct);
      return;
    }
    setMarker(fromPct);
    const id = window.setTimeout(() => setMarker(distancePct), 40);
    return () => window.clearTimeout(id);
  }, [distancePct, fromPct]);
  const text = gaugeText(distancePct, actBelowPct, safetyPct);
  return (
    <div className="ui-gauge">
      <div className="ui-gauge-track" aria-hidden="true">
        <span className="ui-gauge-edge">0%</span>
        <span className="ui-gauge-mark ui-gauge-now" style={{ left: place(marker) }} />
        <span className="ui-gauge-mark ui-gauge-act" style={{ left: place(actBelowPct) }} />
        <span className="ui-gauge-mark ui-gauge-safe" style={{ left: place(safetyPct) }} />
        <span className="ui-gauge-edge ui-gauge-end">15%</span>
      </div>
      <p>{text}</p>
    </div>
  );
}
