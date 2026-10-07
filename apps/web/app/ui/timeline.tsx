"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatAgo } from "../../lib/format";
import { TxLink } from "./tx-link";
import "./timeline.css";

export interface TimelineRow {
  title: string;
  sentence: string;
  at: number;
  hash?: string;
  chainId?: number;
  icon?: ReactNode;
}

function When({ at }: { at: number }) {
  const [label, setLabel] = useState("…");
  const [absolute, setAbsolute] = useState("");
  useEffect(() => {
    setLabel(formatAgo(at));
    setAbsolute(new Date(at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }));
  }, [at]);
  return (
    <time dateTime={new Date(at).toISOString()} title={absolute || undefined}>
      {label}
    </time>
  );
}

export function Timeline({ rows }: { rows: readonly TimelineRow[] }) {
  return (
    <ol className="ui-timeline">
      {rows.map((row) => (
        <li key={`${row.title}-${row.at}`}>
          <span className="ui-timeline-icon" aria-hidden="true">
            {row.icon ?? <span className="ui-timeline-dot" />}
          </span>
          <div>
            <strong>{row.title}</strong>
            <p>{row.sentence}</p>
            <div className="ui-timeline-meta">
              <When at={row.at} />
              {row.hash ? <TxLink hash={row.hash} chainId={row.chainId ?? 10143} /> : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
