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

/** Testnet MON from wei, to at most two decimals. */
export function formatMon(wei: string): string {
  const value = BigInt(wei || "0");
  const hundredths = (value + 5n * 10n ** 15n) / 10n ** 16n;
  const whole = hundredths / 100n;
  const frac = hundredths % 100n;
  if (frac === 0n) return `${whole.toLocaleString("en-US")} MON`;
  if (frac % 10n === 0n) return `${whole.toLocaleString("en-US")}.${frac / 10n} MON`;
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(2, "0")} MON`;
}

export function formatCount(value: number): string {
  return Math.trunc(value).toLocaleString("en-US");
}

export function formatBlock(block: number | string): string {
  const value = typeof block === "number" ? block : Number(block);
  return `block ${value.toLocaleString("en-US")}`;
}

/** Relative time: `12 s ago`, `3 min ago`. */
export function timeAgo(thenMs: number, nowMs = Date.now()): string {
  const sec = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (sec < 60) return `${sec} s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} h ago`;
  return `${Math.floor(hr / 24)} d ago`;
}

export const formatAgo = timeAgo;

/** AUSD amounts. At most two decimals, trailing zeros dropped. */
export function formatAusd(micro: string): string {
  const negative = micro.startsWith("-");
  const digits = (negative ? micro.slice(1) : micro).replace(/\D/g, "") || "0";
  const whole = digits.length > 6 ? digits.slice(0, -6) : "0";
  const frac = digits.padStart(6, "0").slice(-6, -2);
  const trimmed = frac.replace(/0+$/, "");
  const text = trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
  return `${negative ? "-" : ""}${text}`;
}

/** Whole AUSD, with the unit, for position cards. */
export function formatAusdWhole(micro: string): string {
  const whole = BigInt(micro || "0") / 1_000_000n;
  return `${whole.toLocaleString("en-US")} AUSD`;
}

/** One decimal for a percentage already expressed in percent, such as `4.5`. */
export function formatPctOne(value: number): string {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

/** One decimal from a contract distance (`10000` is 1%). */
export function formatDistanceOne(distanceE6: string): string {
  return formatPctOne(Number(distanceE6) / 10_000);
}

/** Slider labels: whole numbers stay whole. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  if (Number.isInteger(value)) return `${value}%`;
  return formatPctOne(value);
}

/** Leverage stored in hundredths (`1500` is `15×`) or already as a multiple. */
export function formatLeverage(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return raw;
  const times = value >= 100 ? value / 100 : value;
  return `${Number.isInteger(times) ? String(times) : times.toFixed(1)}×`;
}

export function formatGrouped(value: number | string | bigint): string {
  const digits = typeof value === "bigint" ? value : BigInt(String(value).replace(/[^\d-]/g, "") || "0");
  return digits.toLocaleString("en-US");
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** SVG path coordinates. Not a displayed amount. */
export function formatCoord(value: number): string {
  return value.toFixed(1);
}

export function shortenHex(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}
