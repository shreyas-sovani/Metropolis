import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "0x00000000000000000000000000000000000000A1";
const OTHER = "0x00000000000000000000000000000000000000a2";

function workerFetch(reply: (url: string) => unknown) {
  const calls: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(new URL(url).pathname + new URL(url).search);
    return Response.json(reply(url));
  });
  vi.stubGlobal("fetch", fetcher);
  return calls;
}

async function fresh<T>(path: string): Promise<T> {
  vi.resetModules();
  return (await import(path)) as T;
}

describe("worker-facing route caches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("serves /api/ops-health from memory for 10s, whatever the tab count", async () => {
    const calls = workerFetch(() => ({ lastAlarmAt: Date.now(), armed: 3, degraded: false, paused: false }));
    const route = await fresh<{ GET: () => Promise<Response> }>("../app/api/ops-health/route");
    const first = await (await route.GET()).json();
    for (let tab = 0; tab < 20; tab += 1) expect(await (await route.GET()).json()).toEqual(first);
    expect(calls).toEqual(["/health"]);
    vi.setSystemTime(1_010_000);
    await route.GET();
    expect(calls).toEqual(["/health", "/health"]);
  });

  it("serves /api/actions per account from memory for 5s", async () => {
    const calls = workerFetch(() => ({ actions: [{ txHash: "0xabc", amountCNS: "1" }] }));
    const route = await fresh<{ GET: (request: Request) => Promise<Response> }>("../app/api/actions/route");
    const get = (account: string) => route.GET(new Request(`https://web/api/actions?account=${account}`));
    const first = await get(ACCOUNT);
    expect(first.status).toBe(200);
    expect((await first.json()) as unknown).toMatchObject({ actions: [{ txHash: "0xabc" }] });
    await get(ACCOUNT.toLowerCase());
    await get(ACCOUNT);
    expect(calls).toHaveLength(1);
    await get(OTHER);
    expect(calls).toHaveLength(2);
    vi.setSystemTime(1_004_999);
    await get(ACCOUNT);
    expect(calls).toHaveLength(2);
    vi.setSystemTime(1_005_000);
    await get(ACCOUNT);
    expect(calls).toHaveLength(3);
    expect((await get("nope")).status).toBe(400);
    expect(calls).toHaveLength(3);
  });

  it("serves /api/saves from memory for 30s", async () => {
    const calls = workerFetch(() => ({ count: 2, watched: 5, saves: [] }));
    const route = await fresh<{ GET: () => Promise<Response> }>("../app/api/saves/route");
    expect(await (await route.GET()).json()).toEqual({ count: 2, watched: 5, saves: [] });
    await route.GET();
    vi.setSystemTime(1_029_999);
    await route.GET();
    expect(calls).toEqual(["/saves"]);
  });

  it("caches /api/twins only when every leg read, so the panel's retries still reach the chain", async () => {
    let failed = true;
    const calls = workerFetch(() => ({
      pairs: [{ protected: failed ? { distanceError: "rpc" } : { distanceE6: "1" }, unprotected: null }],
    }));
    const route = await fresh<{ GET: () => Promise<Response> }>("../app/api/twins/route");
    await route.GET();
    await route.GET();
    expect(calls).toHaveLength(2);
    failed = false;
    await route.GET();
    await route.GET();
    expect(calls).toHaveLength(3);
  });

  it("pings worker /health at most once a minute from the radar refresh", async () => {
    const calls = workerFetch(() => ({}));
    const http = await fresh<{ pingHealth: (now?: number) => void }>("../lib/http");
    for (let at = 0; at < 60_000; at += 2_000) http.pingHealth(1_000_000 + at);
    expect(calls).toEqual(["/health"]);
    http.pingHealth(1_060_000);
    expect(calls).toEqual(["/health", "/health"]);
  });
});
