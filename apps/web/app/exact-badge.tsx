import { calibrationMark } from "../lib/badge";

export function ExactBadge({ calibrated }: { calibrated: boolean }) {
  const mark = calibrationMark(calibrated);
  if (mark.kind === "est") return <span className="est">{mark.label}</span>;
  return (
    <a className="exact" href="/methodology">
      {mark.label}
    </a>
  );
}
