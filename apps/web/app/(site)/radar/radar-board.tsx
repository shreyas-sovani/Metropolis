"use client";

import { useEffect, useRef, useState } from "react";
import { ContractExactBadge } from "../../ui/contract-exact-badge";
import { TourStop } from "../../ui/tour-state";
import { Skeleton } from "../../ui/skeleton";
import { Stat } from "../../ui/stat";
import { MAINNET_ID, blockUrl, txUrl } from "../../../lib/explorer";
import { formatAgo, formatPct, formatUsd, formatUsdCompact } from "../../../lib/format";
import { LIQUIDATIONS_MS, MARKETS_MS, RADAR_MS, SAVES_MS, pollDue } from "../../../lib/poll";
import {
  blockAgo,
  defaultMarketId,
  emptyMarketLine,
  emptyMarketSymbols,
  highlightedBucket,
  marketsForChart,
  penaltySentence,
  riskSentence,
} from "../../../lib/radar-view";
import { liquidationTape } from "../../../lib/tape";
import type { CompactPosition } from "../../../../../packages/core/src/radar/schema";
import { RadarChart, type ChartBucket } from "./radar-chart";
import "./radar.css";

interface AtRisk {
  id: string;
  side: "long" | "short";
  distanceE6: string;
  notionalMicro: string;
  freeMicro: string;
  couldProtectNow?: boolean;
  bucketIndex?: number;
}

interface Market {
  perpId: number;
  symbol: string;
  markMicro: string;
  atRiskNotionalMicro?: string;
  buckets: ChartBucket[];
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
  highlightId?: string;
}

interface TapeRow {
  blockNumber: number;
  perpId: string;
  notionalMicro: string;
  symbol?: string;
  side?: string;
  txHash?: string;
}

interface RiskPick extends AtRisk {
  market: string;
  symbol: string;
}

const PAGE = 25;

