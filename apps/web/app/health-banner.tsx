"use client";

import { useEffect, useState } from "react";

interface Flags {
  degraded: boolean;
  paused: boolean;
  rpc: boolean;
}

export function HealthBanner() {
  const [flags, setFlags] = useState<Flags>({ degraded: false, paused: false, rpc: false });
  useEffect(() => {
    let gone = false;
    void fetch("/api/ops-health")
      .then((response) => response.json())
      .then((body: Flags) => {
        if (!gone) setFlags(body);
      })
      .catch(() => {
        if (!gone) setFlags({ degraded: false, paused: false, rpc: true });
      });
    return () => {
      gone = true;
    };
  }, []);
  return (
    <div className="banners">
      {flags.degraded ? <div className="banner degraded">Lifeline degraded</div> : null}
      {flags.rpc ? <div className="banner rpc">RPC degraded</div> : null}
      {flags.paused ? <div className="banner paused">Lifeline paused</div> : null}
    </div>
  );
}
