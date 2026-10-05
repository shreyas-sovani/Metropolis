import { afterAll, describe, expect, it } from "vitest";
import { getAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildMandate, recoverSigner } from "@lifeline/core";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";

const POOL = getAddress("0x00000000000000000000000000000000000000a1");
const PROTECTED = getAddress("0x00000000000000000000000000000000000000a2");
const OPEN = getAddress("0x00000000000000000000000000000000000000a3");

function entry(proxy: Address, role: "pool" | "twin-protected" | "twin-unprotected") {
  return {
    proxy,
    accountId: "821",
    perpId: role === "pool" ? "16" : "48",
    side: "long",
    leverage: role === "pool" ? "1500" : "1000",
    market: role === "pool" ? "BTC" : "SOL",
    role,
    pairId: role === "pool" ? "" : "sol-long",
  };
}

describe("pool registration", () => {
  let worker: Unstable_DevWorker;
  const key = generatePrivateKey();
  const owner = privateKeyToAccount(key).address;

  afterAll(async () => {
    await worker?.stop();
  });

  it("stores house mandates and hides unprotected twins", async () => {
    worker = await unstable_dev("src/index.ts", {
      config: "wrangler.toml",
      local: true,
      logLevel: "error",
      vars: { ADMIN_SECRET: "register-test", POOL_OWNER_PK: key },
      experimental: { disableExperimentalWarning: true },
      persist: false,
    });
    const headers = { "x-admin-secret": "register-test", "content-type": "application/json" };
    const denied = await worker.fetch("http://127.0.0.1/admin/pool", { method: "POST" });
    expect(denied.status).toBe(401);

    const body = JSON.stringify({ entries: [entry(POOL, "pool"), entry(PROTECTED, "twin-protected"), entry(OPEN, "twin-unprotected")] });
    const first = await worker.fetch("http://127.0.0.1/admin/pool", { method: "POST", headers, body });
    const firstBody = (await first.json()) as { registered?: number; mandates?: number; error?: string };
    expect(first.status, firstBody.error).toBe(200);
    expect(firstBody).toEqual({ registered: 3, mandates: 2 });

    const poolMandate = await readMandate(worker, POOL);
    const twinMandate = await readMandate(worker, PROTECTED);
    expect(poolMandate.owner).toBe(owner);
    expect(poolMandate.kind).toBe("house");
    expect(poolMandate.typedData.triggerBps).toBe(150);
    expect(poolMandate.typedData.targetBps).toBe(250);
    expect(poolMandate.typedData.budgetCNS).toBe("300000000");
    expect(await recoverSigner(asMessage(poolMandate), poolMandate.sig)).toBe(owner);
    expect(twinMandate.typedData.triggerBps).toBe(400);
    expect(twinMandate.typedData.targetBps).toBe(600);
    expect(await recoverSigner(asMessage(twinMandate), twinMandate.sig)).toBe(owner);
    expect((await worker.fetch(`http://127.0.0.1/mandate/${OPEN}`)).status).toBe(404);

    const second = await worker.fetch("http://127.0.0.1/admin/pool", { method: "POST", headers, body });
    const secondBody = (await second.json()) as { registered?: number; mandates?: number; sig?: string };
    expect(second.status).toBe(200);
    expect(secondBody.registered).toBe(3);
    expect(secondBody.mandates).toBe(2);
    const again = await readMandate(worker, POOL);
    expect(again.sig).toBe(poolMandate.sig);

    const health = (await (await worker.fetch("http://127.0.0.1/health")).json()) as { poolAvailable: number };
    expect(health.poolAvailable).toBe(1);
  }, 60_000);
});

interface StoredMandate {
  owner: Address;
  kind: string;
  sig: Hex;
  typedData: {
    account: Address;
    perpIds: string[];
    triggerBps: number;
    targetBps: number;
    maxPerActionCNS: string;
    budgetCNS: string;
    expiry: string;
    nonce: string;
  };
}

async function readMandate(worker: Unstable_DevWorker, proxy: Address): Promise<StoredMandate> {
  const response = await worker.fetch(`http://127.0.0.1/mandate/${proxy}`);
  const body = (await response.json()) as StoredMandate & { error?: string };
  expect(response.status, body.error).toBe(200);
  return body;
}

function asMessage(stored: StoredMandate) {
  return buildMandate({
    account: getAddress(stored.typedData.account),
    perpIds: stored.typedData.perpIds.map((id) => BigInt(id)),
    triggerBps: stored.typedData.triggerBps,
    targetBps: stored.typedData.targetBps,
    maxPerActionCNS: BigInt(stored.typedData.maxPerActionCNS),
    budgetCNS: BigInt(stored.typedData.budgetCNS),
    expiry: BigInt(stored.typedData.expiry),
    nonce: BigInt(stored.typedData.nonce),
  });
}
