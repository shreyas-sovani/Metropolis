import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };

function objectStub(body: () => { status: number; json: unknown }) {
  const calls: string[] = [];
  const env = {
    ADMIN_SECRET: "cache-test",
    LIFELINE: {
      idFromName: () => "lifeline",
      get: () => ({
        fetch: async (request: Request) => {
          calls.push(new URL(request.url).pathname);
          const next = body();
          return Response.json(next.json, { status: next.status });
        },
      }),
    },
  };
  return { env, calls };
}

async function freshWorker(): Promise<Handler> {
  vi.resetModules();
  return (await import("../src/index.js")).default as unknown as Handler;
}

describe("worker /health cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers warm hits without a Durable Object request while the keeper is ticking", async () => {
    const worker = await freshWorker();
    const { env, calls } = objectStub(() => ({ status: 200, json: { lastAlarmAt: Date.now() - 1_000, degraded: false } }));
    const first = await worker.fetch(new Request("https://w/health"), env, {});
    expect(first.status).toBe(200);
    vi.setSystemTime(1_004_999);
    const warm = await worker.fetch(new Request("https://w/health"), env, {});
    expect(await warm.json()).toEqual(await first.clone().json());
    expect(calls).toEqual(["/health"]);
    vi.setSystemTime(1_005_000);
    await worker.fetch(new Request("https://w/health"), env, {});
    expect(calls).toEqual(["/health", "/health"]);
  });

  it("never caches a stalled alarm, so every /health can re-arm it", async () => {
    const worker = await freshWorker();
    const { env, calls } = objectStub(() => ({ status: 200, json: { lastAlarmAt: Date.now() - 30_000 } }));
    await worker.fetch(new Request("https://w/health"), env, {});
    await worker.fetch(new Request("https://w/health"), env, {});
    expect(calls).toHaveLength(2);
    const idle = objectStub(() => ({ status: 200, json: { lastAlarmAt: null } }));
    await worker.fetch(new Request("https://w/health"), idle.env, {});
    await worker.fetch(new Request("https://w/health"), idle.env, {});
    expect(idle.calls).toHaveLength(2);
  });

  it("never caches a degraded 503", async () => {
    const worker = await freshWorker();
    const { env, calls } = objectStub(() => ({ status: 503, json: { status: "error", degraded: "quota" } }));
    expect((await worker.fetch(new Request("https://w/health"), env, {})).status).toBe(503);
    expect((await worker.fetch(new Request("https://w/health"), env, {})).status).toBe(503);
    expect(calls).toHaveLength(2);
  });

  it("bypasses the cache for an admin fresh read and for an alarm clear, not for anyone else", async () => {
    const worker = await freshWorker();
    const { env, calls } = objectStub(() => ({ status: 200, json: { lastAlarmAt: Date.now() } }));
    await worker.fetch(new Request("https://w/health"), env, {});
    await worker.fetch(new Request("https://w/health?fresh=1"), env, {});
    expect(calls).toHaveLength(1);
    await worker.fetch(new Request("https://w/health?fresh=1", { headers: { "x-admin-secret": "cache-test" } }), env, {});
    expect(calls).toHaveLength(2);
    await worker.fetch(new Request("https://w/admin/alarm/clear", { method: "POST" }), env, {});
    await worker.fetch(new Request("https://w/health"), env, {});
    expect(calls).toEqual(["/health", "/health", "/admin/alarm/clear", "/health"]);
  });
});
