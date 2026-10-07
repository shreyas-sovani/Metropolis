import { TESTNET_ID, delegatedAccountAbi, openChain, transferOwnershipTx } from "@lifeline/core";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { acceptCached, releaseCached, setPoolStatus, type HotState } from "./hot.js";
import type { LifelineEnv } from "./lifeline.js";
import type { Sql } from "./schema.js";
import { broadcastTx, readDistances, urlsOf, waitForReceipt } from "./tick.js";
import { RESERVE_DISTANCE_E6 } from "./claim.js";

export const CLAIM_TTL_MS = 10 * 60 * 1000;
export const RECYCLE_INTERVAL_MS = 60 * 1000;
const ZERO = "0x0000000000000000000000000000000000000000";

export function pendingCleared(pending: string): boolean {
  return getAddress(pending) === ZERO;
}

export function recycleDue(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= RECYCLE_INTERVAL_MS;
}

export interface OpenClaim {
  proxy: string;
  claimedAt: number;
  owner: string;
  pending: string;
  poolOwner: string;
}

export interface RecycleStep {
  proxy: string;
  action: "clear" | "release" | "keep";
}

/** An unaccepted claim older than 10 minutes is cleared. An accepted one is kept. */
export function planRecycle(claims: readonly OpenClaim[], now: number): RecycleStep[] {
  const steps: RecycleStep[] = [];
  for (const claim of claims) {
    if (now - claim.claimedAt < CLAIM_TTL_MS) continue;
    if (getAddress(claim.owner) !== getAddress(claim.poolOwner)) {
      steps.push({ proxy: claim.proxy, action: "keep" });
      continue;
    }
    steps.push({
      proxy: claim.proxy,
      action: pendingCleared(claim.pending) ? "release" : "clear",
    });
  }
  return steps;
}

export function releaseClaim(sql: Sql, proxy: string, hot?: HotState | null) {
  sql.exec("UPDATE pool SET status = 'available' WHERE proxy = ? AND role = 'pool'", proxy);
  sql.exec("DELETE FROM claims WHERE proxy = ?", proxy);
  releaseCached(hot, proxy);
}

export async function recycleClaims(sql: Sql, env: LifelineEnv, nowMs: number, hot?: HotState | null): Promise<number> {
  let last: number | null;
  if (hot?.loaded) {
    last = hot.recycledAt;
  } else {
    const stamp = sql.exec("SELECT recycled_at FROM keeper_stats WHERE id = 1").toArray()[0] as
      | { recycled_at?: number | null }
      | undefined;
    last = stamp?.recycled_at === undefined || stamp.recycled_at === null ? null : Number(stamp.recycled_at);
  }
  if (!recycleDue(last, nowMs)) return 0;
  sql.exec("UPDATE keeper_stats SET recycled_at = ? WHERE id = 1", nowMs);
  if (hot) hot.recycledAt = nowMs;
  const house = privateKeyToAccount(env.POOL_OWNER_PK as Hex);
  const urls = urlsOf(env);
  const client = openChain(TESTNET_ID, { urls, timeout: 8_000 }).client;
  const rows = hot?.loaded
    ? hot.openClaims
        .filter((row) => row.claimed_at <= nowMs - CLAIM_TTL_MS)
        .map((row) => ({ proxy: row.proxy, claimed_at: row.claimed_at }))
    : (sql
        .exec(
          `SELECT claims.proxy, claims.claimed_at FROM claims
           JOIN pool ON pool.proxy = claims.proxy
           WHERE claims.accepted_at IS NULL AND pool.role = 'pool' AND claims.claimed_at <= ?`,
          nowMs - CLAIM_TTL_MS,
        )
        .toArray() as { proxy?: string; claimed_at?: number }[]);
  const open: OpenClaim[] = [];
  for (const row of rows.slice(0, 3)) {
    if (!row.proxy || row.claimed_at === undefined) continue;
    const proxy = getAddress(row.proxy);
    const [owner, pending] = await Promise.all([
      client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "owner" }),
      client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "pendingOwner" }),
    ]);
    open.push({
      proxy,
      claimedAt: Number(row.claimed_at),
      owner: getAddress(owner as Address),
      pending: getAddress(pending as Address),
      poolOwner: house.address,
    });
  }
  let released = 0;
  for (const step of planRecycle(open, nowMs)) {
    if (step.action === "keep") {
      sql.exec("UPDATE claims SET accepted_at = ? WHERE proxy = ?", nowMs, step.proxy);
      acceptCached(hot, step.proxy);
      continue;
    }
    if (step.action === "clear") {
      const built = transferOwnershipTx(getAddress(step.proxy), ZERO);
      const nonce = await client.getTransactionCount({ address: house.address, blockTag: "pending" });
      const hash = await broadcastTx(urls, house, { ...built, nonce });
      await waitForReceipt(client, hash).catch(() => null);
      const pending = getAddress(
        (await client.readContract({
          address: getAddress(step.proxy),
          abi: delegatedAccountAbi,
          functionName: "pendingOwner",
        })) as Address,
      );
      if (!pendingCleared(pending)) continue;
    }
    releaseClaim(sql, step.proxy, hot);
    released += 1;
  }
  await flagReserve(sql, env, hot);
  return released;
}

async function flagReserve(sql: Sql, env: LifelineEnv, hot?: HotState | null) {
  const rows = hot?.loaded
    ? hot.pools.filter((row) => row.role === "pool" && (row.status === "available" || row.status === "reserve"))
    : (sql
        .exec("SELECT proxy, account_id, perp_id, status FROM pool WHERE role = 'pool' AND status IN ('available', 'reserve')")
        .toArray() as { proxy?: string; account_id?: string; perp_id?: string; status?: string }[]);
  const readable = rows.filter((row) => row.proxy && row.account_id && row.perp_id) as {
    proxy: string;
    account_id: string;
    perp_id: string;
  }[];
  if (readable.length === 0) return;
  const distances = await readDistances(env, readable);
  for (const row of readable) {
    const distance = distances.get(getAddress(row.proxy));
    if (distance === undefined) continue;
    const next = distance > RESERVE_DISTANCE_E6 ? "reserve" : "available";
    const current = rows.find((item) => item.proxy === row.proxy)?.status;
    if (current !== next) {
      sql.exec("UPDATE pool SET status = ? WHERE proxy = ?", next, row.proxy);
      setPoolStatus(hot, row.proxy, next);
    }
  }
}
