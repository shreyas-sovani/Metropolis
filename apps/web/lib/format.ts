export function formatUsd(micro: string): string {
  const negative = micro.startsWith("-");
  const digits = (negative ? micro.slice(1) : micro).replace(/\D/g, "") || "0";
  const whole = digits.length > 6 ? digits.slice(0, -6) : "0";
  const frac = digits.padStart(6, "0").slice(-6, -4);
  const grouped = BigInt(whole).toLocaleString("en-US");
  const text = `${negative ? "-" : ""}$${grouped}`;
  return frac === "00" ? text : `${text}.${frac}`;
}

export function formatPct(distanceE6: string): string {
  const value = Number(distanceE6) / 10_000;
  return `${value.toFixed(2)}%`;
}
