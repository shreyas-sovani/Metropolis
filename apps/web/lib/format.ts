export function formatUsd(micro: string): string {
  const negative = micro.startsWith("-");
  const digits = (negative ? micro.slice(1) : micro).replace(/\D/g, "") || "0";
  const whole = digits.length > 6 ? digits.slice(0, -6) : "0";
  const frac = digits.padStart(6, "0").slice(-6, -4);
  const grouped = BigInt(whole).toLocaleString("en-US");
  const text = `${negative ? "-" : ""}$${grouped}`;
  return frac === "00" ? text : `${text}.${frac}`;
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
