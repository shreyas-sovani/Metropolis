import { PROBLEM_CAPTION } from "../../../lib/landing";

export function ProblemDiagram() {
  return (
    <figure className="landing-figure">
      <svg className="landing-diagram" viewBox="0 0 640 200" aria-hidden="true">
        <text x="0" y="28">
          Position margin
        </text>
        <rect className="landing-bar-margin" x="168" y="12" width="112" height="22" rx="6" />
        <text className="is-danger" x="292" y="28">
          Liquidated
        </text>
        <text x="0" y="84">
          Idle AUSD
        </text>
        <rect className="landing-bar-idle" x="168" y="66" width="280" height="22" rx="6" />
        <text className="is-muted" x="460" y="84">
          Stays put
        </text>
        <path className="landing-fall" d="M560 24 L608 148" />
        <path className="landing-fall" d="M596 136 L608 148 L620 136" />
        <text x="548" y="176">
          Price
        </text>
      </svg>
      <figcaption id="problem-caption">{PROBLEM_CAPTION}</figcaption>
    </figure>
  );
}
