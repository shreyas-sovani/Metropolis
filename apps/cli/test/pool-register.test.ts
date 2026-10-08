import { describe, expect, it } from "vitest";
import { mandateLookup, planEntries, poolLeverage } from "../src/commands/pool-register.js";

const HOUSE = "0x00000000000000000000000000000000000000b1";
const BARE = "0x00000000000000000000000000000000000000b3";

describe("pool register mandate lookup", () => {
  it("verifies the whole pool from one admin read", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      expect(new Headers(init?.headers).get("x-admin-secret")).toBe("secret");
      return Response.json({ mandates: [{ proxy: HOUSE, owner: HOUSE, kind: "house", sig: "0x", typedData: { triggerBps: 150 } }] });
    }) as typeof fetch;
    const lookup = await mandateLookup("https://w", "secret", fetcher);
    const found = await lookup(HOUSE);
    expect(found.status).toBe(200);
    expect(((await found.json()) as { kind: string }).kind).toBe("house");
    expect((await lookup(BARE)).status).toBe(404);
    expect(calls).toEqual(["https://w/admin/mandates"]);
  });

  it("falls back to one read per account on a worker without the batch route", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("lifeline", { status: 404 });
    }) as typeof fetch;
    const lookup = await mandateLookup("https://w", "secret", fetcher);
    expect((await lookup(HOUSE)).status).toBe(404);
    expect(calls).toEqual(["https://w/admin/mandates", `https://w/mandate/${HOUSE}`]);
  });
});

describe("pool register plan", () => {
  it("plans pool accounts and both twin legs", () => {
    const entries = planEntries(
      { accounts: [{ proxy: "0x00000000000000000000000000000000000000b1", market: "BTC", side: "short", perpId: "16" }] },
      {
        pairs: [
          {
            id: "sol-long",
            market: "SOL",
            side: "long",
            perpId: "48",
            leverageHdths: "1000",
            protected: { proxy: "0x00000000000000000000000000000000000000b2" },
            unprotected: { proxy: "0x00000000000000000000000000000000000000b3" },
          },
        ],
      },
    );
    expect(entries.map((entry) => entry.role)).toEqual(["pool", "twin-protected", "twin-unprotected"]);
    expect(entries[0]?.leverage).toBe(poolLeverage("BTC"));
    expect(entries[1]?.leverage).toBe("1000");
    expect(entries[2]?.pairId).toBe("sol-long");
    expect(poolLeverage("ETH")).toBe("1200");
  });
});
