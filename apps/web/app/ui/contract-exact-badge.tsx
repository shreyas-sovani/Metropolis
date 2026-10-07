import summary from "../../../../packages/core/test/fixtures/g4-fork-summary.json";
import { calibrationMark } from "../../lib/badge";
import "./contract-exact-badge.css";

export function ContractExactBadge({ calibrated }: { calibrated: boolean }) {
  const mark = calibrationMark(calibrated);
  if (mark.kind === "est") return <span className="est">{mark.label}</span>;
  const tip = `Matches Perpl's contract to the tick on ${summary.positions} live positions.`;
  return (
    <a className="ui-exact" href="/methodology" title={tip}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M3 8.5 L6.2 11.5 L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {mark.label}
    </a>
  );
}
