/** Share one upstream build per key, then reuse it until the ttl. */
export function createRefreshCache<T>(ttlMs: number) {
  const cached = new Map<string, { at: number; data: T }>();
  const flights = new Map<string, Promise<T>>();
  let builds = 0;
  return {
    builds: () => builds,
    async read(key: string, now: number, load: () => Promise<T>, onRefresh?: () => void): Promise<T> {
      const hit = cached.get(key);
      if (hit && now - hit.at < ttlMs) return hit.data;
      const existing = flights.get(key);
      if (existing) return existing;
      builds += 1;
      onRefresh?.();
      const flight = load()
        .then((data) => {
          cached.set(key, { at: now, data });
          return data;
        })
        .finally(() => {
          flights.delete(key);
        });
      flights.set(key, flight);
      return flight;
    },
  };
}
