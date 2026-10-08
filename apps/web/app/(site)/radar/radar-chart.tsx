"use client";

import { bucketHit, crashLine } from "../../../lib/crash-line";
import { axisFraction, axisTicks, barFraction, bucketLeft, bucketSentence, BUCKET_SLOTS } from "../../../lib/radar-view";
import { formatCoord, formatUsd } from "../../../lib/format";
import { PercentSlider } from "../../ui/percent-slider";
import type { CompactPosition } from "../../../../../packages/core/src/radar/schema";

export interface ChartBucket {
  index: number;
  side: "long" | "short";
  notionalMicro: string;
  count: number;
  idleCount?: number;
}

export function RadarChart({
  symbol,
  name,
  markMicro,
  buckets,
  shock,
  positions,
  perpId,
  spark,
  yours,
  onShock,
  onHover,
}: {
  symbol: string;
  name: string;
  markMicro: string;
  buckets: ChartBucket[];
  shock: number;
  positions: CompactPosition[];
  perpId: number;
  spark: number[];
  yours: { index: number; side: "long" | "short" } | null;
  onShock: (value: number) => void;
  onHover: (text: string) => void;
}) {
  const line = crashLine(positions, perpId, symbol, shock);
  const max = buckets.reduce((peak, bucket) => {
    const value = BigInt(bucket.notionalMicro || "0");
    return value > peak ? value : peak;
  }, 0n);
  const maxText = max.toString();
  const ticks = axisTicks(markMicro);
  return (
    <article className="radar-market">
      <div className="radar-market-head">
        <h2>
          {name} <span className="radar-mark-price">{formatUsd(markMicro)}</span>
        </h2>
        <Spark points={spark} />
      </div>
      <div className="radar-chart-scroll" data-map>
        <div className="radar-chart">
          <p className="radar-y">$ at risk</p>
          <p className="radar-mark-caption">Mark {formatUsd(markMicro)}.</p>
          <div className="radar-plot">
            <div className="radar-band band-5"><span>±5%</span></div>
            <div className="radar-band band-2"><span>±2%</span></div>
            <div className="radar-band band-1"><span>±1%</span></div>
            <div className="radar-mark" style={{ left: "50%" }} />
            {shock !== 0 ? <div className="radar-shock" style={{ left: `${axisFraction(shock) * 100}%` }} /> : null}
            {buckets.map((bucket) => {
              const sentence = bucketSentence(bucket, markMicro);
              const hit = bucketHit(bucket.index, bucket.side, shock);
              const owned = yours?.index === bucket.index && yours.side === bucket.side;
              const height = Math.max(4, barFraction(bucket.notionalMicro, maxText) * 100);
              return (
                <button
                  key={`${bucket.side}-${bucket.index}`}
                  type="button"
                  className={`radar-bar ${bucket.side}${hit ? " hit" : ""}${owned ? " yours" : ""}`}
                  data-testid="bucket"
                  data-yours={owned ? "true" : undefined}
                  style={{ left: `${bucketLeft(bucket.index) * 100}%`, width: `${100 / BUCKET_SLOTS}%`, height: `${height}%` }}
                  aria-label={sentence}
                  onMouseEnter={() => onHover(sentence)}
                  onFocus={() => onHover(sentence)}
                  onMouseLeave={() => onHover("")}
                  onBlur={() => onHover("")}
                />
              );
            })}
          </div>
          <div className="radar-axis">
            {ticks.map((tick) => (
              <span key={tick.pct} style={{ left: `${axisFraction(tick.pct) * 100}%` }}>
                {tick.price}
                <small>{tick.pctLabel}</small>
              </span>
            ))}
          </div>
        </div>
      </div>
      <PercentSlider
        id={`crash-${perpId}`}
        label="If the mark moves"
        ariaLabel={`Shock ${symbol}`}
        min={-10}
        max={10}
        step={1}
        value={shock}
        onChange={onShock}
      />
      <p data-testid="crash-line">{line.text}</p>
      <p className="radar-note" data-testid="crash-label">
        {line.label}
      </p>
    </article>
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
      return `${index === 0 ? "M" : "L"}${formatCoord(x)} ${formatCoord(y)}`;
    })
    .join(" ");
  return (
    <svg className="radar-spark" viewBox="0 0 120 24" aria-hidden="true" data-testid="spark">
      <path d={path} />
    </svg>
  );
}
