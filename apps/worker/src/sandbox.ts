import { TESTNET_ID, buildMandate, delegatedAccountAbi, openChain } from "@lifeline/core";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { armPosition } from "./arm.js";
import type { HotState } from "./hot.js";
import type { LifelineEnv } from "./lifeline.js";
import { signMandate } from "./house.js";
import type { Sql } from "./schema.js";

const HOUR_MS = 60 * 60 * 1000;
const LIMIT = 3;

export function sandboxLimited(count: number): boolean {
  return count >= LIMIT;
}

export async function sandboxArm(
  sql: Sql,
  env: LifelineEnv,
  request: { proxy?: string; triggerBps?: number; targetBps?: number; ip: string },
  nowMs: number,
  hot?: HotState | null,
): Promise<Response> {
  const recent = sql
    .exec("SELECT COUNT(*) AS n FROM sandbox_hits WHERE ip = ? AND at >= ?", request.ip, nowMs - HOUR_MS)
    .toArray()[0] as { n?: number } | undefined;
  if (sandboxLimited(Number(recent?.n ?? 0))) return Response.json({ error: "rate" }, { status: 429 });
  if (!request.proxy) return Response.json({ error: "proxy" }, { status: 400 });
  const proxy = getAddress(request.proxy);
  const pool = hot?.loaded
    ? hot.pools.find((row) => row.proxy === proxy)
    : (sql.exec("SELECT perp_id, role FROM pool WHERE proxy = ?", proxy).toArray()[0] as
        | { perp_id?: string; role?: string }
        | undefined);
  if (!pool?.perp_id || (pool.role !== "pool" && pool.role !== "twin-protected")) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  sql.exec("INSERT INTO sandbox_hits (ip, at) VALUES (?, ?)", request.ip, nowMs);
  const urls = env.RPC_URLS_TESTNET.split(",").map((url) => url.trim()).filter((url) => url.length > 0);
  const client = openChain(TESTNET_ID, { urls, timeout: 8_000 }).client;
  const onchain = getAddress(
    await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "owner" }),
  );
  const house = privateKeyToAccount(env.POOL_OWNER_PK as Hex);
  if (onchain !== house.address) return Response.json({ error: "forbidden" }, { status: 403 });
  const triggerBps = Number(request.triggerBps);
  const targetBps = Number(request.targetBps);
  const message = buildMandate({
    account: proxy,
    perpIds: [BigInt(pool.perp_id)],
    triggerBps,
    targetBps,
    maxPerActionCNS: 150_000_000n,
    budgetCNS: 300_000_000n,
    expiry: BigInt(Math.floor(nowMs / 1000) + 20 * 24 * 60 * 60),
    nonce: BigInt(nowMs),
  });
  const signed = await signMandate(env.POOL_OWNER_PK, message);
  return armPosition(
    sql,
    env,
    { userId: "sandbox", address: house.address, ip: request.ip },
    {
      mandate: {
        account: message.account,
        perpIds: message.perpIds.map((id) => id.toString()),
        triggerBps: message.triggerBps,
        targetBps: message.targetBps,
        maxPerActionCNS: message.maxPerActionCNS.toString(),
        budgetCNS: message.budgetCNS.toString(),
        expiry: message.expiry.toString(),
        nonce: message.nonce.toString(),
      },
      signature: signed.sig,
    },
    nowMs,
    hot,
  );
}
