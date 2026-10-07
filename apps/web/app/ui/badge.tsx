import type { ReactNode } from "react";
import "./badge.css";

export type BadgeTone = "neutral" | "clay" | "olive" | "blue" | "danger";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`ui-badge ui-badge-${tone}`}>
      <span className="ui-badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
