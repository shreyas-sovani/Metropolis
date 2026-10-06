export function allowRequest(hits: number[], now: number, limit = 60, windowMs = 60_000): boolean {
  const fresh = hits.filter((at) => now - at < windowMs);
  hits.length = 0;
  hits.push(...fresh);
  if (hits.length >= limit) return false;
  hits.push(now);
  return true;
}
