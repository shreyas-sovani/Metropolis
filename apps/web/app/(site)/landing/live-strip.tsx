"use client";

import { useEffect, useState } from "react";
import { formatBlock, formatUsd, formatUsdCompact } from "../../../lib/format";
import { LIVE_LABEL, LIVE_WAIT } from "../../../lib/landing";
import { LANDING_MS } from "../../../lib/poll";
import { ContractExactBadge } from "../../ui/contract-exact-badge";
import { Skeleton } from "../../ui/skeleton";

interface RadarHeadline {
  openInterestMicro: string;
  atRiskNotionalMicro: string;
  atRiskCount: number;
  idleMicro: string;
}

interface RadarPayload {
  blockNumber: string;
  calibrated?: boolean;
  headline: RadarHeadline;
  penalties?: { paidUsd: string };
}

type Phase = "loading" | "ready" | "error";

export function LiveStrip() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<RadarPayload | null>(null);

  useEffect(() => {
    let gone = false;
    async function load() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/radar?chain=143");
        if (!response.ok) throw new Error("radar");
        const json = (await response.json()) as RadarPayload;
        if (gone) return;
        setData(json);
        setPhase("ready");
      } catch {
        if (!gone) setPhase((current) => (current === "ready" ? "ready" : "error"));
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), LANDING_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      gone = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  const headline = data?.headline;
  return (
    <section className="landing-live" aria-labelledby="live-label" data-testid="live-strip" aria-busy={phase === "loading"} aria-live="polite">
      <div className="container">
        <p id="live-label" className="landing-live-label">
          <span>{LIVE_LABEL}</span>
          {phase === "ready" && data ? (
            <span className="tabular" data-testid="landing-block">
              {formatBlock(data.blockNumber)}
            </span>
          ) : null}
          {phase === "ready" && data ? <ContractExactBadge calibrated={data.calibrated !== false} /> : null}
        </p>
        {phase === "loading" ? (
          <div className="landing-live-skel" aria-hidden="true">
            <Skeleton width="18%" height={22} />
            <Skeleton width="28%" height={22} />
            <Skeleton width="22%" height={22} />
            <Skeleton width="16%" height={22} />
          </div>
        ) : null}
        {phase === "error" ? <p className="landing-live-wait">{LIVE_WAIT}</p> : null}
        {phase === "ready" && headline ? (
          <p className="landing-figures">
            <span data-testid="landing-open-interest">
              <span className="tabular" title={formatUsd(headline.openInterestMicro)}>
                {formatUsdCompact(headline.openInterestMicro)}
              </span>{" "}
              open interest
            </span>
            <span data-testid="landing-at-risk">
              <span className="tabular">{headline.atRiskCount}</span> positions within 5% (
              <span className="tabular" title={formatUsd(headline.atRiskNotionalMicro)}>
                {formatUsdCompact(headline.atRiskNotionalMicro)}
              </span>
              )
            </span>
            <span data-testid="landing-idle">
              <span className="tabular" title={formatUsd(headline.idleMicro)}>
                {formatUsdCompact(headline.idleMicro)}
              </span>{" "}
              idle beside them
            </span>
            <span data-testid="landing-penalties">
              <span className="tabular" title={data?.penalties?.paidUsd ?? "$0"}>
                {data?.penalties?.paidUsd ?? "$0"}
              </span>{" "}
              penalties (30 days)
            </span>
          </p>
        ) : null}
        <p className="landing-live-more">
          <a href="/radar">See the market risk map</a>
        </p>
      </div>
    </section>
  );
}
