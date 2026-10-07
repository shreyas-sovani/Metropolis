import { afterAll, describe, expect, it } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";

describe("schema migrations", () => {
  let worker: Unstable_DevWorker;

  afterAll(async () => {
    await worker?.stop();
  });

  it("applies twice as a no-op and round-trips every table in wrangler dev", async () => {
    worker = await unstable_dev("src/index.ts", {
      config: "wrangler.toml",
      local: true,
      logLevel: "error",
      vars: { ADMIN_SECRET: "schema-test" },
      experimental: { disableExperimentalWarning: true },
      persist: false,
    });
    const headers = { "x-admin-secret": "schema-test" };
    const first = await worker.fetch("http://127.0.0.1/schema/selftest", { method: "POST", headers });
    const second = await worker.fetch("http://127.0.0.1/schema/selftest", { method: "POST", headers });
    const firstBody = (await first.json()) as { ok?: boolean; versions?: number[]; error?: string };
    const secondBody = (await second.json()) as { ok?: boolean; versions?: number[]; error?: string };
    expect(first.status, firstBody.error).toBe(200);
    expect(second.status, secondBody.error).toBe(200);
    expect(firstBody).toEqual({ ok: true, versions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    expect(secondBody.versions).toEqual(firstBody.versions);
  }, 60_000);
});