async function fetchPracticeAccount(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch("/api/lifeline/me", { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { claim?: { proxy?: string } | null };
    const proxy = body.claim?.proxy;
    return typeof proxy === "string" && /^0x[0-9a-fA-F]{40}$/.test(proxy) ? proxy : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function RadarBoard() {
  const [chain, setChain] = useState<"143" | "10143">("143");
  const [data, setData] = useState<RadarPayload | null>(null);
  const [tape, setTape] = useState<TapeRow[]>([]);
  const [picked, setPicked] = useState<RiskPick | null>(null);
  const [hover, setHover] = useState("");
  const [error, setError] = useState("");
  const [shocks, setShocks] = useState<Record<number, number>>({});
  const [marketId, setMarketId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [urlReady, setUrlReady] = useState(false);
  const polled = useRef({ liquidations: null as number | null, markets: null as number | null, saves: null as number | null });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!picked) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPicked(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("chain") === "10143" ? "10143" : "143";
    setChain(wanted);
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    let gone = false;
    async function load() {
      if (document.visibilityState !== "visible") return;
      try {
        const params = new URLSearchParams(window.location.search);
        const nowMs = Date.now();
        const fault = process.env.NODE_ENV !== "production" && params.get("rpc") === "dead";
        const proxy = chain === "10143" ? await fetchPracticeAccount() : null;
        const highlight = proxy ? `&highlight=${encodeURIComponent(proxy)}` : "";
        const radar = await fetch(`/api/radar?chain=${chain}${fault ? "&rpc=dead" : ""}${highlight}`);
        if (!radar.ok) throw new Error("radar");
        const snapshot = (await radar.json()) as RadarPayload;
        const wantHistory = pollDue(polled.current.liquidations, nowMs, LIQUIDATIONS_MS);
        const wantMarkets = pollDue(polled.current.markets, nowMs, MARKETS_MS);
        const wantSaves = pollDue(polled.current.saves, nowMs, SAVES_MS);
        if (wantHistory) polled.current.liquidations = nowMs;
        if (wantMarkets) polled.current.markets = nowMs;
        if (wantSaves) polled.current.saves = nowMs;
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
          setFetchedAt(Date.now());
          setError("");
        }
      } catch {
        if (!gone) setError("The market risk map didn't load. It will try again in a moment.");
      }
    }
    void load();
    const timer = setInterval(() => void load(), RADAR_MS);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [chain, urlReady]);

  const charts = data ? marketsForChart(data.markets) : [];
  const emptyLine = data ? emptyMarketLine(emptyMarketSymbols(data.markets)) : null;
  const activeId = charts.some((market) => market.perpId === marketId) ? marketId : defaultMarketId(charts);
  const active = charts.find((market) => market.perpId === activeId) ?? null;
  const penalties = data?.penalties;
  const rows = data
    ? data.markets
        .flatMap((market) =>
          market.atRisk.map((row) => ({
            ...row,
            market: data.names?.[String(market.perpId)] ?? market.symbol,
            symbol: market.symbol,
            perpId: market.perpId,
          })),
        )
        .sort((left, right) => Number(left.distanceE6) - Number(right.distanceE6))
    : [];
  const visible = showAll ? rows : rows.slice(0, PAGE);
  const yours = active ? highlightedBucket(active.atRisk, data?.highlightId) : null;

  return (
    <div className="ui-scope">
      <div className="container radar-page">
        <TourStop page="radar" />
        <header className="radar-head">
          <div>
            <h1>Market risk</h1>
            <p className="radar-sub body-lg">Every open Perpl position, read from the contract, with its exact liquidation price.</p>
            <div className="radar-meta">
              <ContractExactBadge calibrated={data?.calibrated !== false} />
              {data ? (
                <p className="radar-asof small">
                  block <span data-testid="block">{Number(data.blockNumber).toLocaleString("en-US")}</span>
                  {fetchedAt ? ` · ${formatAgo(fetchedAt, now)}` : null}
                </p>
              ) : null}
            </div>
          </div>
          <div className="radar-chain" role="group" aria-label="Chain">
            <button type="button" aria-pressed={chain === "143"} onClick={() => setChain("143")}>
              Mainnet · live, read-only
            </button>
            <button type="button" aria-pressed={chain === "10143"} onClick={() => setChain("10143")}>
              Testnet · where Lifeline acts
            </button>
          </div>
        </header>
        {error ? (
          <p className="radar-note" role="alert">
            {error}
          </p>
        ) : null}
        {!data ? (
          <div className="radar-skeletons" aria-hidden="true">
            <Skeleton height={28} width="40%" />
            <Skeleton height={72} />
            <Skeleton height={240} />
          </div>
        ) : null}
        {data && data.markets.length === 0 ? <p>No open positions on this chain yet.</p> : null}
        {data ? (
          <>
            <section className="radar-stats" aria-label="Headline">
              <Stat
                label="Open interest"
                value={formatUsdCompact(data.headline.openInterestMicro)}
                title={formatUsd(data.headline.openInterestMicro)}
                testId="open-interest"
              />
              <Stat
                label="Within 5% of liquidation"
                value={`${data.headline.atRiskCount} · ${formatUsdCompact(data.headline.atRiskNotionalMicro)}`}
                title={formatUsd(data.headline.atRiskNotionalMicro)}
                testId="at-risk-count"
              />
              <Stat
                label="Idle AUSD beside them"
                value={formatUsdCompact(data.headline.idleMicro)}
                title={formatUsd(data.headline.idleMicro)}
                testId="idle"
              />
              <Stat label="Penalties paid in 30 days" value={penalties?.paidUsd ?? "$0"} title={penalties?.paidUsd ?? "$0"} />
            </section>
            <p className="radar-note" data-testid="penalties">
              {penaltySentence(penalties?.paidUsd ?? "$0", penalties?.avoidableUsd ?? "$0")}
            </p>
            <p className="radar-note" data-testid="at-stake">
              Penalty at stake now: {penalties?.atStakeUsd ?? "$0"}.
            </p>
            <p className="radar-saves" data-testid="saves">
              Saves {data.saves?.count ?? 0}
            </p>
            {charts.length > 0 ? (
              <div className="radar-chips" role="group" aria-label="Market">
                {charts.map((market) => {
                  const label = data.names?.[String(market.perpId)] ?? market.symbol;
                  return (
                    <button
                      key={market.perpId}
                      type="button"
                      className="radar-chip"
                      aria-pressed={market.perpId === activeId}
                      onClick={() => setMarketId(market.perpId)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {emptyLine ? <p className="radar-note">{emptyLine}</p> : null}
            {active ? (
              <RadarChart
                symbol={active.symbol}
                name={data.names?.[String(active.perpId)] ?? active.symbol}
                markMicro={active.markMicro}
                buckets={active.buckets}
                shock={shocks[active.perpId] ?? 0}
                positions={data.positions ?? []}
                perpId={active.perpId}
                spark={data.sparks?.[String(active.perpId)] ?? []}
                yours={yours}
                onHover={setHover}
                onShock={(value) => {
                  performance.mark(`crash-${active.perpId}-start`);
                  setShocks((current) => ({ ...current, [active.perpId]: value }));
                  requestAnimationFrame(() => {
                    performance.mark(`crash-${active.perpId}-end`);
                    performance.measure(`crash-${active.perpId}`, `crash-${active.perpId}-start`, `crash-${active.perpId}-end`);
                  });
                }}
              />
            ) : null}
            <p className="radar-tip" data-testid="bucket-detail">
              {hover || "Hover a bar for the anonymized size."}
            </p>
            <section>
              <h2>Closest to liquidation</h2>
              <div className="radar-table-wrap">
                <table className="radar-table">
                  <caption className="sr">Open positions within 5% of liquidation</caption>
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Side</th>
                      <th className="num">Size ($)</th>
                      <th className="num">Distance</th>
                      <th className="num">Idle beside it</th>
                      <th>Lifeline could protect now</th>
                      <th>Anonymized id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => {
                      const owned = data.highlightId === row.id;
                      return (
                        <tr key={`${row.perpId}-${row.id}-${row.side}`} className={owned ? "radar-row-yours" : undefined}>
                          <td>
                            {row.market}
                            {owned ? " · Your position" : ""}
                          </td>
                          <td>{row.side}</td>
                          <td className="num" title={formatUsd(row.notionalMicro)}>
                            {formatUsdCompact(row.notionalMicro)}
                          </td>
                          <td className="num">{formatPct(row.distanceE6)}</td>
                          <td className="num" title={formatUsd(row.freeMicro)}>
                            {formatUsdCompact(row.freeMicro)}
                          </td>
                          <td>{row.couldProtectNow ? "Yes" : "No"}</td>
                          <td>
                            <button type="button" className="radar-id" onClick={() => setPicked(row)}>
                              {row.id}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {rows.length > PAGE ? (
                <button type="button" className="radar-more" onClick={() => setShowAll(true)}>
                  Show all.
                </button>
              ) : null}
            </section>
            <section>
              <h2>Recent liquidations (mainnet).</h2>
              {tape.length === 0 ? <p className="radar-note">None in the last 30 days.</p> : null}
              <ul className="radar-tape">
                {tape.slice(-8).map((row) => (
                  <li key={`${row.blockNumber}-${row.perpId}-${row.txHash ?? ""}`}>
                    <a
                      href={row.txHash ? txUrl(MAINNET_ID, row.txHash) : blockUrl(MAINNET_ID, row.blockNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {liquidationTape({
                        symbol: row.symbol ?? "",
                        side: row.side ?? "",
                        notionalMicro: row.notionalMicro,
                        blockNumber: row.blockNumber,
                      })}
                      {data ? ` · ${blockAgo(data.blockNumber, row.blockNumber, now)}` : ""}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </div>
      {picked ? (
        <>
          <button type="button" className="radar-drawer-back" aria-label="Close position details" onClick={() => setPicked(null)} />
          <aside className="radar-drawer" role="dialog" aria-label="Position" data-testid="risk-detail">
            <button type="button" className="radar-close" onClick={() => setPicked(null)}>
              Close
            </button>
            <h2>{data?.highlightId === picked.id ? "Your position" : picked.id}</h2>
            <p>{riskSentence(picked)}</p>
            <p>{picked.couldProtectNow ? "Lifeline could protect this position now." : "Lifeline could not protect this position now."}</p>
            <a href="/check">Check an address</a>
          </aside>
        </>
      ) : null}
    </div>
  );
}
