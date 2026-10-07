import "./distance-gauge.css";

function oneDecimal(value: number): string {
  return `${value.toFixed(1)}%`;
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
}: {
  distancePct: number;
  actBelowPct: number;
  safetyPct: number;
}) {
  const text = gaugeText(distancePct, actBelowPct, safetyPct);
  return (
    <div className="ui-gauge">
      <div className="ui-gauge-track" aria-hidden="true">
        <span className="ui-gauge-edge">0%</span>
        <span className="ui-gauge-mark ui-gauge-now" style={{ left: place(distancePct) }} />
        <span className="ui-gauge-mark ui-gauge-act" style={{ left: place(actBelowPct) }} />
        <span className="ui-gauge-mark ui-gauge-safe" style={{ left: place(safetyPct) }} />
        <span className="ui-gauge-edge ui-gauge-end">15%</span>
      </div>
      <p>{text}</p>
    </div>
  );
}
