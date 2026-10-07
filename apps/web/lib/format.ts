export function formatUsd(micro: string): string {
  const negative = micro.startsWith("-");
  const digits = (negative ? micro.slice(1) : micro).replace(/\D/g, "") || "0";
  const whole = digits.length > 6 ? digits.slice(0, -6) : "0";
  const frac = digits.padStart(6, "0").slice(-6, -4);
  const grouped = BigInt(whole).toLocaleString("en-US");
  const text = `${negative ? "-" : ""}$${grouped}`;
  return frac === "00" ? text : `${text}.${frac}`;
}

const MICRO = 1_000_000n;

function roundDiv(value: bigint, unit: bigint): bigint {
  return (value + unit / 2n) / unit;
}

/** Compact dollars for headlines. Under $10k matches `formatUsd`. The exact figure stays in a title. */
export function formatUsdCompact(micro: string): string {
  const negative = micro.startsWith("-");
  const digits = (negative ? micro.slice(1) : micro).replace(/\D/g, "") || "0";
  const value = BigInt(digits);
  if (value < 10_000n * MICRO) return formatUsd(negative ? `-${digits}` : digits);
  const sign = negative ? "-" : "";
  if (value < 1_000_000n * MICRO) {
    const tenths = roundDiv(value, 100n * MICRO);
    if (tenths >= 10_000n) return `${sign}$1M`;
    const whole = tenths / 10n;
    const frac = tenths % 10n;
    return frac === 0n ? `${sign}$${whole}k` : `${sign}$${whole}.${frac}k`;
  }
  const hundredths = roundDiv(value, 10_000n * MICRO);
  const whole = hundredths / 100n;
  const frac = hundredths % 100n;
  if (frac === 0n) return `${sign}$${whole}M`;
  if (frac % 10n === 0n) return `${sign}$${whole}.${frac / 10n}M`;
  return `${sign}$${whole}.${frac.toString().padStart(2, "0")}M`;
}

/** A chain price in micro-dollars, shown with that market's price decimals. */
export function formatPrice(micro: string, priceDecimals: number): string {
  const negative = micro.startsWith("-");
  const digits = (negative ? micro.slice(1) : micro).replace(/\D/g, "") || "0";
  const value = BigInt(digits);
  const decimals = Math.max(0, Math.min(6, Math.trunc(priceDecimals)));
  const places = 10n ** BigInt(decimals);
  const microPerTick = 1_000_000n / places;
  const ticks = microPerTick === 0n ? 0n : value / microPerTick;
  const whole = decimals === 0 ? ticks : ticks / places;
  const grouped = whole.toLocaleString("en-US");
  const body =
    decimals === 0 ? `$${grouped}` : `$${grouped}.${(ticks % places).toString().padStart(decimals, "0")}`;
  return `${negative ? "-" : ""}${body}`;
}

export function formatPct(distanceE6: string): string {
  const value = Number(distanceE6) / 10_000;
  return `${value.toFixed(2)}%`;
}

export function formatBlock(block: number | string): string {
  const value = typeof block === "number" ? block : Number(block);
  return `block ${value.toLocaleString("en-US")}`;
}

/** Relative time: `12 s ago`, `3 min ago`. */
export function formatAgo(thenMs: number, nowMs = Date.now()): string {
  const sec = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (sec < 60) return `${sec} s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} h ago`;
  return `${Math.floor(hr / 24)} d ago`;
}

export function shortenHex(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}
