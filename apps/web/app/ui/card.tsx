import type { ReactNode } from "react";
import "./card.css";

export function Card({ title, meta, children }: { title?: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-card">
      {title ? (
        <div className="ui-card-head">
          <h3>{title}</h3>
          {meta ? <div className="ui-card-meta">{meta}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
