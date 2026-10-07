import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { IP_LIMIT, claimGate, pickPool, repeatClaimBody, type PoolCandidate } from "../src/claim.js";
import { clientIpFrom } from "../src/client-ip.js";
import { acceptedStamp, meFor } from "../src/me.js";
import type { LifelineEnv } from "../src/lifeline.js";
import type { Sql } from "../src/schema.js";
import { classifyWatched } from "../src/saves.js";

const btc = (distanceE6: bigint, proxy: string): PoolCandidate => ({
  proxy: getAddress(proxy),
  market: "BTC",
  perpId: "16",
  accountId: "1",
  side: "long",
  leverage: "1500",
  distanceE6,
});

describe("claim selection", () => {
  it("prefers the closest BTC position that is still above the house trigger", () => {
    const picked = pickPool([
      btc(10_000n, "0x00000000000000000000000000000000000000a1"),
      btc(40_000n, "0x00000000000000000000000000000000000000a2"),
      btc(20_000n, "0x00000000000000000000000000000000000000a3"),
      { ...btc(16_000n, "0x00000000000000000000000000000000000000a4"), market: "ETH" },
    ]);
    expect(picked?.proxy).toBe(getAddress("0x00000000000000000000000000000000000000a3"));
  });

  it("picks the demo band before a closer position under the house target", () => {
    const picked = pickPool([
      btc(20_000n, "0x00000000000000000000000000000000000000a1"),
      btc(32_000n, "0x00000000000000000000000000000000000000a2"),
      { ...btc(30_000n, "0x00000000000000000000000000000000000000a4"), market: "ETH" },
    ]);
    expect(picked?.proxy).toBe(getAddress("0x00000000000000000000000000000000000000a2"));
  });

  it("uses a non-BTC position in the demo band before a BTC position outside it", () => {
    const picked = pickPool([
      btc(20_000n, "0x00000000000000000000000000000000000000a1"),
      { ...btc(30_000n, "0x00000000000000000000000000000000000000a4"), market: "ETH" },
    ]);
    expect(picked?.market).toBe("ETH");
  });

  it("offers a reserve position only when nothing closer is free", () => {
    const reserved = btc(70_000n, "0x00000000000000000000000000000000000000b1");
    reserved.reserve = true;
    const closer = btc(20_000n, "0x00000000000000000000000000000000000000b2");
    expect(pickPool([reserved, closer])?.proxy).toBe(closer.proxy);
    expect(pickPool([reserved])?.proxy).toBe(reserved.proxy);
  });

  it("uses another market only when no BTC position is above the trigger", () => {
    const picked = pickPool([
      btc(10_000n, "0x00000000000000000000000000000000000000a1"),
      { ...btc(18_000n, "0x00000000000000000000000000000000000000a4"), market: "ETH" },
    ]);
    expect(picked?.market).toBe("ETH");
  });

  it("rejects a repeat user, an eleventh IP claim, and an empty pool", () => {
    expect(claimGate({ existingUser: true, ipCount: 0, available: 3 }).ok).toBe(false);
    expect(claimGate({ existingUser: true, ipCount: 0, available: 3 })).toMatchObject({ status: 409 });
    expect(claimGate({ existingUser: false, ipCount: IP_LIMIT, available: 3 })).toMatchObject({ status: 429 });
    expect(claimGate({ existingUser: false, ipCount: IP_LIMIT - 1, available: 3 })).toEqual({ ok: true });
    expect(claimGate({ existingUser: false, ipCount: 0, available: 0 })).toEqual({
      ok: false,
      status: 503,
      body: { error: "empty", sandbox: true },
    });
    expect(claimGate({ existingUser: false, ipCount: 0, available: 1 })).toEqual({ ok: true });
  });

  it("never hands a sandbox account to a claim", () => {
    const sandbox = btc(30_000n, "0x00000000000000000000000000000000000000c1");
    sandbox.role = "sandbox";
    const pool = btc(40_000n, "0x00000000000000000000000000000000000000c2");
    expect(pickPool([sandbox, pool])?.proxy).toBe(pool.proxy);
    expect(pickPool([sandbox])).toBeNull();
  });

  it("returns the existing practice account on a repeat claim", () => {
    const body = repeatClaimBody({
      proxy: "0x00000000000000000000000000000000000000d1",
      perpId: "16",
      accountId: "4",
      market: "BTC",
      side: "long",
      leverage: "1500",
      distanceE6: "32000",
    });
    expect(body).toMatchObject({ error: "claimed", proxy: "0x00000000000000000000000000000000000000d1" });
  });
});

