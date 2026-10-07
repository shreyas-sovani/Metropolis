import { Button } from "./button";
import "./tour-rail.css";

export function TourRail({
  stop,
  total,
  title,
  inline = false,
  onBack,
  onNext,
  onExit,
}: {
  stop: number;
  total: number;
  title: string;
  inline?: boolean;
  onBack?: () => void;
  onNext?: () => void;
  onExit?: () => void;
}) {
  return (
    <div className={inline ? "ui-tour is-inline" : "ui-tour"} role="region" aria-label="Judge tour">
      <p>
        Judge tour · Stop {stop} of {total} · {title}
      </p>
      <div className="ui-tour-actions">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onNext}>
          Next
        </Button>
        <Button variant="quiet" onClick={onExit}>
          Exit tour
        </Button>
      </div>
    </div>
  );
}
