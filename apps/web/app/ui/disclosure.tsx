import type { ReactNode } from "react";
import "./disclosure.css";

export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="ui-disclosure">
      <summary>{title}</summary>
      <div className="ui-disclosure-body">{children}</div>
    </details>
  );
}
