import { afterAll, describe, expect, it } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";

describe("alarm restore", () => {
  let worker: Unstable_DevWorker;

  afterAll(async () => {
    await worker?.stop();
  });

  it("schedules a new alarm within 5s after /health", async () => {
    worker = await unstable_dev("src/index.ts", {
      config: "wrangler.toml",
      local: true,
      logLevel: "error",
      vars: { ADMIN_SECRET: "alarm-test" },
      experimental: { disableExperimentalWarning: true },
      persist: false,
    });
    const cleared = await worker.fetch("http://127.0.0.1/admin/alarm/clear", {
      method: "POST",
      headers: { "x-admin-secret": "alarm-test" },
    });
    expect(await cleared.json()).toEqual({ alarm: null });
    const started = Date.now();
    const health = await worker.fetch("http://127.0.0.1/health");
    expect(health.status).toBe(200);
    const body = (await health.json()) as { paused: boolean };
    expect(body.paused).toBe(false);
    const alarm = await worker.fetch("http://127.0.0.1/admin/alarm", {
      headers: { "x-admin-secret": "alarm-test" },
    });
    const stored = (await alarm.json()) as { alarm: number | null };
    expect(stored.alarm).not.toBeNull();
    expect((stored.alarm ?? 0) - started).toBeLessThan(5_000);
  }, 60_000);
});
