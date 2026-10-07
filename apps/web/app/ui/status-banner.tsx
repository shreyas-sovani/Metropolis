"use client";

import { useOpsHealth } from "./ops-health";
import "./status-banner.css";

export function StatusBanner() {
  const health = useOpsHealth();
  if (!health.paused && !health.degraded) return null;
  return (
    <div className="status-banners">
      {health.paused ? <div className="status-banner is-paused">Lifeline paused</div> : null}
      {health.degraded ? <div className="status-banner is-degraded">Lifeline degraded</div> : null}
    </div>
  );
}
