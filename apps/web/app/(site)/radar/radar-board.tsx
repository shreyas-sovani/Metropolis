"use client";

import { useEffect, useRef, useState } from "react";
import { ExactBadge } from "../../exact-badge";
import { ONE_LINER } from "../../../lib/copy";
import { bucketHit, crashLine } from "../../../lib/crash-line";
import { MAINNET_ID, blockUrl, txUrl } from "../../../lib/explorer";
import { formatPct, formatUsd } from "../../../lib/format";
import { LIQUIDATIONS_MS, MARKETS_MS, RADAR_MS, SAVES_MS, pollDue } from "../../../lib/poll";
import { liquidationTape } from "../../../lib/tape";
import type { CompactPosition } from "../../../../../packages/core/src/radar/schema";

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
  symbol?: string;
  side?: string;
  txHash?: string;
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
  const urlApplied = useRef(false);

  const polled = useRef({ liquidations: null as number | null, markets: null as number | null, saves: null as number | null });

  useEffect(() => {
    let gone = false;
    async function load() {
      if (document.visibilityState !== "visible") return;
      try {
        const params = new URLSearchParams(window.location.search);
        if (!urlApplied.current) {
          urlApplied.current = true;
          if (params.get("chain") === "10143" && chain !== "10143") {
            setChain("10143");
            return;
          }
        }
        const now = Date.now();
        const fault = process.env.NODE_ENV !== "production" && params.get("rpc") === "dead";
        const radar = await fetch(`/api/radar?chain=${chain}${fault ? "&rpc=dead" : ""}`);
        if (!radar.ok) throw new Error("radar");
        const snapshot = (await radar.json()) as RadarPayload;
        const wantHistory = pollDue(polled.current.liquidations, now, LIQUIDATIONS_MS);
        const wantMarkets = pollDue(polled.current.markets, now, MARKETS_MS);
        const wantSaves = pollDue(polled.current.saves, now, SAVES_MS);
        if (wantHistory) polled.current.liquidations = now;
        if (wantMarkets) polled.current.markets = now;
        if (wantSaves) polled.current.saves = now;
        const [liquidations, markets, saves] = await Promise.all([
          wantHistory ? fetch("/api/liquidations") : Promise.resolve(null),
          wantMarkets ? fetch("/api/markets") : Promise.resolve(null),
          wantSaves ? fetch("/api/saves") : Promise.resolve(null),
        ]);
        const history = liquidations?.ok ? ((await liquidations.json()) as { latest?: TapeRow[] }) : null;
        const meta = markets?.ok ? ((await markets.json()) as { markets?: { perpId: number; name: string; spark: number[] }[] }) : null;
        const saveBody = saves?.ok ? ((await saves.json()) as { count?: number }) : null;
        if (!gone) {
          setData((current) => {
            const names = { ...(current?.names ?? {}) };
            const sparks = { ...(current?.sparks ?? {}) };
            for (const market of meta?.markets ?? []) {
              names[String(market.perpId)] = market.name;
              sparks[String(market.perpId)] = market.spark;
            }
            return {
              ...snapshot,
              saves: saveBody ? { count: saveBody.count ?? 0 } : current?.saves,
              names,
              sparks,
            };
          });
          if (history) setTape(history.latest ?? []);
          setError("");
        }
      } catch {
        if (!gone) setError("The book did not load. The onchain figures will return on the next refresh.");
      }
    }
    void load();
    const timer = setInterval(() => void load(), RADAR_MS);
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
          <p className="lede">{ONE_LINER}</p>
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
      {error ? <p className="lede" role="alert">{error}</p> : null}
      {data && data.markets.length === 0 ? <p>No open positions on this chain yet.</p> : null}
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
                  <li key={`${row.blockNumber}-${row.perpId}-${row.txHash ?? ""}`}>
                    <a href={row.txHash ? txUrl(MAINNET_ID, row.txHash) : blockUrl(MAINNET_ID, row.blockNumber)}>
                      {liquidationTape({
                        symbol: row.symbol ?? "",
                        side: row.side ?? "",
                        notionalMicro: row.notionalMicro,
                        blockNumber: row.blockNumber,
                      })}
                    </a>
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
