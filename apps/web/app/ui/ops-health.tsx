"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { normalizeOpsHealth, unreachableOps, type OpsHealth } from "../../lib/ops-health";

interface OpsState extends OpsHealth {
  pulse: boolean;
}

const OpsContext = createContext<OpsState>({ ...unreachableOps(), pulse: false });

export function OpsHealthProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<OpsHealth>(unreachableOps());
  const [pulse, setPulse] = useState(false);
  const seen = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    let gone = false;
    let pulseTimer = 0;
    async function load() {
      try {
        const response = await fetch("/api/ops-health");
        const body: unknown = await response.json();
        if (gone) return;
        const next = response.ok ? normalizeOpsHealth(body) : unreachableOps();
        if (seen.current !== undefined && next.lastAlarmAt !== null && next.lastAlarmAt !== seen.current) {
          setPulse(true);
          window.clearTimeout(pulseTimer);
          pulseTimer = window.setTimeout(() => {
            if (!gone) setPulse(false);
          }, 700);
        }
        seen.current = next.lastAlarmAt;
        setHealth(next);
      } catch {
        if (!gone) setHealth(unreachableOps());
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      gone = true;
      window.clearInterval(timer);
      window.clearTimeout(pulseTimer);
    };
  }, []);

  return <OpsContext.Provider value={{ ...health, pulse }}>{children}</OpsContext.Provider>;
}

export function useOpsHealth(): OpsState {
  return useContext(OpsContext);
}