describe("client ip", () => {
  const env = { ADMIN_SECRET: "secret", PROXY_SECRET: "proxy" };

  it("ignores a browser-supplied rate-limit address", () => {
    const request = new Request("https://lifeline.test/claim", {
      headers: { "x-lifeline-ip": "1.2.3.4", "cf-connecting-ip": "9.9.9.9" },
    });
    expect(clientIpFrom(request, env)).toBe("9.9.9.9");
  });

  it("honors the forwarded client address only with the proxy secret", () => {
    const honored = new Request("https://lifeline.test/claim", {
      headers: {
        "x-lifeline-client-ip": "8.8.8.8",
        "x-lifeline-proxy-secret": "proxy",
        "cf-connecting-ip": "9.9.9.9",
      },
    });
    const spoofed = new Request("https://lifeline.test/claim", {
      headers: {
        "x-lifeline-client-ip": "8.8.8.8",
        "x-lifeline-proxy-secret": "nope",
        "cf-connecting-ip": "9.9.9.9",
      },
    });
    expect(clientIpFrom(honored, env)).toBe("8.8.8.8");
    expect(clientIpFrom(spoofed, env)).toBe("9.9.9.9");
  });

  it("keeps the admin override for the CLI and the test wallet", () => {
    const request = new Request("https://lifeline.test/claim", {
      headers: { "x-admin-secret": "secret", "x-lifeline-ip": "203.0.113.20", "cf-connecting-ip": "9.9.9.9" },
    });
    expect(clientIpFrom(request, env)).toBe("203.0.113.20");
  });
});

describe("acceptance and saves", () => {
  it("stamps acceptance exactly once", () => {
    const owner = "0x00000000000000000000000000000000000000aa";
    expect(acceptedStamp(null, owner, owner, 50)).toBe(50);
    expect(acceptedStamp(50, owner, owner, 90)).toBeNull();
    expect(acceptedStamp(null, owner, "0x00000000000000000000000000000000000000bb", 50)).toBeNull();
  });

  it("counts a save only when an open position crosses its old liquidation price", () => {
    expect(classifyWatched({ side: "long", preLiq: 100n, mark: 99n, open: true, saved: false })).toBe("save");
    expect(classifyWatched({ side: "long", preLiq: 100n, mark: 99n, open: false, saved: false })).toBe("none");
    expect(classifyWatched({ side: "long", preLiq: 100n, mark: 101n, open: true, saved: false })).toBe("none");
    expect(classifyWatched({ side: "short", preLiq: 100n, mark: 101n, open: true, saved: false })).toBe("save");
  });
});

describe("/me", () => {
  const env = { RPC_URLS_TESTNET: "http://127.0.0.1:9" } as LifelineEnv;

  it("returns an empty claim when the user has not reserved an account", async () => {
    const sql: Sql = { exec: () => ({ toArray: () => [] }) };
    const response = await meFor(sql, env, "did:privy:new", 10, async () => null);
    expect(await response.json()).toEqual({ userId: "did:privy:new", claim: null, mandate: null });
  });

  it("returns the reserved account", async () => {
    const sql: Sql = {
      exec(query: string) {
        if (query.includes("JOIN pool")) {
          return {
            toArray: () => [
              {
                proxy: "0x00000000000000000000000000000000000000d1",
                owner: "0x00000000000000000000000000000000000000aa",
                claimed_at: 10,
                accepted_at: null,
                transfer_tx: "0xabc",
                drip_tx: "0xdef",
                perp_id: "16",
                account_id: "4",
                market: "BTC",
                side: "long",
                leverage: "1500",
              },
            ],
          };
        }
        if (query.includes("FROM mandates")) return { toArray: () => [] };
        if (query.includes("accepted_at")) return { toArray: () => [{ accepted_at: 10, owner: "0x00000000000000000000000000000000000000aa" }] };
        return { toArray: () => [] };
      },
    };
    const response = await meFor(sql, env, "did:privy:back", 20, async () => ({
      owner: "0x00000000000000000000000000000000000000aa",
      pendingOwner: "0x0000000000000000000000000000000000000000",
    }));
    const body = (await response.json()) as { claim: { proxy: string; ownerOnchain: string } };
    expect(body.claim.proxy).toBe("0x00000000000000000000000000000000000000d1");
    expect(body.claim.ownerOnchain).toBe("0x00000000000000000000000000000000000000aa");
  });
});
