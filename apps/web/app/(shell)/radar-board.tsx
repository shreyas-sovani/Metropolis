"use client";

import { useEffect, useState } from "react";
import { ExactBadge } from "../exact-badge";
import { bucketHit, crashLine } from "../../lib/crash-line";
import { formatPct, formatUsd } from "../../lib/format";
import type { CompactPosition } from "../../../../packages/core/src/radar/schema";

interface Bucket {
  index: number;
  side: "long" | "short";
  notionalMicro: string;
  count: number;
}

interface AtRisk {
  id: string;
  side: "long" | "short";
  distanceE6: string;
  notionalMicro: string;
  freeMicro: string;
}

interface Market {
  perpId: number;
  symbol: string;
  markMicro: string;
  buckets: Bucket[];
  atRisk: AtRisk[];
}

interface RadarPayload {
  chainId: 143 | 10143;
  blockNumber: string;
  headline: {
    openInterestMicro: string;
    atRiskNotionalMicro: string;
    atRiskCount: number;
    idleMicro: string;
  };
  markets: Market[];
  positions?: CompactPosition[];
  penalties?: { paidUsd: string; avoidableUsd: string; atStakeUsd: string };
  saves?: { count: number };
  calibrated?: boolean;
  names?: Record<string, string>;
  sparks?: Record<string, number[]>;
}

interface TapeRow {
  blockNumber: number;
  perpId: string;
  notionalMicro: string;
}

const MARK_INDEX = 60;

function bucketDetail(bucket: Bucket): string {
  const side = bucket.side === "long" ? "longs" : "shorts";
  return `${bucket.count} ${side} · ${formatUsd(bucket.notionalMicro)}`;
}

