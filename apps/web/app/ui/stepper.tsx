import "./stepper.css";

export type StepState = "upcoming" | "current" | "done" | "failed";

export interface Step {
  title: string;
  help: string;
  state: StepState;
}

const STATE_LABEL: Record<StepState, string> = {
  upcoming: "Upcoming",
  current: "Current",
  done: "Done",
  failed: "Failed",
};

function Mark({ state }: { state: StepState }) {
  return (
    <span className={`ui-step-mark is-${state}`} aria-hidden="true">
      {state === "done" ? (
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M3.5 8.2 L6.4 11 L12.5 4.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : null}
      {state === "failed" ? "×" : null}
    </span>
  );
}

export function Stepper({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="ui-steps">
      {steps.map((step) => (
        <li key={step.title} className={`ui-step is-${step.state}`}>
          <Mark state={step.state} />
          <span>
            <span className="sr">{STATE_LABEL[step.state]}: </span>
            <strong>{step.title}</strong>
            <span className="ui-step-help">{step.help}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
