"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatBlock } from "../../lib/format";
import { Heartbeat } from "./heartbeat";
import { useOpsHealth } from "./ops-health";
import "./status-pill.css";

const LABEL = {
  normal: "All systems normal",
  paused: "Lifeline is paused",
  degraded: "Lifeline is degraded",
  unreachable: "Status unavailable",
} as const;

export function StatusPill() {
  const health = useOpsHealth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const label = LABEL[health.status];
  return (
    <div className={`ui-status is-${health.status}`} ref={root}>
      <button
        type="button"
        className="ui-status-button"
        data-testid="status-pill"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ui-status-dot" aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <div className="ui-status-pop" id={panelId} role="region" aria-label="Lifeline status">
          <Heartbeat />
          <p>{health.lastBlock === null ? "Last block unavailable" : `Last ${formatBlock(health.lastBlock)}`}</p>
          <p>Practice accounts available: {health.poolAvailable}</p>
          <a href="/developers#status">Status details</a>
        </div>
      ) : null}
    </div>
  );
}