export function RadarBoard() {
  const [chain, setChain] = useState<"143" | "10143">("143");
  const [data, setData] = useState<RadarPayload | null>(null);
  const [tape, setTape] = useState<TapeRow[]>([]);
  const [picked, setPicked] = useState<AtRisk | null>(null);
  const [hover, setHover] = useState<string>("");
  const [error, setError] = useState("");
  const [shocks, setShocks] = useState<Record<number, number>>({});

  useEffect(() => {
    let gone = false;
    async function load() {
      try {
        const [radar, liquidations, markets, saves] = await Promise.all([
          fetch(`/api/radar?chain=${chain}`),
          fetch("/api/liquidations"),
          fetch("/api/markets"),
          fetch("/api/saves"),
        ]);
        if (!radar.ok) throw new Error("radar");
        const snapshot = (await radar.json()) as RadarPayload;
        const history = liquidations.ok ? ((await liquidations.json()) as { latest?: TapeRow[] }) : {};
        const meta = markets.ok ? ((await markets.json()) as { markets?: { perpId: number; name: string; spark: number[] }[] }) : {};
        const saveBody = saves.ok ? ((await saves.json()) as { count?: number }) : { count: 0 };
        const names: Record<string, string> = {};
        const sparks: Record<string, number[]> = {};
        for (const market of meta.markets ?? []) {
          names[String(market.perpId)] = market.name;
          sparks[String(market.perpId)] = market.spark;
        }
        if (!gone) {
          setData({ ...snapshot, saves: { count: saveBody.count ?? 0 }, names, sparks });
          setTape(history.latest ?? []);
          setError("");
        }
      } catch {
        if (!gone) setError("The book did not load. The onchain figures will return on the next refresh.");
      }
    }
    void load();
    const timer = setInterval(() => void load(), 2_000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [chain]);

  const penalties = data?.penalties;
  return (
    <div className="radar">
      <div className="radar-head">
        <div>
          <h1>Where the book can break</h1>
          <ExactBadge calibrated={data?.calibrated !== false} />
        </div>
        <div className="toggle" role="group" aria-label="Chain">
          <button type="button" aria-pressed={chain === "143"} onClick={() => setChain("143")}>
            Mainnet
          </button>
          <button type="button" aria-pressed={chain === "10143"} onClick={() => setChain("10143")}>
            Testnet
          </button>
        </div>
      </div>
      {error ? <p className="lede">{error}</p> : null}
      {data ? (
        <>
          <section className="headline" aria-label="Headline">
            <div>
              <span>Open interest</span>
              <strong data-testid="open-interest">{formatUsd(data.headline.openInterestMicro)}</strong>
            </div>
            <div>
              <span>At risk</span>
              <strong data-testid="at-risk-count">
                {data.headline.atRiskCount} · {formatUsd(data.headline.atRiskNotionalMicro)}
              </strong>
            </div>
            <div>
              <span>Idle beside at-risk</span>
              <strong data-testid="idle">{formatUsd(data.headline.idleMicro)}</strong>
            </div>
            <div>
              <span>Block</span>
              <strong data-testid="block">{data.blockNumber}</strong>
            </div>
          </section>
          <p className="penalty" data-testid="penalties">
            Liquidation penalties paid in 30 days: {penalties?.paidUsd ?? "$0"}. Avoidable with the account&apos;s own idle
            AUSD: {penalties?.avoidableUsd ?? "$0"}.
          </p>
          <p className="penalty" data-testid="at-stake">
            Penalty at stake now: {penalties?.atStakeUsd ?? "$0"}.
          </p>
          <p className="penalty" data-testid="saves">
            Saves {data.saves?.count ?? 0}
          </p>
          <div className="book">
            <div data-map>
              {data.markets.map((market) => (
                <article className="panel map" key={market.perpId}>
                  <h2>
                    {data.names?.[String(market.perpId)] ?? market.symbol}{" "}
                    <span className="mark-price">{formatUsd(market.markMicro)}</span>
                  </h2>
                  <Spark points={data.sparks?.[String(market.perpId)] ?? []} />
                  <CrashSlider
                    perpId={market.perpId}
                    symbol={market.symbol}
                    shock={shocks[market.perpId] ?? 0}
                    positions={data.positions ?? []}
                    onChange={(value) => {
                      performance.mark(`crash-${market.perpId}-start`);
                      setShocks((current) => ({ ...current, [market.perpId]: value }));
                      requestAnimationFrame(() => {
                        performance.mark(`crash-${market.perpId}-end`);
                        performance.measure(
                          `crash-${market.perpId}`,
                          `crash-${market.perpId}-start`,
                          `crash-${market.perpId}-end`,
                        );
                      });
                    }}
                  />
                  <div className="buckets">
                    <div className="mark-line" aria-hidden="true" />
                    {market.buckets.map((bucket) => (
                      <button
                        key={`${bucket.side}-${bucket.index}`}
                        type="button"
                        className={`bucket ${bucket.side}${bucketHit(bucket.index, bucket.side, shocks[market.perpId] ?? 0) ? " hit" : ""}`}
                        data-testid="bucket"
                        style={{ height: `${12 + Math.min(bucket.count, 20) * 4}px` }}
                        onMouseEnter={() => setHover(bucketDetail(bucket))}
                        onFocus={() => setHover(bucketDetail(bucket))}
                        onMouseLeave={() => setHover("")}
                      >
                        <span className="sr">{bucketDetail(bucket)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="bands">1% · 2% · 5% around the mark at bucket {MARK_INDEX}</p>
                </article>
              ))}
            </div>
            <aside className="panel">
              <h2>At risk</h2>
              <p data-testid="bucket-detail">{hover || "Hover a bucket for the anonymized size."}</p>
              <ul className="risk-list">
                {data.markets.flatMap((market) =>
                  market.atRisk.map((row) => (
                    <li key={`${market.perpId}-${row.id}`}>
                      <button type="button" onClick={() => setPicked(row)}>
                        {row.id} · {row.side} · {formatPct(row.distanceE6)}
                      </button>
                    </li>
                  )),
                )}
              </ul>
              {picked ? (
                <div data-testid="risk-detail">
                  <p>
                    {picked.id} {picked.side} · {formatUsd(picked.notionalMicro)} notional · {formatPct(picked.distanceE6)} from
                    liquidation · {formatUsd(picked.freeMicro)} idle
                  </p>
                </div>
              ) : null}
              <h2>Recent liquidations</h2>
              <ul className="tape">
                {tape.slice(-8).map((row) => (
                  <li key={`${row.blockNumber}-${row.perpId}`}>
                    Block {row.blockNumber} · perp {row.perpId} · {formatUsd(row.notionalMicro)}
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </>
      ) : (
        <p className="lede">Reading the book.</p>
      )}
    </div>
  );
}

function CrashSlider({
  perpId,
  symbol,
  shock,
  positions,
  onChange,
}: {
  perpId: number;
  symbol: string;
  shock: number;
  positions: CompactPosition[];
  onChange: (value: number) => void;
}) {
  const line = crashLine(positions, perpId, symbol, shock);
  return (
    <div className="crash">
      <label>
        Shock {symbol}
        <input
          type="range"
          min={-10}
          max={10}
          step={1}
          value={shock}
          aria-label={`Shock ${symbol}`}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
      <p data-testid="crash-line">{line.text}</p>
      <p className="bands" data-testid="crash-label">
        {line.label}
      </p>
    </div>
  );
}

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 120;
      const y = 24 - ((point - min) / span) * 20;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="spark" viewBox="0 0 120 24" aria-hidden="true" data-testid="spark">
      <path d={path} />
    </svg>
  );
}
