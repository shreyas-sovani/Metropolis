"use client";

import type { KeyboardEvent } from "react";
import { formatPercent } from "../../lib/format";
import "./percent-slider.css";

export function PercentSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 0.5,
  preview,
  id,
  ariaLabel,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  preview?: string;
  id: string;
  ariaLabel?: string;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
    const next = Math.min(max, Math.max(min, value + direction * step * 2));
    onChange(next);
  }
  const shown = formatPercent(value);
  return (
    <div className="ui-slider">
      <div className="ui-slider-top">
        <label htmlFor={id}>{label}</label>
        <span className="tabular">{shown}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))}
        onKeyDown={onKeyDown}
      />
      {preview ? <p className="ui-slider-preview">{preview}</p> : null}
    </div>
  );
}
