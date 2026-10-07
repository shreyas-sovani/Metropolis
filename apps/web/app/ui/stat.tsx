import "./stat.css";

export function Stat({
  label,
  value,
  hint,
  testId,
  title,
}: {
  label: string;
  value: string;
  hint?: string;
  testId?: string;
  title?: string;
}) {
  return (
    <div className="ui-stat">
      <div className="ui-stat-label">{label}</div>
      <div className="ui-stat-value" data-testid={testId} title={title}>
        {value}
      </div>
      {hint ? <div className="ui-stat-hint">{hint}</div> : null}
    </div>
  );
}
