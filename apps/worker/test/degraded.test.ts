import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { Lifeline } from "../src/lifeline.js";
import type { Sql } from "../src/schema.js";

const env = {
  OPERATOR_PK: "",
  POOL_OWNER_PK: "",
  SPONSOR_PK: "",
  ADMIN_SECRET: "",
  PRIVY_APP_ID: "",
  PRIVY_VERIFICATION_KEY: "",
  RPC_URLS_TESTNET: "",
};

function sqliteSql(db: DatabaseSync): Sql {
  return {
    exec(query: string, ...bindings: unknown[]) {
      const statement = db.prepare(query);
      const read = /^\s*(select|pragma|with)\b/i.test(query);
      if (read) {
        const rows = bindings.length > 0 ? statement.all(...(bindings as never[])) : statement.all();
        return { toArray: () => rows as Record<string, unknown>[] };
      }
      if (bindings.length > 0) statement.run(...(bindings as never[]));
      else statement.run();
      return { toArray: () => [] };
    },
  };
}

describe("storage outage", () => {
  it("returns 503 from /health while storage throws, then 200 after it recovers", async () => {
    const db = new DatabaseSync(":memory:");
    const real = sqliteSql(db);
    let fail = true;
    const sql: Sql = {
      exec(query: string, ...bindings: unknown[]) {
        if (fail) throw new Error("storage quota");
        return real.exec(query, ...bindings);
      },
    };
    let ready = Promise.resolve();
    const ctx = {
      storage: {
        sql,
        getAlarm: async () => null,
        setAlarm: async () => {},
        deleteAlarm: async () => {},
      },
      blockConcurrencyWhile(fn: () => Promise<void>) {
        ready = fn();
      },
    };
    const line = new Lifeline(ctx as never, env);
    await ready;
    const down = await line.fetch(new Request("http://lifeline/health"));
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ status: "error", degraded: "storage quota" });

    fail = false;
    const up = await line.fetch(new Request("http://lifeline/health"));
    const body = (await up.json()) as { degraded?: boolean; poolAvailable?: number; status?: string };
    expect(up.status, JSON.stringify(body)).toBe(200);
    expect(body.degraded).toBe(false);
    expect(body.poolAvailable).toBe(0);
    expect(body.status).toBeUndefined();
  });

  it("turns a thrown Durable Object fetch into the same 503", async () => {
    const response = await worker.fetch(
      new Request("https://lifeline.example/health"),
      {
        LIFELINE: {
          idFromName: () => "lifeline",
          get: () => ({
            fetch: async () => {
              throw new Error("do constructor failed");
            },
          }),
        },
      } as never,
      {} as never,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error", degraded: "do constructor failed" });
  });
});
